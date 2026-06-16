import {
  ChatInputCommandInteraction,
  REST,
  Routes,
  SlashCommandBuilder,
} from "discord.js";
import type { Config, CommandPayload } from "./types.ts";
import {
  isAllowedUser,
  checkUserRateLimit,
  isProjectBusy,
  getProjectDepth,
  recordCommandStart,
  signPayload,
} from "./security.ts";
import {
  getProjectByChannel,
  getAllProjects,
} from "./registry.ts";
import { postError } from "./threads.ts";
import { trackCommandStart, releaseCommandSlot } from "./active-commands.ts";
import { updateDashboard } from "./dashboard.ts";
import { commandsLog } from "./logger.ts";

// Slash command definitions

export const commands = [
  new SlashCommandBuilder()
    .setName("beast")
    .setDescription("Beast Mode workflow commands")
    .addSubcommand((sub) =>
      sub
        .setName("plan")
        .setDescription("Plan a new feature")
        .addStringOption((opt) =>
          opt.setName("feature").setDescription("Feature name (or epic/feature)").setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("start")
        .setDescription("Start a feature")
        .addStringOption((opt) =>
          opt.setName("feature").setDescription("Feature name (or epic/feature)").setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("proceed")
        .setDescription("Continue implementation")
        .addStringOption((opt) =>
          opt.setName("feature").setDescription("Feature name (or epic/feature)").setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub.setName("suggest").setDescription("Suggest next feature")
    )
    .addSubcommand((sub) =>
      sub
        .setName("review")
        .setDescription("Review feature code")
        .addStringOption((opt) =>
          opt.setName("feature").setDescription("Feature name (or epic/feature)").setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("audit")
        .setDescription("Audit feature architecture")
        .addStringOption((opt) =>
          opt.setName("feature").setDescription("Feature name (or epic/feature)").setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub.setName("status").setDescription("Show registered projects and their status")
    )
    .addSubcommand((sub) =>
      sub
        .setName("update")
        .setDescription("Update feature docs")
        .addStringOption((opt) =>
          opt.setName("feature").setDescription("Feature name (or epic/feature)").setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("discover")
        .setDescription("Discover existing feature")
        .addStringOption((opt) =>
          opt.setName("feature").setDescription("Feature name (or epic/feature)").setRequired(true)
        )
        .addStringOption((opt) =>
          opt
            .setName("description")
            .setDescription("Optional description")
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("document")
        .setDescription("Document a feature")
        .addStringOption((opt) =>
          opt.setName("feature").setDescription("Feature name (or epic/feature)").setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("continue")
        .setDescription("Continue work on a feature or an epic")
        .addStringOption((opt) =>
          opt.setName("feature").setDescription("Feature name (or epic/feature)").setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("fix")
        .setDescription("Fix all open bugs for a feature")
        .addStringOption((opt) =>
          opt.setName("feature").setDescription("Feature name (omit for all bugs)").setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("fix-bug")
        .setDescription("Fix a specific bug by ID")
        .addStringOption((opt) =>
          opt.setName("bug").setDescription("Bug ID (e.g. BUG-001)").setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("update-master")
        .setDescription("Update project master overview")
        .addStringOption((opt) =>
          opt.setName("feature").setDescription("Feature name (optional)").setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("evaluate")
        .setDescription("Evaluate a feature against its definition of done")
        .addStringOption((opt) =>
          opt.setName("feature").setDescription("Feature name (or epic/feature)").setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("review-ux")
        .setDescription("Review UX quality of a feature or page")
        .addStringOption((opt) =>
          opt.setName("feature").setDescription("Feature or page name").setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("review-pr")
        .setDescription("Independent review of a PR (open on GitHub, or local changes pre-submit)")
        .addStringOption((opt) =>
          opt.setName("pr").setDescription("PR number (omit to review local changes pre-submit)").setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub.setName("upgrade").setDescription("Upgrade Beast Mode")
    )
    .addSubcommand((sub) =>
      sub
        .setName("create-epic")
        .setDescription("Group existing features into an epic")
        .addStringOption((opt) =>
          opt.setName("epic").setDescription("Epic name (kebab-case)").setRequired(true)
        )
        .addStringOption((opt) =>
          opt.setName("prompt").setDescription("What part of the system this epic covers").setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("plan-epic")
        .setDescription("Plan an epic from scratch (define its features)")
        .addStringOption((opt) =>
          opt.setName("epic").setDescription("Epic name (kebab-case)").setRequired(true)
        )
        .addStringOption((opt) =>
          opt.setName("prompt").setDescription("Initial requirements (optional)").setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("update-epic")
        .setDescription("Refresh an epic's overview and master rollup")
        .addStringOption((opt) =>
          opt.setName("epic").setDescription("Epic name (omit for current epic)").setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("review-epic")
        .setDescription("Review an epic holistically across its features")
        .addStringOption((opt) =>
          opt.setName("epic").setDescription("Epic name").setRequired(true)
        )
    ),
];

// Command registration helper

export async function registerCommandsInGuild(
  botToken: string,
  clientId: string,
  guildId: string
): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(botToken);
  const body = commands.map((cmd) => cmd.toJSON());
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body });
  commandsLog.info(`Registered ${body.length} slash command(s)`, { guildId, count: body.length });
}

// Build args record from interaction options

function collectArgs(
  interaction: ChatInputCommandInteraction
): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  const options = interaction.options;
  for (const name of ["feature", "description", "bug", "pr", "epic", "prompt"]) {
    const val = options.getString(name);
    if (val !== null) args[name] = val;
  }
  return args;
}

// Status subcommand: reply inline with project list

function buildStatusMessage(): string {
  const projects = getAllProjects();
  if (projects.length === 0) {
    return "**Beast Mode Projects**\n\nNo projects registered yet.";
  }
  const lines = ["**Beast Mode Projects**\n"];
  for (const p of projects) {
    const icon = p.status === "online" ? "🟢" : "🔴";
    const seen = new Date(p.lastSeen).toLocaleString();
    lines.push(`${icon} **${p.name}** — port ${p.port} — last seen: ${seen}`);
  }
  return lines.join("\n");
}

// Route a command to the project channel via HTTP POST

async function routeCommandToProject(
  project: { name: string; port: number; hmacSecret: string; status: string },
  payload: CommandPayload
): Promise<void> {
  const body = JSON.stringify(payload);
  const signature = signPayload(project.hmacSecret, body);

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
    throw new Error(`Project channel returned ${res.status}: ${await res.text()}`);
  }
}

// Main interaction handler

export async function handleInteraction(
  interaction: ChatInputCommandInteraction,
  config: Config
): Promise<void> {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "beast") return;

  const subcommand = interaction.options.getSubcommand(true);
  const userId = interaction.user.id;

  // Allowlist check
  if (!isAllowedUser(config, userId)) {
    await interaction.reply({
      content: "You are not authorised to use Beast Mode commands.",
      ephemeral: true,
    });
    return;
  }

  // /beast status — handled locally, no routing
  if (subcommand === "status") {
    await interaction.reply({ content: buildStatusMessage() });
    return;
  }

  // Look up project for this channel
  const channelId = interaction.channelId;
  const project = getProjectByChannel(channelId, config);

  if (!project) {
    commandsLog.warn("No project mapped", {
      channelId,
      channelProjects: config.channelProjects,
    });
    await interaction.reply({
      content:
        "No project is mapped to this channel. Ask an admin to configure `channelProjects` in the bot config.",
      ephemeral: true,
    });
    return;
  }

  if (project.status === "offline") {
    await interaction.reply({
      content: `Project **${project.name}** is currently offline. Start the Beast Mode channel and try again.`,
      ephemeral: true,
    });
    return;
  }

  // Per-user hourly cap (the only hard limit — a busy project queues, not blocks).
  const rateCheck = checkUserRateLimit(userId);
  if (!rateCheck.allowed) {
    await interaction.reply({
      content: rateCheck.reason ?? "Rate limit exceeded.",
      ephemeral: true,
    });
    return;
  }

  // Defer reply while we route the command
  await interaction.deferReply();

  try {
    const args = collectArgs(interaction);

    // If the project is mid-task, forward anyway — Claude Code queues it natively
    // and runs it after the current turn — and tell the user it's queued.
    const busy = isProjectBusy(project.name);
    const ahead = getProjectDepth(project.name);

    // Use the channel ID directly — no thread creation.
    // One project per channel, one session per project.
    const payload: CommandPayload = {
      command: subcommand,
      args,
      userId,
      threadId: channelId, // channelId used as the message target
      timestamp: new Date().toISOString(),
      queued: busy,
    };

    recordCommandStart(userId, project.name);
    trackCommandStart(channelId, project.name);
    updateDashboard();

    await routeCommandToProject(project, payload);

    await interaction.editReply(
      busy
        ? `📥 Queued \`/beast ${subcommand}\` — runs after the current task` +
            (ahead > 1 ? ` (${ahead} ahead).` : ".")
        : `Running \`/beast ${subcommand}\`...`
    );
  } catch (err) {
    commandsLog.error(`Error routing command "${subcommand}"`, { err: String(err) });
    const message = err instanceof Error ? err.message : String(err);

    releaseCommandSlot(project.name, channelId);

    // Post error in the channel
    const ch = interaction.channel;
    if (ch && "send" in ch) {
      try {
        await postError(ch as any, `Failed to route command to project "${project.name}": ${message}`);
      } catch {
        // Ignore secondary failure
      }
    }

    await interaction.editReply(`Failed to route command: ${message}`);
  }
}
