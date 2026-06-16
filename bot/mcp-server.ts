#!/usr/bin/env bun
/**
 * Beast Mode Desktop MCP Server
 *
 * A standalone MCP tool server that wraps the Beast Mode bot's HTTP API.
 * Designed for Claude Desktop, Cursor, or any MCP-capable client.
 *
 * Usage:
 *   bun bot/mcp-server.ts --bot-url=http://localhost:3847 --api-key=YOUR_KEY
 *
 * Or via environment variables:
 *   BEAST_BOT_URL=http://localhost:3847 BEAST_API_KEY=YOUR_KEY bun bot/mcp-server.ts
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

function getArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
}

const botUrl = (getArg("bot-url") ?? process.env.BEAST_BOT_URL ?? "").replace(/\/+$/, "");
const apiKey = getArg("api-key") ?? process.env.BEAST_API_KEY ?? "";

if (!botUrl) {
  console.error("Error: Bot URL is required. Use --bot-url=<url> or set BEAST_BOT_URL.");
  process.exit(1);
}
if (!apiKey) {
  console.error("Error: API key is required. Use --api-key=<key> or set BEAST_API_KEY.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Encode a feature reference for use as URL path segments.
 * A feature may be a plain name ("user-auth") or a nested ref ("epics/core").
 * encodeURIComponent("epics/core") would produce "epics%2Fcore", breaking
 * path-segment routing. Instead, encode each segment individually and rejoin
 * with "/" so the slash is preserved in the URL path.
 * For plain names (no "/") the result is identical to encodeURIComponent.
 */
function encodeFeatureRef(feature: string): string {
  return feature.split("/").map(encodeURIComponent).join("/");
}

// ---------------------------------------------------------------------------
// HTTP helper — never throws
// ---------------------------------------------------------------------------

