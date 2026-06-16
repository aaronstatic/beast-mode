// Structured JSON logger for the Beast Mode Discord bot.
// Outputs one JSON line per log call to stdout (info/debug) or stderr (warn/error).
// pm2 captures stdout/stderr separately via out_file and error_file in ecosystem.config.js.
//
// Log line format:
//   {"ts":"2026-03-23T21:00:00.000Z","level":"info","component":"bot","msg":"...","data":{...}}

export type LogLevel = "debug" | "info" | "warn" | "error";
export type Component = "bot" | "registry" | "commands" | "threads" | "security" | "dashboard" | "git";

export interface LogEntry {
  ts: string;
  level: LogLevel;
  component: Component;
  msg: string;
  data?: unknown;
}

function write(level: LogLevel, component: Component, msg: string, data?: unknown): void {
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    component,
    msg,
  };
  if (data !== undefined) {
    entry.data = data;
  }
  const line = JSON.stringify(entry);
  if (level === "warn" || level === "error") {
    process.stderr.write(line + "\n");
  } else {
    process.stdout.write(line + "\n");
  }
}

// Create a logger bound to a specific component
export function createLogger(component: Component) {
  return {
    debug: (msg: string, data?: unknown) => write("debug", component, msg, data),
    info:  (msg: string, data?: unknown) => write("info",  component, msg, data),
    warn:  (msg: string, data?: unknown) => write("warn",  component, msg, data),
    error: (msg: string, data?: unknown) => write("error", component, msg, data),
  };
}

// Default module-level loggers for each component
export const botLog      = createLogger("bot");
export const registryLog = createLogger("registry");
export const commandsLog = createLogger("commands");
export const threadsLog  = createLogger("threads");
export const securityLog = createLogger("security");
export const dashboardLog = createLogger("dashboard");
export const gitLog = createLogger("git");
