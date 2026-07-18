/**
 * Beast Mode Discord Channel Server
 *
 * A per-project MCP server that bridges Claude Code (running locally in a
 * project) to the central Beast Mode Discord bot. It exposes three MCP tools
 * (beast_reply, beast_ask, beast_progress) that Claude uses to post messages
 * and questions into a Discord thread, and it serves a small HTTP API that the
 * bot calls to deliver incoming commands and user replies back to Claude.
 *
 * Start with: bun channel/server.ts --config=.beast-mode-channel.json
 * Config keys: projectName, channelPort, botUrl, hmacSecret
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createHmac, timingSafeEqual } from "crypto";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { z } from "zod";
import {
  ChannelConfigSchema,
  InboundCommandSchema,
} from "./types.ts";
import type { ChannelConfig, InboundCommand } from "./types.ts";
import { channelLog, httpLog, mcpLog } from "./logger.ts";
import {
  listBugs,
  parseBugFile,
  writeBugFile,
  nextBugId,
  ensureBugsDir,
} from "./bug-store.ts";
import type { Bug } from "./bug-store.ts";

// ---------------------------------------------------------------------------
// Command name mapping: Discord subcommands → Beast Mode skill names
// ---------------------------------------------------------------------------

const COMMAND_MAP: Record<string, string> = {
  suggest: "suggest-feature",
  plan: "plan-feature",
  start: "start-feature",
  continue: "continue-feature",
  review: "review-feature",
  audit: "audit-feature",
  update: "update-feature",
  discover: "discover-feature",
  document: "document-feature",
  proceed: "proceed",
  autorun: "autorun-feature",
  fix: "fix-feature",
  "fix-bug": "fix-bug",
  "update-master": "update-master",
  evaluate: "evaluate-feature",
  "review-ux": "review-ux",
  "review-pr": "review-pr",
  upgrade: "beast-mode:upgrade-beast-mode",
  "create-epic": "create-epic",
  "plan-epic": "plan-epic",
  "update-epic": "update-epic",
  "review-epic": "review-epic",
};

function mapCommandName(discordCommand: string): string {
  return COMMAND_MAP[discordCommand] ?? discordCommand;
}

// Build the content string for the channel notification.
// This becomes the body of the <channel> tag that Claude sees.
function buildCommandContent(command: InboundCommand): string {
  const skillName = mapCommandName(command.command);
  const argParts: string[] = [];
  if (command.args.feature) argParts.push(String(command.args.feature));
  if (command.args.epic) argParts.push(String(command.args.epic));
  if (command.args.bug) argParts.push(String(command.args.bug));
  if (command.args.pr) argParts.push(String(command.args.pr));
  if (command.args.description) argParts.push(String(command.args.description));
  if (command.args.prompt) argParts.push(String(command.args.prompt));
  const argStr = argParts.length > 0 ? " " + argParts.join(" ") : "";
  return `/${skillName}${argStr}`;
}

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

function loadConfig(): ChannelConfig {
  const configArg = process.argv.find((a) => a.startsWith("--config="));
  const configPath = configArg
    ? configArg.slice("--config=".length)
    : join(process.cwd(), ".beast-mode-channel.json");

  if (!existsSync(configPath)) {
    channelLog.error(
      `Config file not found: ${configPath} — ` +
        'create .beast-mode-channel.json with: { "projectName": "...", "channelPort": 3850, "botUrl": "http://127.0.0.1:3847", "hmacSecret": "..." }'
    );
    process.exit(1);
  }

  try {
    const raw = readFileSync(configPath, "utf8");
    const parsed = ChannelConfigSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      channelLog.error("Config validation failed", { message: parsed.error.message });
      process.exit(1);
    }
    return parsed.data;
  } catch (err) {
    channelLog.error("Failed to read config", { err: String(err) });
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// HMAC helpers (self-contained — no import from bot/)
// ---------------------------------------------------------------------------

function signPayload(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

function verifySignature(secret: string, payload: string, signature: string): boolean {
  const expected = signPayload(secret, payload);
  try {
    return timingSafeEqual(
      Buffer.from(expected, "hex"),
      Buffer.from(signature, "hex")
    );
  } catch {
    return false;
  }
}

// Build a signed fetch request to the central bot, with retry on failure.
async function signedPost(
  config: ChannelConfig,
  path: string,
  body: unknown,
  maxAttempts = 3
): Promise<Response> {
  const bodyStr = JSON.stringify(body);
  const sig = signPayload(config.hmacSecret, bodyStr);

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(`${config.botUrl}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Beast-Signature": sig,
        },
        body: bodyStr,
        signal: AbortSignal.timeout(30_000),
      });
      return res;
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        const delayMs = 1000 * Math.pow(2, attempt - 1);
        channelLog.warn(
          `signedPost to ${path} failed (attempt ${attempt}/${maxAttempts}), retrying in ${delayMs}ms...`
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

async function notifyCommandComplete(
  config: ChannelConfig,
  threadId: string,
  success: boolean
): Promise<void> {
  try {
    await signedPost(config, "/command-complete", {
      projectName: config.projectName,
      threadId,
      success,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    channelLog.warn(`Failed to notify command-complete: ${message}`);
  }
}

async function reportError(
  config: ChannelConfig,
  threadId: string,
  error: string
): Promise<void> {
  try {
    await signedPost(config, "/error", { threadId, error });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    channelLog.warn(`Failed to report error to bot: ${message}`);
  }
}

// ---------------------------------------------------------------------------
// Server state
// ---------------------------------------------------------------------------

let currentThreadId: string | null = null;
let currentUserId: string | null = null;
let currentProjectName: string | null = null;
let currentCommand: InboundCommand | null = null;

// ---------------------------------------------------------------------------
// MCP Server setup — using the official Claude Code channels protocol
// ---------------------------------------------------------------------------

// Prose surfaces (the system-prompt instructions and the AFK tool-result guidance)
// live in sibling .md files so they can be edited without touching code. Resolved
// relative to THIS module — the channel runs from the plugin dir while cwd is the
// user's project, so cwd-relative paths would not find them. Loaded once at startup;
// a missing file throws here (fail loud — these are essential to correct behavior).
function loadDoc(filename: string): string {
  return readFileSync(join(import.meta.dir, filename), "utf8").trim();
}

// Injected into Claude's system prompt (see `instructions` on the Server below).
const CHANNEL_INSTRUCTIONS = loadDoc("channel-instructions.md");

// Returned to Claude (via the beast_ask tool result) when the user does not answer
// within the timeout window. It must read as actionable in-the-moment instruction,
// because it IS the model's next signal — see rule 6 in channel-instructions.md for
// the same protocol stated in the system prompt.
const ASK_TIMEOUT_GUIDANCE = loadDoc("ask-timeout-guidance.md");

const server = new Server(
  {
    name: "beast-mode-discord-channel",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
      experimental: {
        // Required: registers this as a channel so Claude Code listens for notifications
        "claude/channel": {},
        // Optional: enables permission relay (Claude Code forwards tool approval prompts)
        "claude/channel/permission": {},
      },
    },
    // Added to Claude's system prompt so it knows how to handle channel events
    instructions: CHANNEL_INSTRUCTIONS,
  }
);

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const ProgressInputSchema = z.object({
  text: z.string().min(1),
  phaseName: z.string().optional(),
  percent: z.number().int().min(0).max(100).optional(),
});

const ReplyInputSchema = z.object({
  text: z.string().min(1),
  attachments: z
    .array(z.object({ name: z.string().min(1), content: z.string() }))
    .optional(),
});

const AskInputSchema = z.object({
  question: z.string().min(1),
  options: z.array(z.string()).optional(),
  // Default 5 min: long enough for a present user to answer, short enough that an
  // away user triggers the "AFK protocol" (proceed with the recommended option, or
  // stop and wait) in a reasonable window instead of blocking the session.
  timeout: z.number().int().positive().default(300000), // 5 minutes
});

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "beast_progress",
      description:
        "Report progress on the current Discord command. Call this periodically during long operations to keep the Discord user informed.",
      inputSchema: {
        type: "object" as const,
        properties: {
          text: { type: "string", description: "Human-readable progress message" },
          phaseName: { type: "string", description: "Current phase name (e.g. 'Planning', 'Implementing')" },
          percent: { type: "number", description: "Completion percentage (0-100)", minimum: 0, maximum: 100 },
        },
        required: ["text"],
      },
    },
    {
      name: "beast_reply",
      description:
        "Send the final response to the Discord thread. Call this as the last step of every Discord-triggered command.",
      inputSchema: {
        type: "object" as const,
        properties: {
          text: { type: "string", description: "Final response text to post in the Discord thread" },
          attachments: {
            type: "array",
            description: "Optional file attachments to include",
            items: {
              type: "object",
              properties: {
                name: { type: "string", description: "Filename" },
                content: { type: "string", description: "Text content" },
              },
              required: ["name", "content"],
            },
          },
        },
        required: ["text"],
      },
    },
    {
      name: "beast_ask",
      description:
        "Ask the user a question via the Discord thread and wait for their reply. Blocks until the user responds OR the timeout elapses (default 5 minutes). If the user does not reply in time they are treated as AWAY (this is NOT a network error) and the tool returns guidance: proceed with your recommended option, or stop and wait if the question genuinely needs them. When you offer choices, put the recommended option FIRST and/or end its label with '(Recommended)' so the away-fallback knows which to take.",
      inputSchema: {
        type: "object" as const,
        properties: {
          question: { type: "string", description: "Question to ask the user in Discord" },
          options: { type: "array", description: "Optional list of choices. List the recommended option first and/or label it '(Recommended)'.", items: { type: "string" } },
          timeout: { type: "number", description: "Milliseconds to wait before treating the user as away (default: 300000 = 5 minutes)" },
        },
        required: ["question"],
      },
    },
    {
      name: "list_bugs",
      description: "List bugs for the current project. Returns JSON array of bug summaries.",
      inputSchema: {
        type: "object" as const,
        properties: {
          status: { type: "string", description: "Filter by status: open, in-progress, closed" },
          priority: { type: "string", description: "Filter by priority: low, medium, high, critical" },
          linkedFeature: { type: "string", description: "Filter by linked feature name" },
        },
      },
    },
    {
      name: "get_bug",
      description: "Get full details of a specific bug by ID (e.g. BUG-001).",
      inputSchema: {
        type: "object" as const,
        properties: {
          id: { type: "string", description: "Bug ID (e.g. BUG-001)" },
        },
        required: ["id"],
      },
    },
    {
      name: "create_bug",
      description: "Create a new bug report for the current project.",
      inputSchema: {
        type: "object" as const,
        properties: {
          title: { type: "string", description: "Bug title" },
          description: { type: "string", description: "Bug description (markdown)" },
          priority: { type: "string", description: "Priority: low, medium, high, critical" },
          linkedFeature: { type: "string", description: "Feature name to link this bug to (optional)" },
        },
        required: ["title", "description", "priority"],
      },
    },
    {
      name: "update_bug",
      description: "Update an existing bug's fields.",
      inputSchema: {
        type: "object" as const,
        properties: {
          id: { type: "string", description: "Bug ID (e.g. BUG-001)" },
          title: { type: "string", description: "New title" },
          status: { type: "string", description: "New status: open, in-progress, closed" },
          priority: { type: "string", description: "New priority: low, medium, high, critical" },
          linkedFeature: { type: "string", description: "Feature to link to (empty string to unlink)" },
          description: { type: "string", description: "New description body (markdown)" },
        },
        required: ["id"],
      },
    },
  ],
}));

// Call tool handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (!currentThreadId) {
    return {
      content: [{ type: "text" as const, text: "Error: No active Discord command. No threadId is available." }],
      isError: true,
    };
  }

  const config = loadConfig();

  // beast_progress
  if (name === "beast_progress") {
    const parsed = ProgressInputSchema.safeParse(args);
    if (!parsed.success) {
      return { content: [{ type: "text" as const, text: `Invalid arguments: ${parsed.error.message}` }], isError: true };
    }
    const { text, phaseName, percent } = parsed.data;
    const body: Record<string, unknown> = { threadId: currentThreadId, text };
    if (phaseName !== undefined) body.phaseName = phaseName;
    if (percent !== undefined) body.percent = percent;

    try {
      const res = await signedPost(config, "/progress", body);
      if (!res.ok) {
        const errText = await res.text();
        return { content: [{ type: "text" as const, text: `Failed to post progress (HTTP ${res.status}): ${errText}` }], isError: true };
      }
      return { content: [{ type: "text" as const, text: "Progress posted to Discord." }] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text" as const, text: `Network error posting progress: ${message}` }], isError: true };
    }
  }

  // beast_reply
  if (name === "beast_reply") {
    const parsed = ReplyInputSchema.safeParse(args);
    if (!parsed.success) {
      return { content: [{ type: "text" as const, text: `Invalid arguments: ${parsed.error.message}` }], isError: true };
    }
    const { text, attachments } = parsed.data;
    const threadIdSnapshot = currentThreadId;
    const body: Record<string, unknown> = { threadId: threadIdSnapshot, text };
    if (attachments !== undefined) body.attachments = attachments;

    try {
      const res = await signedPost(config, "/reply", body);
      if (!res.ok) {
        const errText = await res.text();
        await notifyCommandComplete(config, threadIdSnapshot, false);
        return { content: [{ type: "text" as const, text: `Failed to post reply (HTTP ${res.status}): ${errText}` }], isError: true };
      }
      await notifyCommandComplete(config, threadIdSnapshot, true);
      return { content: [{ type: "text" as const, text: "Reply posted to Discord thread." }] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await notifyCommandComplete(config, threadIdSnapshot, false);
      return { content: [{ type: "text" as const, text: `Network error posting reply: ${message}` }], isError: true };
    }
  }

  // beast_ask — uses a long-lived HTTP request (no retry, no short timeout)
  // because the bot blocks until the user replies in Discord.
  if (name === "beast_ask") {
    const parsed = AskInputSchema.safeParse(args);
    if (!parsed.success) {
      return { content: [{ type: "text" as const, text: `Invalid arguments: ${parsed.error.message}` }], isError: true };
    }
    const { question, options, timeout } = parsed.data;
    const body: Record<string, unknown> = { threadId: currentThreadId, question, timeout };
    if (options !== undefined) body.options = options;

    try {
      const bodyStr = JSON.stringify(body);
      const sig = signPayload(config.hmacSecret, bodyStr);
      const res = await fetch(`${config.botUrl}/ask`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Beast-Signature": sig,
        },
        body: bodyStr,
        signal: AbortSignal.timeout(timeout + 10_000), // match the ask timeout + buffer
      });
      if (!res.ok) {
        const errText = await res.text();
        return { content: [{ type: "text" as const, text: `Failed to post question (HTTP ${res.status}): ${errText}. The bot is reachable but rejected the request — this is not the user being away.` }], isError: true };
      }
      const data = (await res.json()) as { ok: boolean; response?: string; timedOut?: boolean };
      // The user did not answer within the timeout window — they're away, NOT a
      // network problem. Return actionable guidance instead of an empty/ambiguous answer.
      if (data.timedOut) {
        return { content: [{ type: "text" as const, text: ASK_TIMEOUT_GUIDANCE }] };
      }
      return { content: [{ type: "text" as const, text: data.response ?? "" }] };
    } catch (err) {
      // A genuine transport failure (bot down / unreachable / request aborted before
      // any reply). This is distinct from the user being away — say so explicitly so
      // Claude doesn't mistake an AFK user for a network outage (or vice-versa).
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text" as const, text: `⚠️ Could not reach the Discord bot to deliver the question — this is a genuine connectivity/transport error (${message}), NOT the user being away. Retry once; if it still fails the bot may be down. In that case fall back to the away protocol: take the recommended option if the question had one, otherwise stop and try beast_reply to surface the problem.` }],
        isError: true,
      };
    }
  }

  // list_bugs
  if (name === "list_bugs") {
    const bugsDir = join(process.cwd(), "docs", "bugs");
    const filters: { status?: string; priority?: string; linkedFeature?: string } = {};
    if (args?.status) filters.status = String(args.status);
    if (args?.priority) filters.priority = String(args.priority);
    if (args?.linkedFeature) filters.linkedFeature = String(args.linkedFeature);
    const bugs = listBugs(bugsDir, Object.keys(filters).length > 0 ? filters : undefined);
    const summaries = bugs.map((b) => ({
      id: b.frontmatter.id,
      title: b.frontmatter.title,
      status: b.frontmatter.status,
      priority: b.frontmatter.priority,
      linkedFeature: b.frontmatter.linkedFeature,
    }));
    return { content: [{ type: "text" as const, text: JSON.stringify(summaries, null, 2) }] };
  }

  // get_bug
  if (name === "get_bug") {
    const bugsDir = join(process.cwd(), "docs", "bugs");
    const bugPath = join(bugsDir, `${args?.id}.md`);
    const bug = parseBugFile(bugPath);
    if (!bug) return { content: [{ type: "text" as const, text: `Bug ${args?.id} not found` }], isError: true };
    return { content: [{ type: "text" as const, text: JSON.stringify({ ...bug.frontmatter, body: bug.body }, null, 2) }] };
  }

  // create_bug
  if (name === "create_bug") {
    const bugsDir = join(process.cwd(), "docs", "bugs");
    ensureBugsDir(bugsDir);
    const id = nextBugId(bugsDir);
    const now = new Date().toISOString();
    const bug: Bug = {
      frontmatter: {
        id,
        title: String(args?.title),
        status: "open",
        priority: String(args?.priority) as Bug["frontmatter"]["priority"],
        createdAt: now,
        updatedAt: now,
      },
      body: String(args?.description),
    };
    if (args?.linkedFeature) bug.frontmatter.linkedFeature = String(args.linkedFeature);
    writeBugFile(join(bugsDir, `${id}.md`), bug);
    return { content: [{ type: "text" as const, text: `Created ${id}: ${bug.frontmatter.title}` }] };
  }

  // update_bug
  if (name === "update_bug") {
    const bugsDir = join(process.cwd(), "docs", "bugs");
    const bugPath = join(bugsDir, `${args?.id}.md`);
    const existing = parseBugFile(bugPath);
    if (!existing) return { content: [{ type: "text" as const, text: `Bug ${args?.id} not found` }], isError: true };
    if (args?.title) existing.frontmatter.title = String(args.title);
    if (args?.status) existing.frontmatter.status = String(args.status) as Bug["frontmatter"]["status"];
    if (args?.priority) existing.frontmatter.priority = String(args.priority) as Bug["frontmatter"]["priority"];
    if (args?.linkedFeature !== undefined) {
      if (args.linkedFeature === "") delete existing.frontmatter.linkedFeature;
      else existing.frontmatter.linkedFeature = String(args.linkedFeature);
    }
    if (args?.description) existing.body = String(args.description);
    existing.frontmatter.updatedAt = new Date().toISOString();
    writeBugFile(bugPath, existing);
    return { content: [{ type: "text" as const, text: `Updated ${args.id}: ${existing.frontmatter.title}` }] };
  }

  return { content: [{ type: "text" as const, text: `Unknown tool: ${name}` }], isError: true };
});

// ---------------------------------------------------------------------------
// Permission relay — official Claude Code channels protocol
// ---------------------------------------------------------------------------
// Claude Code sends notifications/claude/channel/permission_request when a
// tool approval dialog opens. We forward it to Discord via the bot, wait for
// the user's verdict, then emit notifications/claude/channel/permission back
// with request_id + behavior ('allow'/'deny').

const PermissionRequestNotificationSchema = z.object({
  method: z.literal("notifications/claude/channel/permission_request"),
  params: z.object({
    request_id: z.string(),
    tool_name: z.string(),
    description: z.string(),
    input_preview: z.string(),
  }),
});

function registerPermissionNotificationHandler(config: ChannelConfig): void {
  try {
    if (typeof (server as any).setNotificationHandler === "function") {
      (server as any).setNotificationHandler(
        PermissionRequestNotificationSchema,
        async (notification: {
          params: { request_id: string; tool_name: string; description: string; input_preview: string };
        }) => {
          if (!currentThreadId || !currentUserId) {
            mcpLog.warn("Received permission_request but no active thread/user");
            return;
          }

          const { request_id, tool_name, description, input_preview } = notification.params;

          // Forward to the bot's /permission-request endpoint which displays
          // Approve/Deny buttons in the Discord thread and holds the connection
          // until the user responds (or 5-min timeout).
          let toolInput: Record<string, unknown> | undefined;
          try {
            toolInput = JSON.parse(input_preview);
          } catch {
            // input_preview may be truncated JSON — pass as description instead
          }

          const body: Record<string, unknown> = {
            threadId: currentThreadId,
            permissionId: request_id,
            toolName: tool_name,
            userId: currentUserId,
            description,
          };
          if (toolInput !== undefined) body.toolInput = toolInput;

          const bodyStr = JSON.stringify(body);
          const sig = signPayload(config.hmacSecret, bodyStr);

          let approved = false;
          try {
            const res = await fetch(`${config.botUrl}/permission-request`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Beast-Signature": sig,
              },
              body: bodyStr,
              signal: AbortSignal.timeout(6 * 60 * 1000),
            });
            if (res.ok) {
              const data = (await res.json()) as { ok: boolean; approved: boolean };
              approved = data.approved === true;
            } else {
              mcpLog.warn(`Permission request failed (HTTP ${res.status}) — auto-denying`);
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            mcpLog.warn(`Permission request network error: ${message} — auto-denying`);
          }

          // Emit verdict back to Claude Code using the official protocol
          server.notification({
            method: "notifications/claude/channel/permission",
            params: {
              request_id,
              behavior: approved ? "allow" : "deny",
            },
          }).catch((err: unknown) => {
            mcpLog.warn("Failed to emit permission verdict notification", { err: String(err) });
          });
        }
      );
      mcpLog.info("Permission notification handler registered");
    }
  } catch (err) {
    mcpLog.warn("Could not register permission notification handler", { err: String(err) });
  }
}

// ---------------------------------------------------------------------------
// HTTP server — receives commands from the central bot
// ---------------------------------------------------------------------------

function startHttpServer(config: ChannelConfig): ReturnType<typeof Bun.serve> {
  return Bun.serve({
    port: config.channelPort,
    hostname: "0.0.0.0",
    async fetch(req: Request) {
      const url = new URL(req.url);

      // GET /health
      if (req.method === "GET" && url.pathname === "/health") {
        return jsonResponse({
          status: "ok",
          project: config.projectName,
          uptime: process.uptime(),
          activeThread: currentThreadId,
        });
      }

      // POST /command — receive a Beast Mode command from the central bot
      if (req.method === "POST" && url.pathname === "/command") {
        let rawBody: string;
        try {
          rawBody = await req.text();
        } catch {
          return errorResponse("Failed to read request body");
        }

        const sig = req.headers.get("X-Beast-Signature") ?? "";
        if (!verifySignature(config.hmacSecret, rawBody, sig)) {
          httpLog.warn("Rejected /command request — invalid HMAC signature");
          return errorResponse("Invalid signature", 401);
        }

        let body: unknown;
        try {
          body = JSON.parse(rawBody);
        } catch {
          return errorResponse("Invalid JSON body");
        }

        const parsed = InboundCommandSchema.safeParse(body);
        if (!parsed.success) {
          return errorResponse(`Validation error: ${parsed.error.message}`);
        }

        const command = parsed.data;

        // Store state for use by tools
        currentThreadId = command.threadId;
        currentUserId = command.userId;
        currentCommand = command;

        const isMessage = command.command === "message";
        const skillName = isMessage ? "message" : mapCommandName(command.command);

        channelLog.info(
          isMessage
            ? `Received message from Discord user`
            : `Received command: /${command.command} → /${skillName}`,
          { userId: command.userId, threadId: command.threadId }
        );

        // Post "starting"/"queued" confirmation for slash commands (not plain messages)
        if (!isMessage) {
          signedPost(config, "/progress", {
            threadId: command.threadId,
            text: command.queued
              ? `Received \`/${skillName}\` — queued; will start once the current task finishes.`
              : `Received \`/${skillName}\` — starting now...`,
            phaseName: command.queued ? "Queued" : "Starting",
          }).catch((err) => {
            channelLog.warn("Failed to post command-started message", { err: String(err) });
          });
        }

        // Emit channel notification using the official Claude Code protocol.
        const emitNotification = async () => {
          try {
            const content = isMessage
              ? String(command.args.text ?? "")
              : buildCommandContent(command);
            const meta: Record<string, string> = {
              type: isMessage ? "message" : "command",
              channel_id: command.threadId,
              user_id: command.userId,
            };
            if (!isMessage) {
              meta.command = skillName;
            }

            await server.notification({
              method: "notifications/claude/channel",
              params: { content, meta },
            });
          } catch (err) {
            mcpLog.error("Failed to emit channel notification", { err: String(err) });
            const message = err instanceof Error ? err.message : String(err);
            await reportError(
              config,
              command.threadId,
              `Command could not be delivered to Claude Code: ${message}. ` +
                `The MCP session may not be active yet.`
            );
            await notifyCommandComplete(config, command.threadId, false);
          }
        };
        emitNotification();

        return jsonResponse({ ok: true });
      }

      return errorResponse("Not found", 404);
    },
    error(err: Error) {
      httpLog.error("HTTP server error", { err: String(err) });
      return new Response("Internal server error", { status: 500 });
    },
  });
}

// ---------------------------------------------------------------------------
// Bot registration lifecycle
// ---------------------------------------------------------------------------

let botHealthCheckInterval: ReturnType<typeof setInterval> | null = null;
let botWasUnreachable = false;

async function registerWithBot(config: ChannelConfig): Promise<boolean> {
  const projectPath = process.cwd();
  const body = {
    name: config.projectName,
    path: projectPath,
    port: config.channelPort,
    host: config.channelHost ?? "127.0.0.1",
    hmacSecret: config.hmacSecret,
    status: "online" as const,
    lastSeen: new Date().toISOString(),
  };

  try {
    const res = await signedPost(config, "/register", body);
    if (res.ok) {
      channelLog.info(`Registered project "${config.projectName}" with bot`, { botUrl: config.botUrl });
      return true;
    } else {
      const errText = await res.text();
      channelLog.warn(`Bot registration failed (HTTP ${res.status})`, { errText });
      return false;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    channelLog.warn(`Could not reach bot for registration: ${message}`);
    return false;
  }
}

async function registerWithBotWithRetry(config: ChannelConfig): Promise<void> {
  const MAX_ATTEMPTS = 10;
  const RETRY_DELAY_MS = 30_000;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const ok = await registerWithBot(config);
    if (ok) return;

    if (attempt < MAX_ATTEMPTS) {
      channelLog.warn(
        `Registration attempt ${attempt}/${MAX_ATTEMPTS} failed — retrying in ${RETRY_DELAY_MS / 1000}s...`
      );
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }

  channelLog.warn(
    `Could not register with bot after ${MAX_ATTEMPTS} attempts — ` +
      `channel is running but will not receive commands until bot is reachable`
  );
}

async function checkBotHealth(config: ChannelConfig): Promise<void> {
  try {
    const res = await fetch(`${config.botUrl}/health`, {
      signal: AbortSignal.timeout(5000),
    });

    if (res.ok) {
      if (botWasUnreachable) {
        channelLog.info(`Bot is reachable again at ${config.botUrl} — re-registering...`);
        botWasUnreachable = false;
        await registerWithBot(config);
      }
    } else {
      if (!botWasUnreachable) {
        channelLog.warn(`Bot health check returned HTTP ${res.status} — bot may be degraded`);
        botWasUnreachable = true;
      }
    }
  } catch {
    if (!botWasUnreachable) {
      channelLog.warn(`Bot at ${config.botUrl} is unreachable — will retry in 60s`);
      botWasUnreachable = true;
    }
  }
}

function startBotHealthChecks(config: ChannelConfig): void {
  if (botHealthCheckInterval) return;
  botHealthCheckInterval = setInterval(() => {
    checkBotHealth(config).catch((err) => {
      channelLog.warn("Bot health check error", { err: String(err) });
    });
  }, 60_000);
  channelLog.info("Bot health-check polling started (60s interval)");
}

function stopBotHealthChecks(): void {
  if (botHealthCheckInterval) {
    clearInterval(botHealthCheckInterval);
    botHealthCheckInterval = null;
  }
}

async function unregisterFromBot(config: ChannelConfig): Promise<void> {
  const body = { name: config.projectName };
  try {
    const res = await signedPost(config, "/unregister", body);
    if (res.ok) {
      channelLog.info(`Unregistered project "${config.projectName}" from bot`);
    }
  } catch {
    // Best-effort — we're shutting down anyway
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const config = loadConfig();
  currentProjectName = config.projectName;

  channelLog.info("Starting Beast Mode Discord Channel", {
    project: config.projectName,
    port: config.channelPort,
    botUrl: config.botUrl,
  });

  // Connect MCP over stdio FIRST — must happen before anything else touches stdout.
  // The official channels protocol requires the MCP handshake to complete before
  // any other I/O on stdout.
  const transport = new StdioServerTransport();
  await server.connect(transport);
  mcpLog.info("MCP server connected via stdio");

  // Register permission relay handler
  registerPermissionNotificationHandler(config);

  // Start HTTP server after MCP is connected
  const httpServer = startHttpServer(config);
  channelLog.info(`HTTP server started`, { port: config.channelPort });

  // Register with the central bot (retries up to 10 times)
  registerWithBotWithRetry(config).catch((err) => {
    channelLog.warn("Registration retry loop error", { err: String(err) });
  });

  // Start periodic bot health checks
  startBotHealthChecks(config);

  // Graceful shutdown
  async function shutdown(signal: string) {
    channelLog.info(`Received ${signal}, shutting down...`);
    stopBotHealthChecks();
    await unregisterFromBot(config);
    try {
      httpServer.stop(true);
      channelLog.info("HTTP server stopped");
    } catch (err) {
      channelLog.error("Error stopping HTTP server", { err: String(err) });
    }
    process.exit(0);
  }

  process.on("SIGINT", () => shutdown("SIGINT").catch(() => process.exit(1)));
  process.on("SIGTERM", () => shutdown("SIGTERM").catch(() => process.exit(1)));

  process.stdin.on("close", () => {
    channelLog.info("stdin closed — unregistering from bot...");
    stopBotHealthChecks();
    unregisterFromBot(config)
      .catch(() => {})
      .finally(() => process.exit(0));
  });
}

main().catch((err) => {
  channelLog.error("Fatal error", { err: String(err) });
  process.exit(1);
});