async function apiCall(
  method: string,
  path: string,
  options?: {
    params?: Record<string, string>;
    body?: unknown;
    textBody?: string;
  }
): Promise<{ ok: boolean; status: number; data: unknown }> {
  try {
    let url = `${botUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
    };

    if (method === "GET" && options?.params) {
      const qs = new URLSearchParams(options.params).toString();
      if (qs) url += `?${qs}`;
    }

    const init: RequestInit = { method, headers };

    if (method !== "GET") {
      if (options?.textBody !== undefined) {
        headers["Content-Type"] = "text/plain";
        init.body = options.textBody;
      } else if (options?.body !== undefined) {
        headers["Content-Type"] = "application/json";
        init.body = JSON.stringify(options.body);
      }
    }

    const res = await fetch(url, init);
    let data: unknown;
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      data = await res.json();
    } else {
      const text = await res.text();
      // Try to parse as JSON in case content-type header is missing
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, data: { error: `Network error: ${message}` } };
  }
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new Server(
  { name: "beast-mode-desktop", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "list_projects",
      description: "List all registered Beast Mode projects.",
      inputSchema: { type: "object" as const, properties: {} },
    },
    {
      name: "get_project",
      description: "Get details about a specific project by name.",
      inputSchema: {
        type: "object" as const,
        properties: { name: { type: "string", description: "Project name" } },
        required: ["name"],
      },
    },
    {
      name: "get_project_doc",
      description:
        "Read a project-level document (overview.md, mission-statement.md, or technical-design.md).",
      inputSchema: {
        type: "object" as const,
        properties: {
          name: { type: "string", description: "Project name" },
          docName: {
            type: "string",
            description: "Document name: overview.md, mission-statement.md, or technical-design.md",
            enum: ["overview.md", "mission-statement.md", "technical-design.md"],
          },
        },
        required: ["name", "docName"],
      },
    },
    {
      name: "write_project_doc",
      description:
        "Write or create a project-level document (mission-statement.md or technical-design.md). overview.md is read-only.",
      inputSchema: {
        type: "object" as const,
        properties: {
          name: { type: "string", description: "Project name" },
          docName: {
            type: "string",
            description: "Document name: mission-statement.md or technical-design.md",
            enum: ["mission-statement.md", "technical-design.md"],
          },
          content: { type: "string", description: "Markdown content to write" },
        },
        required: ["name", "docName", "content"],
      },
    },
    {
      name: "list_features",
      description: "List all features for a project. Epics are marked with `isEpic: true` and include their child features under `children`; reference a feature inside an epic as `<epic>/<feature>` (e.g. `epics/core`).",
      inputSchema: {
        type: "object" as const,
        properties: { project: { type: "string", description: "Project name" } },
        required: ["project"],
      },
    },
    {
      name: "get_feature",
      description: "Get details about a specific feature including its files and metadata.",
      inputSchema: {
        type: "object" as const,
        properties: {
          project: { type: "string", description: "Project name" },
          feature: { type: "string", description: "Feature name, or `<epic>/<feature>` for a feature inside an epic (e.g. `epics/core`)." },
        },
        required: ["project", "feature"],
      },
    },
    {
      name: "read_feature_file",
      description: "Read a feature file (e.g. implementation.md, context.md, tasks.md).",
      inputSchema: {
        type: "object" as const,
        properties: {
          project: { type: "string", description: "Project name" },
          feature: { type: "string", description: "Feature name, or `<epic>/<feature>` for a feature inside an epic (e.g. `epics/core`)." },
          file: { type: "string", description: "File name (e.g. implementation.md)" },
        },
        required: ["project", "feature", "file"],
      },
    },
    {
      name: "write_feature_file",
      description: "Write or update a feature file with markdown content.",
      inputSchema: {
        type: "object" as const,
        properties: {
          project: { type: "string", description: "Project name" },
          feature: { type: "string", description: "Feature name, or `<epic>/<feature>` for a feature inside an epic (e.g. `epics/core`)." },
          file: { type: "string", description: "File name (e.g. implementation.md)" },
          content: { type: "string", description: "Markdown content to write" },
        },
        required: ["project", "feature", "file", "content"],
      },
    },
    {
      name: "create_feature",
      description: "Create a new feature with initial requirements.",
      inputSchema: {
        type: "object" as const,
        properties: {
          project: { type: "string", description: "Project name" },
          name: { type: "string", description: "Feature name (kebab-case recommended)" },
          requirements: { type: "string", description: "Initial requirements description" },
        },
        required: ["project", "name", "requirements"],
      },
    },
    {
      name: "list_epics",
      description: "List a project's epics with their rollup status and child counts.",
      inputSchema: {
        type: "object" as const,
        properties: { project: { type: "string", description: "Project name" } },
        required: ["project"],
      },
    },
    {
      name: "get_epic",
      description: "Read an epic's rollup status and child features (reads `epic-overview.md` and `epic-requirements.md` if present).",
      inputSchema: {
        type: "object" as const,
        properties: {
          project: { type: "string", description: "Project name" },
          epic: { type: "string", description: "Epic name (kebab-case)" },
        },
        required: ["project", "epic"],
      },
    },
    {
      name: "create_epic",
      description: "Create a new epic folder + `epic-requirements.md` so `/plan-epic` can pick it up.",
      inputSchema: {
        type: "object" as const,
        properties: {
          project: { type: "string", description: "Project name" },
          name: { type: "string", description: "Epic name (kebab-case recommended)" },
          requirements: { type: "string", description: "Initial requirements description" },
        },
        required: ["project", "name", "requirements"],
      },
    },
    {
      name: "list_bugs",
      description: "List bugs for a project, optionally filtered by status, priority, or linked feature.",
      inputSchema: {
        type: "object" as const,
        properties: {
          project: { type: "string", description: "Project name" },
          status: { type: "string", description: "Filter by status: open, in-progress, closed" },
          priority: { type: "string", description: "Filter by priority: low, medium, high, critical" },
          linkedFeature: { type: "string", description: "Filter by linked feature name" },
        },
        required: ["project"],
      },
    },
    {
      name: "get_bug",
      description: "Get full details of a specific bug by ID.",
      inputSchema: {
        type: "object" as const,
        properties: {
          project: { type: "string", description: "Project name" },
          id: { type: "string", description: "Bug ID (e.g. BUG-001)" },
        },
        required: ["project", "id"],
      },
    },
    {
      name: "create_bug",
      description: "Create a new bug report for a project.",
      inputSchema: {
        type: "object" as const,
        properties: {
          project: { type: "string", description: "Project name" },
          title: { type: "string", description: "Bug title" },
          description: { type: "string", description: "Bug description (markdown)" },
          priority: {
            type: "string",
            description: "Priority level",
            enum: ["low", "medium", "high", "critical"],
          },
          linkedFeature: { type: "string", description: "Feature name to link this bug to" },
        },
        required: ["project", "title", "description", "priority"],
      },
    },
    {
      name: "update_bug",
      description: "Update an existing bug's fields (title, status, priority, description, or linked feature).",
      inputSchema: {
        type: "object" as const,
        properties: {
          project: { type: "string", description: "Project name" },
          id: { type: "string", description: "Bug ID (e.g. BUG-001)" },
          title: { type: "string", description: "New title" },
          status: { type: "string", description: "New status: open, in-progress, closed" },
          priority: { type: "string", description: "New priority: low, medium, high, critical" },
          linkedFeature: { type: "string", description: "Feature to link to (empty string to unlink)" },
          description: { type: "string", description: "New description body (markdown)" },
        },
        required: ["project", "id"],
      },
    },
  ],
}));

// ---------------------------------------------------------------------------
// Tool dispatch
// ---------------------------------------------------------------------------

// Inline Zod schemas for argument validation
const ProjectArg = z.object({ name: z.string() });
const ProjectDocArg = z.object({
  name: z.string(),
  docName: z.enum(["overview.md", "mission-statement.md", "technical-design.md"]),
});
const WriteProjectDocArg = z.object({
  name: z.string(),
  docName: z.enum(["mission-statement.md", "technical-design.md"]),
  content: z.string(),
});
const ProjectOnly = z.object({ project: z.string() });
const FeatureArg = z.object({ project: z.string(), feature: z.string() });
const FeatureFileArg = z.object({ project: z.string(), feature: z.string(), file: z.string() });
const WriteFeatureFileArg = z.object({
  project: z.string(),
  feature: z.string(),
  file: z.string(),
  content: z.string(),
});
const CreateFeatureArg = z.object({
  project: z.string(),
  name: z.string(),
  requirements: z.string(),
});
const ListEpicsArg = z.object({ project: z.string() });
const GetEpicArg = z.object({ project: z.string(), epic: z.string() });
const CreateEpicArg = z.object({
  project: z.string(),
  name: z.string(),
  requirements: z.string(),
});
const ListBugsArg = z.object({
  project: z.string(),
  status: z.string().optional(),
  priority: z.string().optional(),
  linkedFeature: z.string().optional(),
});
const GetBugArg = z.object({ project: z.string(), id: z.string() });
const CreateBugArg = z.object({
  project: z.string(),
  title: z.string(),
  description: z.string(),
  priority: z.enum(["low", "medium", "high", "critical"]),
  linkedFeature: z.string().optional(),
});
const UpdateBugArg = z.object({
  project: z.string(),
  id: z.string(),
  title: z.string().optional(),
  status: z.enum(["open", "in-progress", "closed"]).optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
  linkedFeature: z.string().optional(),
  description: z.string().optional(),
});

function textResult(data: unknown, isError = false) {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: "text" as const, text }], ...(isError ? { isError: true } : {}) };
}

function errorResult(status: number, data: unknown) {
  const msg = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return textResult(`HTTP ${status}: ${msg}`, true);
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "list_projects": {
        const res = await apiCall("GET", "/api/projects");
        return res.ok ? textResult(res.data) : errorResult(res.status, res.data);
      }

      case "get_project": {
        const { name: projName } = ProjectArg.parse(args);
        const res = await apiCall("GET", `/api/projects/${encodeURIComponent(projName)}`);
        return res.ok ? textResult(res.data) : errorResult(res.status, res.data);
      }

      case "get_project_doc": {
        const { name: projName, docName } = ProjectDocArg.parse(args);
        const res = await apiCall("GET", `/api/projects/${encodeURIComponent(projName)}/doc/${encodeURIComponent(docName)}`);
        return res.ok ? textResult(res.data) : errorResult(res.status, res.data);
      }

      case "write_project_doc": {
        const { name: projName, docName, content } = WriteProjectDocArg.parse(args);
        const res = await apiCall("PUT", `/api/projects/${encodeURIComponent(projName)}/doc/${encodeURIComponent(docName)}`, {
          textBody: content,
        });
        return res.ok ? textResult(res.data) : errorResult(res.status, res.data);
      }

      case "list_features": {
        const { project } = ProjectOnly.parse(args);
        const res = await apiCall("GET", `/api/features/${encodeURIComponent(project)}`);
        return res.ok ? textResult(res.data) : errorResult(res.status, res.data);
      }

      case "get_feature": {
        const { project, feature } = FeatureArg.parse(args);
        const res = await apiCall("GET", `/api/features/${encodeURIComponent(project)}/${encodeFeatureRef(feature)}`);
        return res.ok ? textResult(res.data) : errorResult(res.status, res.data);
      }

      case "read_feature_file": {
        const { project, feature, file } = FeatureFileArg.parse(args);
        const res = await apiCall("GET", `/api/features/${encodeURIComponent(project)}/${encodeFeatureRef(feature)}/${encodeURIComponent(file)}`);
        return res.ok ? textResult(res.data) : errorResult(res.status, res.data);
      }

      case "write_feature_file": {
        const { project, feature, file, content } = WriteFeatureFileArg.parse(args);
        const res = await apiCall("PUT", `/api/features/${encodeURIComponent(project)}/${encodeFeatureRef(feature)}/${encodeURIComponent(file)}`, {
          textBody: content,
        });
        return res.ok ? textResult(res.data) : errorResult(res.status, res.data);
      }

      case "create_feature": {
        const { project, name: featName, requirements } = CreateFeatureArg.parse(args);
        const res = await apiCall("POST", `/api/features/${encodeURIComponent(project)}`, {
          body: { name: featName, requirements },
        });
        return res.ok ? textResult(res.data) : errorResult(res.status, res.data);
      }

      case "list_epics": {
        const { project } = ListEpicsArg.parse(args);
        const res = await apiCall("GET", `/api/epics/${encodeURIComponent(project)}`);
        return res.ok ? textResult(res.data) : errorResult(res.status, res.data);
      }

      case "get_epic": {
        const { project, epic } = GetEpicArg.parse(args);
        const res = await apiCall("GET", `/api/epics/${encodeURIComponent(project)}/${encodeURIComponent(epic)}`);
        return res.ok ? textResult(res.data) : errorResult(res.status, res.data);
      }

      case "create_epic": {
        const { project, name: epicName, requirements } = CreateEpicArg.parse(args);
        const res = await apiCall("POST", `/api/epics/${encodeURIComponent(project)}`, {
          body: { name: epicName, requirements },
        });
        return res.ok ? textResult(res.data) : errorResult(res.status, res.data);
      }

      case "list_bugs": {
        const { project, ...filters } = ListBugsArg.parse(args);
        const params: Record<string, string> = {};
        if (filters.status) params.status = filters.status;
        if (filters.priority) params.priority = filters.priority;
        if (filters.linkedFeature) params.linkedFeature = filters.linkedFeature;
        const res = await apiCall("GET", `/api/bugs/${encodeURIComponent(project)}`, { params });
        return res.ok ? textResult(res.data) : errorResult(res.status, res.data);
      }

      case "get_bug": {
        const { project, id } = GetBugArg.parse(args);
        const res = await apiCall("GET", `/api/bugs/${encodeURIComponent(project)}/${encodeURIComponent(id)}`);
        return res.ok ? textResult(res.data) : errorResult(res.status, res.data);
      }

      case "create_bug": {
        const { project, ...body } = CreateBugArg.parse(args);
        const res = await apiCall("POST", `/api/bugs/${encodeURIComponent(project)}`, { body });
        return res.ok ? textResult(res.data) : errorResult(res.status, res.data);
      }

      case "update_bug": {
        const { project, id, ...updates } = UpdateBugArg.parse(args);
        const res = await apiCall("PATCH", `/api/bugs/${encodeURIComponent(project)}/${encodeURIComponent(id)}`, {
          body: updates,
        });
        return res.ok ? textResult(res.data) : errorResult(res.status, res.data);
      }

      default:
        return textResult(`Unknown tool: ${name}`, true);
    }
  } catch (err) {
    if (err instanceof z.ZodError) {
      return textResult(`Invalid arguments: ${err.message}`, true);
    }
    const message = err instanceof Error ? err.message : String(err);
    return textResult(`Error: ${message}`, true);
  }
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
