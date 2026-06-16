import {
  AttachmentBuilder,
  Message,
  TextChannel,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
} from "discord.js";
import type { GuildTextBasedChannel } from "discord.js";
import type { AskPayload, PermissionRequestPayload, ProgressPayload, ReplyPayload } from "./types.ts";
import { processAttachments } from "./attachments.ts";

// Any guild channel that supports .send() — text channels, announcement channels, etc.
type MessageChannel = GuildTextBasedChannel;

const DEFAULT_CHUNK_LIMIT = 2000;

// Split a long string into chunks at newline boundaries

export function chunkMessage(text: string, limit = DEFAULT_CHUNK_LIMIT): string[] {
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      chunks.push(remaining);
      break;
    }

    let breakAt = remaining.lastIndexOf("\n", limit);
    if (breakAt <= 0) {
      breakAt = limit;
    }

    chunks.push(remaining.slice(0, breakAt));
    remaining = remaining.slice(breakAt).replace(/^\n/, "");
  }

  return chunks;
}

// Post a progress update to a channel

export async function postProgress(
  channel: MessageChannel,
  payload: ProgressPayload
): Promise<void> {
  let header = "";
  if (payload.phaseName) {
    header += `**${payload.phaseName}**`;
    if (payload.percent !== undefined) {
      header += ` (${payload.percent}%)`;
    }
    header += "\n";
  }

  const fullText = header + payload.text;
  const chunks = chunkMessage(fullText);

  for (const chunk of chunks) {
    await channel.send(chunk);
  }
}

// Post a final reply to a channel with optional file attachments

export async function postReply(
  channel: MessageChannel,
  payload: ReplyPayload
): Promise<void> {
  const chunks = chunkMessage(payload.text);

  for (const chunk of chunks) {
    await channel.send(chunk);
  }

  if (payload.attachments && payload.attachments.length > 0) {
    const files = payload.attachments.map((att) => {
      const buffer = Buffer.from(att.content, "utf8");
      return new AttachmentBuilder(buffer, { name: att.name });
    });

    for (let i = 0; i < files.length; i += 10) {
      await channel.send({ files: files.slice(i, i + 10) });
    }
  }
}

// Post an error message to a channel

export async function postError(channel: MessageChannel, error: string): Promise<void> {
  const message = `**Error:** ${error}`;
  const chunks = chunkMessage(message);
  for (const chunk of chunks) {
    await channel.send(chunk);
  }
}

// Post a permission prompt with Approve/Deny buttons.
// Waits up to 5 minutes for the user to respond via button click or text command.
// Returns true = approved, false = denied/timeout.

const PERMISSION_TIMEOUT_MS = 5 * 60 * 1000;

export async function postPermissionPrompt(
  channel: MessageChannel,
  payload: PermissionRequestPayload
): Promise<boolean> {
  const { permissionId, toolName, toolInput, description, userId } = payload;

  const embed = new EmbedBuilder()
    .setTitle("Permission Required")
    .setColor(0xf59e0b)
    .addFields({ name: "Tool", value: `\`${toolName}\``, inline: true })
    .addFields({ name: "ID", value: `\`${permissionId}\``, inline: true });

  if (description) {
    embed.addFields({ name: "Description", value: description });
  }

  if (toolInput && Object.keys(toolInput).length > 0) {
    const inputStr = JSON.stringify(toolInput, null, 2);
    const truncated =
      inputStr.length > 1800 ? inputStr.slice(0, 1797) + "..." : inputStr;
    embed.addFields({ name: "Arguments", value: `\`\`\`json\n${truncated}\n\`\`\`` });
  }

  embed.setFooter({
    text: `Type "yes ${permissionId}" or "no ${permissionId}" to respond • Auto-denies in 5 min`,
  });

  const approveBtn = new ButtonBuilder()
    .setCustomId(`perm_approve_${permissionId}`)
    .setLabel("Approve")
    .setStyle(ButtonStyle.Success);

  const denyBtn = new ButtonBuilder()
    .setCustomId(`perm_deny_${permissionId}`)
    .setLabel("Deny")
    .setStyle(ButtonStyle.Danger);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(approveBtn, denyBtn);

  const msg = await channel.send({ embeds: [embed], components: [row] });

  const buttonPromise = msg
    .awaitMessageComponent({
      componentType: ComponentType.Button,
      filter: (i) => {
        if (i.user.id !== userId) {
          i.reply({ content: "Only the user who initiated this command can approve or deny.", ephemeral: true }).catch(() => {});
          return false;
        }
        return (
          i.customId === `perm_approve_${permissionId}` ||
          i.customId === `perm_deny_${permissionId}`
        );
      },
      time: PERMISSION_TIMEOUT_MS,
    })
    .then((interaction) => {
      const approved = interaction.customId === `perm_approve_${permissionId}`;
      interaction.deferUpdate().catch(() => {});
      return approved;
    });

  const shortId = permissionId.slice(0, 8);

  const textPromise = channel
    .awaitMessages({
      filter: (m: Message) => {
        if (m.author.bot) return false;
        if (m.author.id !== userId) return false;
        const lower = m.content.toLowerCase().trim();
        return (
          lower === `yes ${permissionId}` ||
          lower === `approve ${permissionId}` ||
          lower === `yes ${shortId}` ||
          lower === `approve ${shortId}` ||
          lower === `no ${permissionId}` ||
          lower === `deny ${permissionId}` ||
          lower === `no ${shortId}` ||
          lower === `deny ${shortId}`
        );
      },
      max: 1,
      time: PERMISSION_TIMEOUT_MS,
    })
    .then((collected) => {
      const m = collected.first();
      if (!m) return null;
      const lower = m.content.toLowerCase().trim();
      return (
        lower.startsWith("yes") || lower.startsWith("approve")
      );
    })
    .catch(() => null);

  const timeoutPromise: Promise<boolean> = new Promise((resolve) =>
    setTimeout(() => resolve(false), PERMISSION_TIMEOUT_MS + 100)
  );

  let approved: boolean;
  try {
    const textOrTimeout: Promise<boolean> = textPromise.then((v) => v ?? false);
    approved = await Promise.race([buttonPromise, textOrTimeout, timeoutPromise]);
  } catch {
    approved = false;
  }

  const outcomeEmbed = EmbedBuilder.from(embed)
    .setColor(approved ? 0x22c55e : 0xef4444)
    .setFooter({ text: approved ? "Approved" : "Denied" });

  await msg
    .edit({ embeds: [outcomeEmbed], components: [] })
    .catch(() => {});

  return approved;
}

