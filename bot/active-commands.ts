// Active command tracking — maps threadId to command metadata.
// Used for:
//   1. Liveness timeout: auto-release a project's slot after a stretch of genuine
//      silence (no progress/ask/reply activity), NOT a fixed wall-clock budget.
//      A long-running task that keeps emitting progress never times out.
//   2. Channel disconnect detection: notify threads when a project goes offline.

import { recordCommandEnd, getProjectDepth } from "./security.ts";

export interface ActiveCommand {
  projectName: string;
  threadId: string;
  startedAt: number; // epoch ms — when the first command on this thread began
  lastActivityAt: number; // epoch ms — last progress/ask/reply seen for this thread
  awaitingResponse: boolean; // true while a beast_ask is blocked waiting on the user
}

const activeCommands = new Map<string, ActiveCommand>(); // keyed by threadId

// How long a thread can go without ANY activity (progress/ask/reply) before we
// assume the session is dead and release its slot. Activity resets the clock, so
// this is a silence window, not a cap on total task duration.
const SILENCE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes of silence

// Register a command as active (or refresh an existing thread's activity).
export function trackCommandStart(threadId: string, projectName: string): void {
  const now = Date.now();
  const existing = activeCommands.get(threadId);
  if (existing) {
    // Another command arrived on a thread that's already active (queued behind
    // the current one). Keep the original startedAt but mark fresh activity.
    existing.lastActivityAt = now;
    existing.awaitingResponse = false;
    return;
  }
  activeCommands.set(threadId, {
    projectName,
    threadId,
    startedAt: now,
    lastActivityAt: now,
    awaitingResponse: false,
  });
}

// Refresh the liveness clock for a thread (called on progress/ask/reply).
export function trackCommandActivity(threadId: string): void {
  const entry = activeCommands.get(threadId);
  if (entry) {
    entry.lastActivityAt = Date.now();
  }
}

// Mark a thread as waiting on the user (beast_ask). While awaiting, the liveness
// timeout is suspended — a slow human reply must not look like a dead session.
export function setAwaitingResponse(threadId: string, awaiting: boolean): void {
  const entry = activeCommands.get(threadId);
  if (entry) {
    entry.awaitingResponse = awaiting;
    entry.lastActivityAt = Date.now();
  }
}

// Remove a command from tracking (called on completion or timeout)
export function trackCommandEnd(threadId: string): ActiveCommand | undefined {
  const entry = activeCommands.get(threadId);
  activeCommands.delete(threadId);
  return entry;
}

// Release one command's slot. Decrements the project's depth and removes the
// thread's liveness entry only once the queue has fully drained (depth hits 0).
// While other queued commands remain, the entry stays and the completion counts
// as fresh activity — the next queued command is now the active one.
export function releaseCommandSlot(projectName: string, threadId: string): void {
  recordCommandEnd(projectName);
  if (getProjectDepth(projectName) <= 0) {
    trackCommandEnd(threadId);
  } else {
    trackCommandActivity(threadId);
  }
}

// Get all active commands for a given project
export function getActiveCommandsForProject(projectName: string): ActiveCommand[] {
  const result: ActiveCommand[] = [];
  for (const cmd of activeCommands.values()) {
    if (cmd.projectName === projectName) {
      result.push(cmd);
    }
  }
  return result;
}

// Get all threads that have been silent (no activity) longer than the timeout.
// Threads currently awaiting a user response are never considered timed out.
export function getTimedOutCommands(): ActiveCommand[] {
  const cutoff = Date.now() - SILENCE_TIMEOUT_MS;
  const timed: ActiveCommand[] = [];
  for (const cmd of activeCommands.values()) {
    if (!cmd.awaitingResponse && cmd.lastActivityAt < cutoff) {
      timed.push(cmd);
    }
  }
  return timed;
}
