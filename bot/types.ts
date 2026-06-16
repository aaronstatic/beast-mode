import { z } from "zod";

export const ConfigSchema = z.object({
  botToken: z.string().min(1),
  guildId: z.string().min(1),
  channelProjects: z.record(z.string(), z.string()).default({}),
  allowedUsers: z.array(z.string()).default([]),
  adminUsers: z.array(z.string()).default([]),
  botPort: z.number().int().min(1).max(65535).default(3847),
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  webBaseUrl: z.string().optional(), // e.g. "https://claude.aaronstatic.dev" or "http://localhost:3847"
  pathMappings: z.record(z.string(), z.string()).default({}), // project name → local path override
  apiKeys: z.array(z.string().min(1)).default([]),
  statusChannelId: z.string().optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

export const ProjectEntrySchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  host: z.string().default("127.0.0.1"), // IP/hostname of the machine running the channel
  hmacSecret: z.string().min(1),
  status: z.enum(["online", "offline"]).default("online"),
  lastSeen: z.string().datetime().default(() => new Date().toISOString()),
});

export type ProjectEntry = z.infer<typeof ProjectEntrySchema>;

export const CommandPayloadSchema = z.object({
  command: z.string().min(1),
  args: z.record(z.string(), z.unknown()).default({}),
  userId: z.string().min(1),
  threadId: z.string().min(1),
  timestamp: z.string().datetime(),
  queued: z.boolean().default(false), // true if forwarded while the project was busy
});

export type CommandPayload = z.infer<typeof CommandPayloadSchema>;

export const ProgressPayloadSchema = z.object({
  threadId: z.string().min(1),
  text: z.string().min(1),
  phaseName: z.string().optional(),
  percent: z.number().int().min(0).max(100).optional(),
});

export type ProgressPayload = z.infer<typeof ProgressPayloadSchema>;

export const AskPayloadSchema = z.object({
  threadId: z.string().min(1),
  question: z.string().min(1),
  options: z.array(z.string()).optional(),
  // Fallback default; the channel always sends an explicit timeout (also 5 min). On
  // elapse, postAsk returns null and /ask responds { timedOut: true } so the channel
  // can apply the away (AFK) protocol rather than blocking the session indefinitely.
  timeout: z.number().int().positive().default(300000), // 5 minutes
});

export type AskPayload = z.infer<typeof AskPayloadSchema>;

export const ReplyPayloadSchema = z.object({
  threadId: z.string().min(1),
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

export type ReplyPayload = z.infer<typeof ReplyPayloadSchema>;

export const CommandCompletePayloadSchema = z.object({
  projectName: z.string().min(1),
  threadId: z.string().min(1),
  success: z.boolean(),
});

export type CommandCompletePayload = z.infer<typeof CommandCompletePayloadSchema>;

export const PermissionRequestPayloadSchema = z.object({
  threadId: z.string().min(1),
  permissionId: z.string().min(1), // unique ID for this permission request (8-char hex)
  toolName: z.string().min(1),     // the tool being requested
  toolInput: z.record(z.unknown()).optional(), // tool arguments (for context)
  description: z.string().optional(), // human-readable description
  userId: z.string().min(1),       // Discord user ID who must approve (from original command)
});

export type PermissionRequestPayload = z.infer<typeof PermissionRequestPayloadSchema>;

export const PermissionVerdictPayloadSchema = z.object({
  permissionId: z.string().min(1),
  approved: z.boolean(),
});

export type PermissionVerdictPayload = z.infer<typeof PermissionVerdictPayloadSchema>;

// Bug frontmatter schema for API validation

export const BugFrontmatterSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  status: z.enum(["open", "in-progress", "closed"]),
  priority: z.enum(["low", "medium", "high", "critical"]),
  linkedFeature: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type BugFrontmatter = z.infer<typeof BugFrontmatterSchema>;

// Bug creation payload (used by POST /api/bugs/:project)

export const CreateBugPayloadSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  priority: z.enum(["low", "medium", "high", "critical"]),
  linkedFeature: z.string().optional(),
});

export type CreateBugPayload = z.infer<typeof CreateBugPayloadSchema>;

// Bug update payload (used by PATCH /api/bugs/:project/:id)

export const UpdateBugPayloadSchema = z.object({
  title: z.string().min(1).optional(),
  status: z.enum(["open", "in-progress", "closed"]).optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
  linkedFeature: z.string().optional(),
  description: z.string().optional(),
});

export type UpdateBugPayload = z.infer<typeof UpdateBugPayloadSchema>;

// Feature creation payload (used by POST /api/features/:project)

export const CreateFeaturePayloadSchema = z.object({
  name: z.string().min(1),
  requirements: z.string().min(1),
  epic: z.string().optional(), // when set, create the feature inside this epic: docs/features/<epic>/<name>
});

export type CreateFeaturePayload = z.infer<typeof CreateFeaturePayloadSchema>;

// Epic creation payload (used by POST /api/epics/:project).
// Mirrors CreateFeaturePayloadSchema — the body seeds epic-requirements.md.

export const CreateEpicPayloadSchema = z.object({
  name: z.string().min(1),
  requirements: z.string().min(1),
});

export type CreateEpicPayload = z.infer<typeof CreateEpicPayloadSchema>;

// Projects registry file shape (keyed by project name, no 'name' field stored)
export const ProjectsFileSchema = z.record(
  z.string(),
  z.object({
    path: z.string(),
    port: z.number(),
    host: z.string().default("127.0.0.1"),
    hmacSecret: z.string(),
    status: z.enum(["online", "offline"]),
    lastSeen: z.string(),
  })
);

export type ProjectsFile = z.infer<typeof ProjectsFileSchema>;

// Git commit payload (used by POST /api/git/:project/commit)

export const GitCommitPayloadSchema = z.object({
  message: z.string().min(1).max(500),
});

export type GitCommitPayload = z.infer<typeof GitCommitPayloadSchema>;
