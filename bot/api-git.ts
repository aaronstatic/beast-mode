// API routes for /api/git/*
// Provides Git status, log, commit, push, and pull operations for registered projects.

import { existsSync } from "fs";
import { join } from "path";
import { jsonResponse, errorResponse, getPathSegments, parseBody } from "./http-helpers.ts";
import { getProject, resolveProjectPath } from "./registry.ts";
import type { Config } from "./types.ts";
import { GitCommitPayloadSchema } from "./types.ts";
import { gitLog } from "./logger.ts";

// Run a git command in the given working directory.

async function runGit(
  args: string[],
  cwd: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
  } catch {
    return { stdout: "", stderr: "git not found or failed to execute", exitCode: -1 };
  }
}

// Derive a GitHub web URL from a git remote URL.

function deriveGithubUrl(remoteUrl: string): string {
  if (!remoteUrl.includes("github.com")) return "";
  // SSH: git@github.com:owner/repo.git
  const sshMatch = remoteUrl.match(/github\.com[:/](.+?)(?:\.git)?$/);
  if (sshMatch) return `https://github.com/${sshMatch[1]}`;
  // HTTPS: https://github.com/owner/repo.git
  try {
    const u = new URL(remoteUrl);
    return `https://github.com${u.pathname.replace(/\.git$/, "")}`;
  } catch {
    return "";
  }
}

export async function handleApiGitRoutes(
  req: Request,
  url: URL,
  config: Config
): Promise<Response | null> {
  if (!url.pathname.startsWith("/api/git")) return null;

  const segments = getPathSegments(url, "/api/git");

  // All endpoints require at least 2 segments: :project/:action
  if (segments.length < 2) return null;

  const projectName = segments[0];

  // Validate project exists and path is accessible
  const project = getProject(projectName);
  if (!project) return errorResponse("Project not found", 404);

  const localPath = resolveProjectPath(project, config);
  if (!existsSync(localPath)) return errorResponse("Project path not accessible", 404);

  // GET /api/git/:project/status
  if (req.method === "GET" && segments.length === 2 && segments[1] === "status") {
    // 1. Check if inside a git repo
    const isRepo = await runGit(["rev-parse", "--is-inside-work-tree"], localPath);
    if (isRepo.exitCode !== 0) {
      return jsonResponse({ isGitRepo: false });
    }

    // 2. Get current branch
    let branch: string;
    const branchResult = await runGit(["symbolic-ref", "--short", "HEAD"], localPath);
    if (branchResult.exitCode !== 0) {
      const detached = await runGit(["rev-parse", "--short", "HEAD"], localPath);
      branch = `detached:${detached.stdout}`;
    } else {
      branch = branchResult.stdout;
    }

    // 3. Parse porcelain status
    const statusResult = await runGit(["status", "--porcelain=v1"], localPath);
    let changedFiles = 0;
    let untrackedFiles = 0;
    if (statusResult.stdout) {
      for (const line of statusResult.stdout.split("\n")) {
        if (!line) continue;
        if (line.startsWith("??")) {
          untrackedFiles++;
        } else {
          changedFiles++;
        }
      }
    }

    // 4. Get diff stats
    const diffResult = await runGit(["diff", "--shortstat", "HEAD"], localPath);
    let linesAdded = 0;
    let linesRemoved = 0;
    if (diffResult.stdout) {
      const addMatch = diffResult.stdout.match(/(\d+) insertion/);
      const delMatch = diffResult.stdout.match(/(\d+) deletion/);
      if (addMatch) linesAdded = parseInt(addMatch[1], 10);
      if (delMatch) linesRemoved = parseInt(delMatch[1], 10);
    }

    // 5. Get remote URL
    const remoteResult = await runGit(["remote", "get-url", "origin"], localPath);
    const remoteUrl = remoteResult.exitCode === 0 ? remoteResult.stdout : "";

    // 6. Derive GitHub info
    const isGitHub = remoteUrl.includes("github.com");
    const githubUrl = deriveGithubUrl(remoteUrl);

    // 7. Get upstream branch
    const upstreamResult = await runGit(
      ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
      localPath
    );
    const upstreamBranch = upstreamResult.exitCode === 0 ? upstreamResult.stdout : "";

    return jsonResponse({
      isGitRepo: true,
      branch,
      changedFiles,
      untrackedFiles,
      linesAdded,
      linesRemoved,
      remoteUrl,
      isGitHub,
      githubUrl,
      upstreamBranch,
    });
  }

  // GET /api/git/:project/log
  if (req.method === "GET" && segments.length === 2 && segments[1] === "log") {
    const result = await runGit(
      ["log", "--max-count=20", "--pretty=format:%H|%h|%s|%an|%ar"],
      localPath
    );

    if (!result.stdout) {
      return jsonResponse({ commits: [] });
    }

    const commits = result.stdout.split("\n").filter(Boolean).map((line) => {
      const [hash, shortHash, ...rest] = line.split("|");
      const relativeDate = rest.pop()!;
      const author = rest.pop()!;
      const subject = rest.join("|");
      return { hash, shortHash, subject, author, relativeDate };
    });

    return jsonResponse({ commits });
  }

  // POST /api/git/:project/commit
  if (req.method === "POST" && segments.length === 2 && segments[1] === "commit") {
    const parsed = await parseBody(req, GitCommitPayloadSchema);
    if (!parsed.ok) return parsed.response;

    const sanitizedMessage = parsed.data.message.replace(/[\r\n]/g, " ").trim();

    // Stage all changes
    const addResult = await runGit(["add", "-A"], localPath);
    if (addResult.exitCode !== 0) {
      return errorResponse("Failed to stage files: " + addResult.stderr, 500);
    }

    // Commit
    const result = await runGit(["commit", "-m", sanitizedMessage], localPath);
    if (result.exitCode !== 0) {
      if (result.stdout.includes("nothing to commit")) {
        return errorResponse("Nothing to commit", 400);
      }
      return errorResponse("Commit failed: " + result.stderr, 500);
    }

    const hashMatch = result.stdout.match(/\[[\w/.-]+ ([a-f0-9]+)\]/);
    const hash = hashMatch?.[1] ?? "";

    gitLog.info("Committed", { project: projectName, hash });

    return jsonResponse({ ok: true, hash });
  }

  // POST /api/git/:project/push
  if (req.method === "POST" && segments.length === 2 && segments[1] === "push") {
    // Get current branch
    const branchResult = await runGit(["symbolic-ref", "--short", "HEAD"], localPath);
    const branch = branchResult.stdout;

    // Check upstream
    const upstreamResult = await runGit(
      ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
      localPath
    );

    let pushResult;
    if (upstreamResult.exitCode !== 0) {
      // No upstream — set it
      pushResult = await runGit(["push", "--set-upstream", "origin", branch], localPath);
    } else {
      pushResult = await runGit(["push"], localPath);
    }

    if (pushResult.exitCode !== 0) {
      return errorResponse("Push failed: " + pushResult.stderr, 500);
    }

    gitLog.info("Pushed", { project: projectName, branch });

    return jsonResponse({ ok: true });
  }

  // POST /api/git/:project/pull
  if (req.method === "POST" && segments.length === 2 && segments[1] === "pull") {
    const result = await runGit(["pull"], localPath);
    if (result.exitCode !== 0) {
      return errorResponse("Pull failed: " + result.stderr, 500);
    }

    gitLog.info("Pulled", { project: projectName });

    return jsonResponse({ ok: true });
  }

  return null;
}
