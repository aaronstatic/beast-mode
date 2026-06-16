import { Client, GatewayIntentBits, ChatInputCommandInteraction } from "discord.js";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { botLog } from "./logger.ts";
import { ConfigSchema } from "./types.ts";
import type {
  Config,
  ProgressPayload,
  ReplyPayload,
  AskPayload,
  CommandCompletePayload,
  PermissionRequestPayload,
} from "./types.ts";
import {
  ProgressPayloadSchema,
  ReplyPayloadSchema,
  AskPayloadSchema,
  ProjectEntrySchema,
  CommandCompletePayloadSchema,
  PermissionRequestPayloadSchema,
} from "./types.ts";
import {
  verifySignature,
  signPayload,
  resetProjectConcurrency,
  isAllowedUser,
  checkUserRateLimit,
  isProjectBusy,
  getProjectDepth,
  recordCommandStart,
} from "./security.ts";
import {
  registerProject,
  unregisterProject,
  getProject,
  getAllProjects,
  getProjectByChannel,
  startHealthChecks,
  stopHealthChecks,
  setDiscordClient,
  setDashboardCallback,
} from "./registry.ts";
import { registerCommandsInGuild, handleInteraction } from "./commands.ts";
import { initDashboard, updateDashboard, stopDashboard } from "./dashboard.ts";
import {
  postProgress,
  postReply,
  postAsk,
  postError,
  postPermissionPrompt,
} from "./threads.ts";
import {
  trackCommandStart,
  trackCommandEnd,
  trackCommandActivity,
  setAwaitingResponse,
  releaseCommandSlot,
  getTimedOutCommands,
} from "./active-commands.ts";
import {
  jsonResponse,
  errorResponse,
  parseBody,
  withCors,
  corsPreflightResponse,
  checkInternalRouteAccess,
  getClientIP,
} from "./http-helpers.ts";
import { processAttachments } from "./attachments.ts";
import { handleApiProjectsRoutes } from "./api-projects.ts";
import { handleApiFeaturesRoutes } from "./api-features.ts";
import { handleApiEpicsRoutes } from "./api-epics.ts";
import { handleApiBugsRoutes } from "./api-bugs.ts";
import { handleApiGitRoutes } from "./api-git.ts";
import { handleApiAuthRoutes, requireApiKeyOrAuth } from "./api-auth.ts";
import type { GuildTextBasedChannel } from "discord.js";

const CONFIG_DIR = join(homedir(), ".config", "beast-mode-discord");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

// Load and validate config

function loadConfig(): Config {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }

  if (!existsSync(CONFIG_FILE)) {
    botLog.error(
      `Config file not found: ${CONFIG_FILE} — ` +
        "create it with: { botToken, guildId, channelProjects, allowedUsers, adminUsers, botPort }"
    );
    process.exit(1);
  }

  try {
    const raw = readFileSync(CONFIG_FILE, "utf8");
    const parsed = ConfigSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      botLog.error("Config validation failed", { message: parsed.error.message });
      process.exit(1);
    }
    return parsed.data;
  } catch (err) {
    botLog.error("Failed to read config", { err: String(err) });
    process.exit(1);
  }
}

// Resolve a thread by ID from the client cache (or fetch it)

async function resolveChannel(
  client: Client,
  channelId: string
): Promise<GuildTextBasedChannel | null> {
  try {
    const channel = await client.channels.fetch(channelId);
    if (channel && "send" in channel) {
      return channel as GuildTextBasedChannel;
    }
    return null;
  } catch (err) {
    botLog.error(`Failed to resolve channel ${channelId}`, { err: String(err) });
    return null;
  }
}

// Per-thread ask state (maps threadId -> resolve callback)
const pendingAsks = new Map<string, (response: string | null) => void>();

// Discord callback routes — existing bot functionality extracted from inline if/else chain.

