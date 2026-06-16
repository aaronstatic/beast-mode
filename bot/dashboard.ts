import { EmbedBuilder } from "discord.js";
import type { Client, TextChannel } from "discord.js";
import type { Config } from "./types.ts";
import type { ProjectEntry } from "./types.ts";
import type { ActiveCommand } from "./active-commands.ts";
import { getAllProjects } from "./registry.ts";
import { getActiveCommandsForProject } from "./active-commands.ts";
import { dashboardLog } from "./logger.ts";

// Module state
let enabled = false;
let dashboardChannel: TextChannel | null = null;
let dashboardMessageId: string | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let pollingInterval: ReturnType<typeof setInterval> | null = null;
let discordClient: Client | null = null;

// ---------------------------------------------------------------------------
// Exported lifecycle functions
// ---------------------------------------------------------------------------

export async function initDashboard(client: Client, config: Config): Promise<void> {
  if (!config.statusChannelId) {
    enabled = false;
    dashboardLog.info("No statusChannelId configured — dashboard disabled");
    return;
  }

  discordClient = client;

  let channel: Awaited<ReturnType<typeof client.channels.fetch>>;
  try {
    channel = await client.channels.fetch(config.statusChannelId);
  } catch (err) {
    dashboardLog.warn("Failed to fetch status channel", {
      channelId: config.statusChannelId,
      err: String(err),
    });
    return;
  }

  if (!channel || !("send" in channel)) {
    dashboardLog.warn("Status channel not found or is not a text-based channel", {
      channelId: config.statusChannelId,
    });
    return;
  }

  dashboardChannel = channel as TextChannel;

  // Search last 50 messages for an existing dashboard message authored by this bot
  try {
    const messages = await dashboardChannel.messages.fetch({ limit: 50 });
    const existing = messages.find(
      (msg) =>
        msg.author.id === client.user?.id &&
        msg.embeds.length > 0 &&
        msg.embeds[0].title === "Beast Mode Status"
    );
    if (existing) {
      dashboardMessageId = existing.id;
      dashboardLog.info("Found existing dashboard message", { messageId: dashboardMessageId });
    }
  } catch (err) {
    dashboardLog.warn("Could not search channel history for existing dashboard message", {
      err: String(err),
    });
  }

  enabled = true;
  dashboardLog.info("Dashboard initialised", { channelId: config.statusChannelId });

  pollingInterval = setInterval(() => updateDashboard(), 30_000);
  updateDashboard();
}

export function updateDashboard(): void {
  if (!enabled || !discordClient?.isReady()) return;

  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  debounceTimer = setTimeout(() => {
    renderDashboard().catch((err) => {
      dashboardLog.error("Unhandled error in renderDashboard", { err: String(err) });
    });
  }, 50);
}

export function stopDashboard(): void {
  if (pollingInterval !== null) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  enabled = false;
  dashboardLog.info("Dashboard stopped");
}

// ---------------------------------------------------------------------------
// Internal render logic
// ---------------------------------------------------------------------------

async function renderDashboard(): Promise<void> {
  if (!dashboardChannel) return;

  try {
    const projects = getAllProjects();
    const projectCommands = new Map<string, ActiveCommand[]>();
    for (const project of projects) {
      projectCommands.set(project.name, getActiveCommandsForProject(project.name));
    }

    const embed = buildEmbed(projects, projectCommands);

    if (dashboardMessageId) {
      try {
        const existing = await dashboardChannel.messages.fetch(dashboardMessageId);
        await existing.edit({ embeds: [embed] });
        return;
      } catch (err) {
        const message = String(err);
        // 404 / Unknown Message — the message was deleted; fall through to send a new one
        if (
          message.includes("Unknown Message") ||
          message.includes("10008") ||
          message.includes("404")
        ) {
          dashboardLog.info("Dashboard message was deleted — will send a new one");
          dashboardMessageId = null;
        } else {
          dashboardLog.error("Failed to edit dashboard message", { err: message });
          return;
        }
      }
    }

    // Send a fresh message
    const sent = await dashboardChannel.send({ embeds: [embed] });
    dashboardMessageId = sent.id;
    dashboardLog.info("Sent new dashboard message", { messageId: dashboardMessageId });
  } catch (err) {
    dashboardLog.error("renderDashboard error", { err: String(err) });
    // Never re-throw — dashboard must not crash the bot
  }
}