// Post a question and wait for the user's reply.
// If options are provided, shows them as clickable buttons.
// Returns the reply text, or null on timeout.

export async function postAsk(
  channel: MessageChannel,
  payload: AskPayload
): Promise<string | null> {
  const hasOptions = payload.options && payload.options.length > 0;

  if (hasOptions) {
    const options = payload.options!;

    const rows: ActionRowBuilder<ButtonBuilder>[] = [];
    for (let i = 0; i < options.length && i < 25; i++) {
      const rowIndex = Math.floor(i / 5);
      if (!rows[rowIndex]) {
        rows[rowIndex] = new ActionRowBuilder<ButtonBuilder>();
      }
      rows[rowIndex].addComponents(
        new ButtonBuilder()
          .setCustomId(`ask_option_${i}`)
          .setLabel(options[i].slice(0, 80))
          .setStyle(ButtonStyle.Primary)
      );
    }

    const msg = await channel.send({
      content: payload.question,
      components: rows,
    });

    const buttonPromise = msg
      .awaitMessageComponent({
        componentType: ComponentType.Button,
        filter: (i) => {
          if (i.user.bot) return false;
          return i.customId.startsWith("ask_option_");
        },
        time: payload.timeout,
      })
      .then((interaction) => {
        const idx = parseInt(interaction.customId.replace("ask_option_", ""), 10);
        const selected = options[idx] ?? interaction.customId;
        interaction.deferUpdate().catch(() => {});
        return selected;
      });

    const textPromise = channel
      .awaitMessages({
        filter: (m: Message) => !m.author.bot,
        max: 1,
        time: payload.timeout,
      })
      .then(async (collected) => {
        const m = collected.first();
        if (!m) return null;
        const attachmentExtra = await processAttachments(m.attachments);
        return (m.content || "") + attachmentExtra;
      })
      .catch(() => null);

    const timeoutPromise: Promise<string | null> = new Promise((resolve) =>
      setTimeout(() => resolve(null), payload.timeout + 100)
    );

    let result: string | null;
    try {
      result = await Promise.race([buttonPromise, textPromise, timeoutPromise]);
    } catch {
      result = null;
    }

    if (result !== null) {
      await msg.edit({ content: `${payload.question}\n\n**Selected:** ${result}`, components: [] }).catch(() => {});
    }

    return result;
  }

  // No options — plain text question
  const chunks = chunkMessage(payload.question);
  for (const chunk of chunks) {
    await channel.send(chunk);
  }

  try {
    const collected = await channel.awaitMessages({
      filter: (msg: Message) => !msg.author.bot,
      max: 1,
      time: payload.timeout,
      errors: ["time"],
    });

    const reply = collected.first();
    if (!reply) return null;
    const attachmentExtra = await processAttachments(reply.attachments);
    return (reply.content || "") + attachmentExtra;
  } catch {
    return null;
  }
}