async function handleDiscordRoutes(
  req: Request,
  url: URL,
  client: Client,
  config: Config,
  clientIP?: string
): Promise<Response | null> {
  // GET /health
  if (req.method === "GET" && url.pathname === "/health") {
    return jsonResponse({
      status: "ok",
      uptime: process.uptime(),
      projects: getAllProjects().length,
      discordReady: client.isReady(),
    });
  }

  // GET /next-port — returns the next available channel port (for remote projects)
  if (req.method === "GET" && url.pathname === "/next-port") {
    const projects = getAllProjects();
    const usedPorts = projects.map((p) => p.port);
    let nextPort = 3850;
    while (usedPorts.includes(nextPort)) {
      nextPort++;
    }
    return jsonResponse({ port: nextPort });
  }

  // POST /register
  if (req.method === "POST" && url.pathname === "/register") {
    const parsed = await parseBody(req, ProjectEntrySchema);
    if (!parsed.ok) return parsed.response;

    botLog.info(`/register from ${clientIP ?? "unknown"}`, {
      project: parsed.data.name,
      port: parsed.data.port,
      host: parsed.data.host ?? "127.0.0.1",
    });

    // Check if project was previously offline or new
    const existing = getProject(parsed.data.name);
    const wasOffline = !existing || existing.status === "offline";

    registerProject(parsed.data);

    updateDashboard();

    // Notify the mapped Discord channel when an agent comes online
    if (wasOffline && client.isReady()) {
      const channelId = Object.entries(config.channelProjects).find(
        ([, projectName]) => projectName === parsed.data.name
      )?.[0];
      if (channelId) {
        resolveChannel(client, channelId).then((ch) => {
          if (ch) {
            ch.send(`🟢 **${parsed.data.name}** is now online.`).catch((err) =>
              botLog.warn("Failed to post online notification", { err: String(err) })
            );
          }
        });
      }
    }

    return jsonResponse({ ok: true, name: parsed.data.name });
  }

  // POST /unregister
  if (req.method === "POST" && url.pathname === "/unregister") {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return errorResponse("Invalid JSON body");
    }
    const { name } = body as { name?: string };
    if (!name) return errorResponse("Missing field: name");

    botLog.info(`/unregister from ${clientIP ?? "unknown"}`, { project: name });
    unregisterProject(name);

    updateDashboard();

    // Notify the mapped Discord channel when an agent goes offline
    if (client.isReady()) {
      const channelId = Object.entries(config.channelProjects).find(
        ([, projectName]) => projectName === name
      )?.[0];
      if (channelId) {
        resolveChannel(client, channelId).then((ch) => {
          if (ch) {
            ch.send(`🔴 **${name}** is now offline.`).catch((err) =>
              botLog.warn("Failed to post offline notification", { err: String(err) })
            );
          }
        });
      }
    }

    return jsonResponse({ ok: true });
  }

  // POST /progress — forward progress update to Discord thread
  if (req.method === "POST" && url.pathname === "/progress") {
    const parsed = await parseBody<ProgressPayload>(req, ProgressPayloadSchema);
    if (!parsed.ok) return parsed.response;
    const payload = parsed.data;

    // Progress is a liveness signal — reset the silence timer for this thread.
    trackCommandActivity(payload.threadId);

    const thread = await resolveChannel(client, payload.threadId);
    if (!thread) {
      return errorResponse(`Thread not found: ${payload.threadId}`, 404);
    }

    try {
      await postProgress(thread, payload);
      return jsonResponse({ ok: true });
    } catch (err) {
      botLog.error("/progress error", { err: String(err) });
      return errorResponse("Failed to post progress", 500);
    }
  }

  // POST /reply — post final response to Discord thread
  if (req.method === "POST" && url.pathname === "/reply") {
    const parsed = await parseBody<ReplyPayload>(req, ReplyPayloadSchema);
    if (!parsed.ok) return parsed.response;
    const payload = parsed.data;

    const thread = await resolveChannel(client, payload.threadId);
    if (!thread) {
      return errorResponse(`Thread not found: ${payload.threadId}`, 404);
    }

    try {
      await postReply(thread, payload);
      return jsonResponse({ ok: true });
    } catch (err) {
      botLog.error("/reply error", { err: String(err) });
      return errorResponse("Failed to post reply", 500);
    }
  }

  // POST /ask — post question to thread, wait for user response
  if (req.method === "POST" && url.pathname === "/ask") {
    const parsed = await parseBody<AskPayload>(req, AskPayloadSchema);
    if (!parsed.ok) return parsed.response;
    const payload = parsed.data;

    const thread = await resolveChannel(client, payload.threadId);
    if (!thread) {
      return errorResponse(`Thread not found: ${payload.threadId}`, 404);
    }

    // A pending question can block for a long time; suspend the silence timer so
    // a slow human reply isn't mistaken for a dead session.
    setAwaitingResponse(payload.threadId, true);
    try {
      const response = await postAsk(thread, payload);
      // postAsk returns null only when the timeout elapsed with no user reply. Signal
      // that distinctly so the channel can tell "user is away" apart from a real error
      // (an empty response field would be ambiguous and read as a network/empty result).
      if (response === null) {
        return jsonResponse({ ok: true, timedOut: true, response: null });
      }
      return jsonResponse({ ok: true, response });
    } catch (err) {
      botLog.error("/ask error", { err: String(err) });
      return errorResponse("Failed to handle ask", 500);
    } finally {
      setAwaitingResponse(payload.threadId, false);
    }
  }

  // POST /error — post error to thread
  if (req.method === "POST" && url.pathname === "/error") {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return errorResponse("Invalid JSON body");
    }
    const { threadId, error } = body as { threadId?: string; error?: string };
    if (!threadId || !error) return errorResponse("Missing fields: threadId, error");

    const thread = await resolveChannel(client, threadId);
    if (!thread) {
      return errorResponse(`Thread not found: ${threadId}`, 404);
    }

    try {
      await postError(thread, error);
      return jsonResponse({ ok: true });
    } catch (err) {
      botLog.error("/error route error", { err: String(err) });
      return errorResponse("Failed to post error", 500);
    }
  }

  // POST /permission-request — channel forwards a Claude Code permission prompt here.
  // Displays approve/deny buttons in the active Discord thread and holds the HTTP
  // connection open until the user responds (or 5-minute auto-deny timeout).
  if (req.method === "POST" && url.pathname === "/permission-request") {
    const parsed = await parseBody<PermissionRequestPayload>(
      req,
      PermissionRequestPayloadSchema
    );
    if (!parsed.ok) return parsed.response;
    const payload = parsed.data;

    const thread = await resolveChannel(client, payload.threadId);
    if (!thread) {
      return errorResponse(`Thread not found: ${payload.threadId}`, 404);
    }

    try {
      const approved = await postPermissionPrompt(thread, payload);
      botLog.info(
        `Permission ${approved ? "approved" : "denied"} for tool "${payload.toolName}"`,
        { permissionId: payload.permissionId, threadId: payload.threadId }
      );
      return jsonResponse({ ok: true, approved });
    } catch (err) {
      botLog.error("/permission-request error", { err: String(err) });
      // On error, auto-deny to avoid hanging the channel
      return jsonResponse({ ok: true, approved: false });
    }
  }

  // POST /command-complete — called by channel after beast_reply to release concurrency lock
  if (req.method === "POST" && url.pathname === "/command-complete") {
    const parsed = await parseBody<CommandCompletePayload>(req, CommandCompletePayloadSchema);
    if (!parsed.ok) return parsed.response;
    const { projectName, threadId, success } = parsed.data;

    // Release one slot. If queued commands remain, the next is now the active one.
    releaseCommandSlot(projectName, threadId);
    updateDashboard();

    botLog.info(`Command complete for project "${projectName}"`, {
      threadId,
      success,
    });

    return jsonResponse({ ok: true });
  }

  return null;
}

