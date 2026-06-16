import { createHmac, timingSafeEqual } from "crypto";
import type { Config } from "./types.ts";

// HMAC-SHA256 signing

export function signPayload(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function verifySignature(
  secret: string,
  payload: string,
  signature: string
): boolean {
  const expected = signPayload(secret, payload);
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}

// User allowlist checks

export function isAllowedUser(config: Config, userId: string): boolean {
  return config.allowedUsers.includes(userId) || config.adminUsers.includes(userId);
}

export function isAdminUser(config: Config, userId: string): boolean {
  return config.adminUsers.includes(userId);
}

// Rate limiting
// Per-user: max 10 commands per hour (rolling window)
// Per-project: max 1 concurrent active command

interface UserRecord {
  timestamps: number[]; // epoch ms of each command invocation
}

interface ProjectRecord {
  activeConcurrent: number;
}

const userRecords = new Map<string, UserRecord>();
const projectRecords = new Map<string, ProjectRecord>();

const USER_LIMIT = 60;
const USER_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const PROJECT_CONCURRENCY = 1;

function cleanUserRecord(record: UserRecord): void {
  const cutoff = Date.now() - USER_WINDOW_MS;
  record.timestamps = record.timestamps.filter((ts) => ts > cutoff);
}

// Per-user hourly cap. This is the only hard rejection — a busy project no longer
// blocks new commands; they're forwarded and queued (see isProjectBusy).
export function checkUserRateLimit(
  userId: string
): { allowed: boolean; reason?: string } {
  if (!userRecords.has(userId)) {
    userRecords.set(userId, { timestamps: [] });
  }
  const userRecord = userRecords.get(userId)!;
  cleanUserRecord(userRecord);

  if (userRecord.timestamps.length >= USER_LIMIT) {
    return {
      allowed: false,
      reason: `Rate limit exceeded: max ${USER_LIMIT} commands per hour.`,
    };
  }

  return { allowed: true };
}

// Whether the project already has a command in flight. Used only to decide
// messaging (queued vs. starting) — it does NOT block the command.
export function isProjectBusy(projectName: string): boolean {
  const record = projectRecords.get(projectName);
  return (record?.activeConcurrent ?? 0) >= PROJECT_CONCURRENCY;
}

// How many commands are currently in flight / queued for a project.
export function getProjectDepth(projectName: string): number {
  return projectRecords.get(projectName)?.activeConcurrent ?? 0;
}

export function recordCommandStart(userId: string, projectName: string): void {
  const userRecord = userRecords.get(userId);
  if (userRecord) {
    userRecord.timestamps.push(Date.now());
  }

  const projectRecord = projectRecords.get(projectName);
  if (projectRecord) {
    projectRecord.activeConcurrent++;
  }
}

export function recordCommandEnd(projectName: string): void {
  const projectRecord = projectRecords.get(projectName);
  if (projectRecord && projectRecord.activeConcurrent > 0) {
    projectRecord.activeConcurrent--;
  }
}

// Clear all in-flight/queued commands for a project at once. Used when a session
// is presumed dead (liveness timeout) so a stale depth can't leave it "busy".
export function resetProjectConcurrency(projectName: string): void {
  const projectRecord = projectRecords.get(projectName);
  if (projectRecord) {
    projectRecord.activeConcurrent = 0;
  }
}

// Cleanup stale user records periodically to prevent unbounded memory growth
setInterval(() => {
  for (const [userId, record] of userRecords.entries()) {
    cleanUserRecord(record);
    if (record.timestamps.length === 0) {
      userRecords.delete(userId);
    }
  }
}, USER_WINDOW_MS);
