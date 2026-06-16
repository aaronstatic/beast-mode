import { writeFileSync } from "fs";
import type { Collection, Attachment } from "discord.js";
import { botLog } from "./logger.ts";

const IMAGE_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg",
]);

const TEXT_EXTENSIONS = new Set([
  ".txt", ".md", ".log", ".json", ".csv", ".xml", ".yml", ".yaml",
  ".ts", ".js", ".py", ".sh", ".html", ".css", ".toml", ".ini",
  ".rs", ".go", ".java", ".c", ".cpp", ".h", ".rb", ".php",
]);

const MAX_TEXT_SIZE = 500_000; // 500KB — skip inlining beyond this

function getExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot).toLowerCase() : "";
}

/**
 * Process Discord message attachments into text that can be appended to
 * the message content before forwarding to Claude Code.
 *
 * - Text files (`.txt`, `.md`, etc.): content is inlined directly
 * - Images: downloaded to `/tmp/beast-<timestamp>-<index>.<ext>` and
 *   a `See: <path>` line is appended
 */
export async function processAttachments(
  attachments: Collection<string, Attachment>
): Promise<string> {
  if (attachments.size === 0) return "";

  const parts: string[] = [];
  let imageIndex = 0;

  for (const [, attachment] of attachments) {
    const ext = getExtension(attachment.name);
    const isImage =
      IMAGE_EXTENSIONS.has(ext) || (attachment.contentType?.startsWith("image/") ?? false);
    const isText =
      TEXT_EXTENSIONS.has(ext) || (attachment.contentType?.startsWith("text/") ?? false);

    if (isImage) {
      try {
        const response = await fetch(attachment.url);
        const buffer = Buffer.from(await response.arrayBuffer());
        const timestamp = Date.now();
        const fileExt = ext || ".png";
        const filename = `beast-${timestamp}-${imageIndex++}${fileExt}`;
        const filepath = `/tmp/${filename}`;
        writeFileSync(filepath, buffer);
        parts.push(`See: ${filepath}`);
        botLog.info(`Downloaded image attachment to ${filepath}`, {
          originalName: attachment.name,
          size: attachment.size,
        });
      } catch (err) {
        botLog.warn(`Failed to download image attachment: ${attachment.name}`, {
          err: String(err),
        });
      }
    } else if (isText || attachment.size < MAX_TEXT_SIZE) {
      // Text files or small unknown files — inline content
      if (attachment.size > MAX_TEXT_SIZE) {
        botLog.info(`Skipping large text attachment: ${attachment.name} (${attachment.size} bytes)`);
        continue;
      }
      try {
        const response = await fetch(attachment.url);
        const content = await response.text();
        parts.push(content);
        botLog.info(`Inlined text attachment: ${attachment.name}`, {
          size: attachment.size,
        });
      } catch (err) {
        botLog.warn(`Failed to download text attachment: ${attachment.name}`, {
          err: String(err),
        });
      }
    } else {
      botLog.info(`Skipping unsupported attachment: ${attachment.name}`, {
        contentType: attachment.contentType,
        size: attachment.size,
      });
    }
  }

  return parts.length > 0 ? "\n" + parts.join("\n") : "";
}