// Build and start the Bun HTTP server

function startHttpServer(client: Client, config: Config): ReturnType<typeof Bun.serve> {
  return Bun.serve({
    port: config.botPort,
    async fetch(req: Request, server: { requestIP(req: Request): { address: string } | null }) {
      const url = new URL(req.url);

      // Block external access to internal channel↔bot routes
      const clientIP = getClientIP(req, server);
      const blocked = checkInternalRouteAccess(req, url, server);
      if (blocked) {
        botLog.warn(`Blocked external request to ${url.pathname}`, { clientIP, method: req.method });
        return blocked;
      }

      // Handle OPTIONS preflight for /api/* and /auth/* routes
      if (req.method === "OPTIONS" && (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/"))) {
        return corsPreflightResponse();
      }

      // 1. Discord callback routes (existing functionality)
      const discordResponse = await handleDiscordRoutes(req, url, client, config, clientIP);
      if (discordResponse) return discordResponse;

      // 2. Auth routes (no auth middleware needed on these)
      const authResp = await handleApiAuthRoutes(req, url, config);
      if (authResp) return withCors(authResp);

      // 3. API routes require authentication
      if (url.pathname.startsWith("/api/")) {
        const session = requireApiKeyOrAuth(req, config);
        if (!session) {
          return withCors(errorResponse("Not authenticated", 401));
        }
      }

      // 4. API routes — apply CORS to all responses
      const apiHandlers = [
        handleApiProjectsRoutes,
        handleApiFeaturesRoutes,
        handleApiEpicsRoutes,
        handleApiBugsRoutes,
        handleApiGitRoutes,
      ];

      for (const handler of apiHandlers) {
        try {
          const response = await handler(req, url, config);
          if (response) return withCors(response);
        } catch (err) {
          botLog.error(`API route error: ${url.pathname}`, { err: String(err) });
          return withCors(errorResponse("Internal server error", 500));
        }
      }

      // 5. SPA static file serving
      if (req.method === "GET") {
        const webDistDir = join(import.meta.dir, "web", "dist");

        // Try to serve the exact file first
        const filePath = join(webDistDir, url.pathname === "/" ? "index.html" : url.pathname);
        const file = Bun.file(filePath);
        if (await file.exists()) {
          return new Response(file);
        }

        // SPA fallback: serve index.html for HTML requests
        const acceptsHtml = req.headers.get("Accept")?.includes("text/html");
        if (acceptsHtml) {
          const indexFile = Bun.file(join(webDistDir, "index.html"));
          if (await indexFile.exists()) {
            return new Response(indexFile);
          }
        }
      }

      // 6. 404 fallback
      return errorResponse("Not found", 404);
    },
    error(err: Error) {
      botLog.error("HTTP server error", { err: String(err) });
      return new Response("Internal server error", { status: 500 });
    },
  });
}

// Main

async function main() {
  const config = loadConfig();

  botLog.info("Starting Beast Mode Discord Bot", { port: config.botPort });

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.once("ready", async (readyClient) => {
    botLog.info(`Logged in as ${readyClient.user.tag}`);

    // Share the Discord client with the registry so it can post to threads on disconnect
    setDiscordClient(client, config);

    // Initialise the status dashboard (no-op if statusChannelId not configured)
    await initDashboard(client, config);

    // Wire health-check status transitions into the dashboard
    setDashboardCallback(updateDashboard);

    // Register slash commands in the configured guild
    try {
      await registerCommandsInGuild(
        config.botToken,
        readyClient.user.id,
        config.guildId
      );
    } catch (err) {
      botLog.error("Failed to register slash commands", { err: String(err) });
    }

    // Start health-check polling
    startHealthChecks();

    // Liveness checker — runs every 5 minutes. A long task is fine as long as it
    // keeps emitting progress (each progress/ask resets the thread's silence
    // timer). We only release a project's slot after a genuine stretch of silence,
    // which means the session has most likely died or stalled.
    setInterval(async () => {
      const timedOut = getTimedOutCommands();
      for (const cmd of timedOut) {
        const silentMin = Math.round((Date.now() - cmd.lastActivityAt) / 60000);
        botLog.warn(`Liveness timeout for project "${cmd.projectName}"`, {
          threadId: cmd.threadId,
          silentMin,
        });
        // Clear the whole project's depth — a dead session can't drain its queue.
        resetProjectConcurrency(cmd.projectName);
        trackCommandEnd(cmd.threadId);
        updateDashboard();

        const thread = await resolveChannel(client, cmd.threadId);
        if (thread) {
          await postError(
            thread,
            `No activity from **${cmd.projectName}** for ${silentMin} min — releasing its slot ` +
              `so new messages run. If the session is still alive its reply will still come through; ` +
              `otherwise it may have stopped (check the CLI).`
          ).catch((err) => botLog.error("Failed to post timeout error", { err: String(err) }));
        }
      }
    }, 5 * 60 * 1000); // check every 5 minutes
  });

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    try {
      await handleInteraction(interaction as ChatInputCommandInteraction, config);
    } catch (err) {
      botLog.error("Unhandled interaction error", { err: String(err) });
      try {
        const ci = interaction as ChatInputCommandInteraction;
        if (ci.deferred || ci.replied) {
          await ci.editReply("An unexpected error occurred.");
        } else {
          await ci.reply({ content: "An unexpected error occurred.", ephemeral: true });
        }
      } catch {
        // If we can't reply, just log and move on
      }
    }
  });

  // Forward plain messages from mapped channels to Claude Code
  client.on("messageCreate", async (message) => {
    // Ignore bots, system messages, and slash command interactions
    if (message.author.bot) return;
    if (!message.guild) return;
    if ((!message.content || message.content.trim().length === 0) && message.attachments.size === 0) return;

    // Ignore messages that start by mentioning someone else (e.g. "@user hey")
    const mentionMatch = message.content.match(/^<@!?(\d+)>/);
    if (mentionMatch && mentionMatch[1] !== client.user?.id) return;

    // Ignore replies unless they're replying to the bot
    if (message.reference?.messageId) {
      try {
        const replied = await message.channel.messages.fetch(message.reference.messageId);
        if (replied.author.id !== client.user?.id) return;
      } catch {
        // Can't fetch the referenced message — ignore it to be safe
        return;
      }
    }

    // Check if this channel is mapped to a project
    const project = getProjectByChannel(message.channelId, config);
    if (!project) return;

    // Check if user is allowed
    if (!isAllowedUser(config, message.author.id)) return;

    // Check if project is online
    if (project.status !== "online") {
      await message.reply(`Project **${project.name}** is currently offline. Start the Beast Mode channel and try again.`);
      return;
    }

    // Per-user hourly cap (silently ignored for plain messages to avoid spam).
    const rateCheck = checkUserRateLimit(message.author.id);
    if (!rateCheck.allowed) {
      return;
    }

    // If the project is mid-task we still forward — Claude Code queues the prompt
    // natively and runs it after the current turn. We just tell the user it's queued
    // instead of dropping it on the floor.
    const busy = isProjectBusy(project.name);
    const ahead = getProjectDepth(project.name);

    if (busy) {
      await message.reply(
        `📥 Queued — I'll get to this after the current task finishes` +
          (ahead > 1 ? ` (${ahead} ahead of it).` : ".")
      ).catch((err) => botLog.warn("Failed to post queued notice", { err: String(err) }));
    } else {
      // Show typing indicator so the user knows the bot is working
      await message.channel.sendTyping();
    }

    // Process any attachments (text files inlined, images downloaded to /tmp)
    const attachmentText = await processAttachments(message.attachments);

    // Route the message as a "message" command
    const payload = {
      command: "message",
      args: { text: (message.content || "") + attachmentText },
      userId: message.author.id,
      threadId: message.channelId,
      timestamp: new Date().toISOString(),
      queued: busy,
    };

    const body = JSON.stringify(payload);
    const signature = signPayload(project.hmacSecret, body);

    try {
      recordCommandStart(message.author.id, project.name);
      trackCommandStart(message.channelId, project.name);
      updateDashboard();

      const host = (project as any).host ?? "127.0.0.1";
      const res = await fetch(`http://${host}:${project.port}/command`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Beast-Signature": signature,
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        releaseCommandSlot(project.name, message.channelId);
        botLog.warn(`Failed to route message to project "${project.name}"`, {
          status: res.status,
        });
      }
    } catch (err) {
      releaseCommandSlot(project.name, message.channelId);
      botLog.warn(`Failed to route message to project "${project.name}"`, {
        err: String(err),
      });
    }
  });

  // Warn if OAuth2 is not configured
  if (!config.clientId || !config.webBaseUrl) {
    botLog.warn("OAuth2 not configured — web app auth will be disabled. Set clientId, clientSecret, and webBaseUrl in config.");
  }

  // Start HTTP server before connecting to Discord
  const server = startHttpServer(client, config);
  botLog.info(`HTTP server started`, { port: config.botPort });

  // Connect to Discord with exponential backoff retry (3 attempts: 0s, 2s, 4s)
  const MAX_LOGIN_ATTEMPTS = 3;
  let loginError: unknown;
  for (let attempt = 1; attempt <= MAX_LOGIN_ATTEMPTS; attempt++) {
    try {
      await client.login(config.botToken);
      loginError = null;
      break;
    } catch (err) {
      loginError = err;
      const message = err instanceof Error ? err.message : String(err);
      botLog.error(`Login attempt ${attempt}/${MAX_LOGIN_ATTEMPTS} failed`, { message });
      if (attempt < MAX_LOGIN_ATTEMPTS) {
        const delayMs = 2000 * (attempt - 1); // 0s first retry, 2s second retry
        if (delayMs > 0) {
          botLog.info(`Retrying login in ${delayMs / 1000}s...`);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }
  }
  if (loginError) {
    botLog.error("Failed to connect to Discord after all attempts. Exiting.");
    process.exit(1);
  }

  // Graceful shutdown
  async function shutdown(signal: string) {
    botLog.info(`Received ${signal}, shutting down...`);

    stopDashboard();
    stopHealthChecks();

    try {
      server.stop(true);
      botLog.info("HTTP server stopped.");
    } catch (err) {
      botLog.error("Error stopping HTTP server", { err: String(err) });
    }

    try {
      client.destroy();
      botLog.info("Discord client disconnected.");
    } catch (err) {
      botLog.error("Error destroying Discord client", { err: String(err) });
    }

    process.exit(0);
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  botLog.error("Fatal error", { err: String(err) });
  process.exit(1);
});
