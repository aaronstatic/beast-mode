import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { Client } from "discord.js";
import type { Config, ProjectEntry, ProjectsFile } from "./types.ts";
import { ProjectsFileSchema } from "./types.ts";
import { getActiveCommandsForProject, trackCommandEnd } from "./active-commands.ts";
import { resetProjectConcurrency } from "./security.ts";
import { registryLog } from "./logger.ts";

const CONFIG_DIR = join(homedir(), ".config", "beast-mode-discord");
const PROJECTS_FILE = join(CONFIG_DIR, "projects.json");
const HEALTH_INTERVAL_MS = 30_000;

// In-memory registry
const registry = new Map<string, ProjectEntry>();

let healthCheckInterval: ReturnType<typeof setInterval> | null = null;

// Dashboard update callback — set by bot.ts to avoid circular import
let onDashboardUpdate: (() => void) | null = null;

export function setDashboardCallback(fn: () => void): void {
  onDashboardUpdate = fn;
}

// Discord client and config references — set by bot.ts after login so registry can post to channels
let discordClient: Client | null = null;
let botConfig: Config | null = null;

export function setDiscordClient(client: Client, config?: Config): void {
  discordClient = client;
  if (config) botConfig = config;
}

// File I/O

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function loadFromDisk(): void {
  ensureConfigDir();
  if (!existsSync(PROJECTS_FILE)) {
    return;
  }
  try {
    const raw = readFileSync(PROJECTS_FILE, "utf8");
    const parsed = ProjectsFileSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      registryLog.warn("projects.json parse error, starting fresh", { message: parsed.error.message });
      return;
    }
    for (const [name, entry] of Object.entries(parsed.data)) {
      registry.set(name, { name, ...entry });
    }
    registryLog.info(`Loaded ${registry.size} project(s) from disk`);
  } catch (err) {
    registryLog.warn("Failed to load projects.json", { err: String(err) });
  }
}

function saveToDisk(): void {
  ensureConfigDir();
  const data: ProjectsFile = {};
  for (const [name, entry] of registry.entries()) {
    data[name] = {
      path: entry.path,
      port: entry.port,
      host: entry.host ?? "127.0.0.1",
      hmacSecret: entry.hmacSecret,
      status: entry.status,
      lastSeen: entry.lastSeen,
    };
  }
  writeFileSync(PROJECTS_FILE, JSON.stringify(data, null, 2), "utf8");
}

// CRUD

export function registerProject(entry: ProjectEntry): void {
  // If a different project was previously registered on the same host:port,
  // mark it offline to prevent ghost online/offline notifications from health checks.
  const entryHost = entry.host ?? "127.0.0.1";
  for (const [name, existing] of registry.entries()) {
    if (
      name !== entry.name &&
      existing.port === entry.port &&
      (existing.host ?? "127.0.0.1") === entryHost &&
      existing.status === "online"
    ) {
      existing.status = "offline";
      registryLog.info(
        `Marked "${name}" offline — port ${entry.port} now used by "${entry.name}"`
      );
    }
  }

  registry.set(entry.name, { ...entry, status: "online", lastSeen: new Date().toISOString() });
  saveToDisk();
  registryLog.info(`Registered project: ${entry.name}`, { port: entry.port });
}

export function unregisterProject(name: string): void {
  const entry = registry.get(name);
  if (entry) {
    entry.status = "offline";
    saveToDisk();
    registryLog.info(`Marked project offline: ${name}`);
  }
}

export function getProject(name: string): ProjectEntry | undefined {
  return registry.get(name);
}

export function getProjectByChannel(
  channelId: string,
  config: Config
): ProjectEntry | undefined {
  const projectName = config.channelProjects[channelId];
  if (!projectName) return undefined;
  return registry.get(projectName);
}

export function getAllProjects(): ProjectEntry[] {
  return Array.from(registry.values());
}

/**
 * Resolve the effective local filesystem path for a project.
 * If a pathMapping exists in config, use that; otherwise use the registered path.
 */
export function resolveProjectPath(project: ProjectEntry, config: Config): string {
  return config.pathMappings[project.name] ?? project.path;
}

// Health-check polling

async function checkProjectHealth(entry: ProjectEntry): Promise<void> {
  const url = `http://${entry.host ?? "127.0.0.1"}:${entry.port}/health`;
  const wasOnline = entry.status === "online";

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      // Verify the responding server is actually the expected project,
      // not a different project that happens to be running on the same port.
      try {
        const data = (await res.json()) as { project?: string };
        if (data.project && data.project !== entry.name) {
          registryLog.warn(
            `Health check for "${entry.name}" got response from "${data.project}" on port ${entry.port} — port conflict, marking offline`
          );
          entry.status = "offline";
        } else {
          entry.status = "online";
          entry.lastSeen = new Date().toISOString();
        }
      } catch {
        // Can't parse response body — still treat as online (backwards compat)
        entry.status = "online";
        entry.lastSeen = new Date().toISOString();
      }
    } else {
      entry.status = "offline";
    }
  } catch {
    entry.status = "offline";
  }

  saveToDisk();

  // Notify dashboard on any status transition
  if (wasOnline !== (entry.status === "online") && onDashboardUpdate) {
    onDashboardUpdate();
  }

  // If the project just went offline, notify the channel and release locks
  if (wasOnline && entry.status === "offline" && discordClient) {
    // Post offline notification to the project's mapped channel
    if (botConfig) {
      const channelId = Object.entries(botConfig.channelProjects).find(
        ([, projectName]) => projectName === entry.name
      )?.[0];
      if (channelId) {
        try {
          const ch = await discordClient.channels.fetch(channelId);
          if (ch && "send" in ch) {
            await (ch as import("discord.js").GuildTextBasedChannel).send(
              `🔴 **${entry.name}** went offline.`
            );
          }
        } catch (err) {
          registryLog.warn("Failed to post offline notification", { err: String(err) });
        }
      }
    }

    const activeCmds = getActiveCommandsForProject(entry.name);
    for (const cmd of activeCmds) {
      try {
        const channel = await discordClient.channels.fetch(cmd.threadId);
        if (channel && "send" in channel) {
          const threads = await import("./threads.ts");
          await threads.postError(
            channel as import("discord.js").GuildTextBasedChannel,
            `Project "${entry.name}" went offline while your command was running. ` +
              `Please restart the Beast Mode channel and try again.`
          );
        }
      } catch (err) {
        registryLog.error(`Failed to post disconnect error to channel ${cmd.threadId}`, { err: String(err) });
      }

      trackCommandEnd(cmd.threadId);
    }

    if (activeCmds.length > 0) {
      // Fully clear the project's depth — an offline session can't drain any
      // commands still queued behind the active one.
      resetProjectConcurrency(entry.name);
      registryLog.warn(
        `Project "${entry.name}" went offline with ${activeCmds.length} active command(s) — released locks`,
        { project: entry.name, activeCmds: activeCmds.length }
      );
    }
  }
}

async function runHealthChecks(): Promise<void> {
  const projects = getAllProjects();
  if (projects.length === 0) return;

  await Promise.allSettled(projects.map(checkProjectHealth));
}

export function startHealthChecks(): void {
  if (healthCheckInterval) return;
  healthCheckInterval = setInterval(() => {
    runHealthChecks().catch((err) =>
      registryLog.error("Health check error", { err: String(err) })
    );
  }, HEALTH_INTERVAL_MS);
  registryLog.info("Health-check polling started (30s interval)");
}

export function stopHealthChecks(): void {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
    registryLog.info("Health-check polling stopped");
  }
}

// Initialise on import
loadFromDisk();
