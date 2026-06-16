// Structured JSON logger for the Beast Mode Discord channel (MCP server).
// Outputs one JSON line per log call to stdout (info/debug) or stderr (warn/error).
// Since the channel runs over stdio MCP, stdout is reserved for MCP protocol messages.
// All log output is directed to stderr so it does not interfere with MCP framing.
//
// Log line format:
//   {"ts":"2026-03-23T21:00:00.000Z","level":"info","component":"channel","msg":"...","data":{...}}

export type LogLevel = "debug" | "info" | "warn" | "error";
export type Component = "channel" | "mcp" | "http";

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
  // Always write to stderr — stdout is the MCP stdio transport
  process.stderr.write(JSON.stringify(entry) + "\n");
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
export const channelLog = createLogger("channel");
export const mcpLog     = createLogger("mcp");
export const httpLog    = createLogger("http");
