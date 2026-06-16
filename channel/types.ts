import { z } from "zod";

// Per-project channel configuration (.beast-mode-channel.json)
export const ChannelConfigSchema = z.object({
  projectName: z.string().min(1),
  channelPort: z.number().int().min(1).max(65535).default(3850),
  channelHost: z.string().default("127.0.0.1"), // IP the bot should use to reach this channel
  botUrl: z.string().url().default("http://127.0.0.1:3847"),
  hmacSecret: z.string().min(1),
});

export type ChannelConfig = z.infer<typeof ChannelConfigSchema>;

// Inbound command from the central bot (mirrors CommandPayload)
export const InboundCommandSchema = z.object({
  command: z.string().min(1),
  args: z.record(z.string(), z.unknown()).default({}),
  userId: z.string().min(1),
  threadId: z.string().min(1),
  timestamp: z.string().datetime(),
  queued: z.boolean().default(false), // true if forwarded while the project was busy
});

export type InboundCommand = z.infer<typeof InboundCommandSchema>;

// Progress update sent by Claude via beast_progress tool
export const ProgressUpdateSchema = z.object({
  text: z.string().min(1),
  phaseName: z.string().optional(),
  percent: z.number().int().min(0).max(100).optional(),
});

export type ProgressUpdate = z.infer<typeof ProgressUpdateSchema>;

// Reply sent by Claude via beast_reply tool
export const ReplyUpdateSchema = z.object({
  text: z.string().min(1),
  attachments: z
    .array(
      z.object({
        name: z.string().min(1),
        content: z.string(),
      })
    )
    .optional(),
});

export type ReplyUpdate = z.infer<typeof ReplyUpdateSchema>;

// Ask payload sent by Claude via beast_ask tool
export const AskUpdateSchema = z.object({
  question: z.string().min(1),
  options: z.array(z.string()).optional(),
  timeout: z.number().int().positive().default(300000),
});

export type AskUpdate = z.infer<typeof AskUpdateSchema>;

// Response shape from bot /ask endpoint
export const AskResponseSchema = z.object({
  ok: z.boolean(),
  response: z.string(),
});

export type AskResponse = z.infer<typeof AskResponseSchema>;

// Permission request/verdict types are handled inline in server.ts
// using the official Claude Code channels protocol (request_id + behavior).