// ---------------------------------------------------------------------------
// Embed builder
// ---------------------------------------------------------------------------

function buildEmbed(
  projects: ProjectEntry[],
  projectCommands: Map<string, ActiveCommand[]>
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle("Beast Mode Status")
    .setFooter({ text: "Last updated" })
    .setTimestamp();

  if (projects.length === 0) {
    embed.setDescription("No projects registered.");
    embed.setColor(0x6b7280);
    return embed;
  }

  // Sort: busy first, then online, then offline
  const sorted = [...projects].sort((a, b) => {
    const aCommands = projectCommands.get(a.name) ?? [];
    const bCommands = projectCommands.get(b.name) ?? [];
    const aScore = aCommands.length > 0 ? 0 : a.status === "online" ? 1 : 2;
    const bScore = bCommands.length > 0 ? 0 : b.status === "online" ? 1 : 2;
    return aScore - bScore;
  });

  // Determine overall color
  let anyBusy = false;
  let allOnline = true;
  let allOffline = true;

  for (const project of projects) {
    const commands = projectCommands.get(project.name) ?? [];
    if (commands.length > 0) {
      anyBusy = true;
    }
    if (project.status === "online") {
      allOffline = false;
    } else {
      allOnline = false;
    }
  }

  let color: number;
  if (anyBusy) {
    color = 0xf59e0b; // amber — busy
  } else if (allOnline) {
    color = 0x22c55e; // green
  } else if (allOffline) {
    color = 0xef4444; // red
  } else {
    color = 0xf59e0b; // amber — mixed
  }

  embed.setColor(color);

  // Build fields with truncation guard
  // Discord embed total limit is 6000 chars; we guard at 5800 to leave room for title/footer.
  const CHAR_LIMIT = 5800;
  // Account for title already consumed
  let charCount = "Beast Mode Status".length + "Last updated".length;
  let skippedCount = 0;

  const fieldsToAdd: Array<{ name: string; value: string }> = [];

  for (const project of sorted) {
    const commands = projectCommands.get(project.name) ?? [];
    const { icon, detail } = buildFieldParts(project, commands);
    const fieldName = `${icon} ${project.name}`;
    // Discord requires non-empty field value; use zero-width space when no detail
    const fieldValue = detail || "\u200b";
    const fieldChars = fieldName.length + fieldValue.length;

    if (charCount + fieldChars > CHAR_LIMIT) {
      skippedCount = projects.length - fieldsToAdd.length;
      break;
    }

    charCount += fieldChars;
    fieldsToAdd.push({ name: fieldName, value: fieldValue });
  }

  for (const field of fieldsToAdd) {
    embed.addFields({ name: field.name, value: field.value, inline: false });
  }

  if (skippedCount > 0) {
    const truncMsg = `...and ${skippedCount} more project${skippedCount === 1 ? "" : "s"}`;
    const existing = embed.data.description ?? "";
    embed.setDescription(existing ? `${existing}\n${truncMsg}` : truncMsg);
  }

  return embed;
}

function buildFieldParts(project: ProjectEntry, commands: ActiveCommand[]): { icon: string; detail: string } {
  if (project.status === "offline") {
    return { icon: "🔴", detail: "" };
  } else if (commands.length > 0) {
    const cmd = commands[0];
    const elapsed = formatElapsed(cmd.startedAt);
    const extra = commands.length > 1 ? ` +${commands.length - 1} more` : "";
    return { icon: "🟠", detail: `⏱ ${elapsed}${extra}` };
  }
  return { icon: "🟢", detail: "" };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelativeTime(iso: string): string {
  let diffMs: number;
  try {
    diffMs = Date.now() - new Date(iso).getTime();
  } catch {
    return "unknown";
  }

  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "just now";

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;

  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays}d ago`;
}

function formatElapsed(startedAt: number): string {
  const diffMs = Math.max(0, Date.now() - startedAt);
  const totalSec = Math.floor(diffMs / 1000);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}m ${seconds}s`;
}
