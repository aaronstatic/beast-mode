import { useState, useEffect, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  GitBranch,
  GitCommitHorizontal,
  ExternalLink,
  Loader2,
  ArrowUp,
  ArrowDown,
} from "lucide-react";

interface GitPanelProps {
  project: string;
}

interface GitStatus {
  isGitRepo: boolean;
  branch: string;
  changedFiles: number;
  untrackedFiles: number;
  linesAdded: number;
  linesRemoved: number;
  remoteUrl: string;
  isGitHub: boolean;
  githubUrl: string;
  upstreamBranch: string;
}

interface GitCommit {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  relativeDate: string;
}

// Ordered alternation — longest/most-specific first so `feat/<epic>/<feature>`
// wins at any position over the shorter `feat/<feature>` alternative.
//
// Group layout:
//   m[1], m[2] — feat/<epic>/<feature>  (two-segment feat ref)
//   m[3]       — epic/<name>            (standalone epic ref)
//   m[4]       — feat/<feature>         (one-segment feat ref, no second slash)
//
// The negative lookahead (?![a-zA-Z0-9_\-/]) on patterns 2 & 3 ensures we
// don't capture a prefix of a longer unrecognized token like feat/a/b/c/d
// (pattern 1 already handles the two-segment case, and three-or-more segments
// are left as plain text after consuming the first two).
const COMMIT_REF_PATTERN =
  /\bfeat\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)(?![a-zA-Z0-9_\-/])|\bepic\/([a-zA-Z0-9_-]+)(?![a-zA-Z0-9_\-/])|\bfeat\/([a-zA-Z0-9_-]+)(?![a-zA-Z0-9_\-/])/g;

type CommitToken =
  | string
  | { kind: "feat-plain"; feature: string; match: string }
  | { kind: "feat-epic-feature"; epic: string; feature: string; match: string }
  | { kind: "epic"; name: string; match: string };

function CommitSubject({ subject, project }: { subject: string; project: string }) {
  const parts = useMemo(() => {
    const result: CommitToken[] = [];
    let lastIndex = 0;
    for (const m of subject.matchAll(COMMIT_REF_PATTERN)) {
      if (m.index! > lastIndex) result.push(subject.slice(lastIndex, m.index!));
      if (m[1] !== undefined && m[2] !== undefined) {
        // feat/<epic>/<feature>
        result.push({ kind: "feat-epic-feature", epic: m[1], feature: m[2], match: m[0] });
      } else if (m[3] !== undefined) {
        // epic/<name>
        result.push({ kind: "epic", name: m[3], match: m[0] });
      } else {
        // feat/<feature>
        result.push({ kind: "feat-plain", feature: m[4], match: m[0] });
      }
      lastIndex = m.index! + m[0].length;
    }
    if (lastIndex < subject.length) result.push(subject.slice(lastIndex));
    return result;
  }, [subject]);

  if (parts.length === 1 && typeof parts[0] === "string") return <>{subject}</>;

  const linkClass = "text-primary underline underline-offset-2 hover:text-primary/80";

  return (
    <>
      {parts.map((part, i) => {
        if (typeof part === "string") {
          return <span key={i}>{part}</span>;
        }
        if (part.kind === "feat-plain") {
          return (
            <Link
              key={i}
              to={`/projects/${project}/features/${part.feature}`}
              className={linkClass}
              onClick={(e) => e.stopPropagation()}
            >
              {part.match}
            </Link>
          );
        }
        if (part.kind === "epic") {
          return (
            <Link
              key={i}
              to={`/projects/${project}/epics/${part.name}`}
              className={linkClass}
              onClick={(e) => e.stopPropagation()}
            >
              {part.match}
            </Link>
          );
        }
        // feat-epic-feature: render as "feat/" + <epic-link> + "/" + <feature-link>
        return (
          <span key={i}>
            <span>feat/</span>
            <Link
              to={`/projects/${project}/epics/${part.epic}`}
              className={linkClass}
              onClick={(e) => e.stopPropagation()}
            >
              {part.epic}
            </Link>
            <span>/</span>
            <Link
              to={`/projects/${project}/features/${part.epic}/${part.feature}`}
              className={linkClass}
              onClick={(e) => e.stopPropagation()}
            >
              {part.feature}
            </Link>
          </span>
        );
      })}
    </>
  );
}

export function GitPanel({ project }: GitPanelProps) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [commitDialogOpen, setCommitDialogOpen] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);

  const [commitsDialogOpen, setCommitsDialogOpen] = useState(false);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [commitsLoading, setCommitsLoading] = useState(false);

  const [pushing, setPushing] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const data = await apiFetch<GitStatus>(`/api/git/${project}/status`);
      setStatus(data);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [project]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  function showActionError(message: string) {
    setActionError(message);
    setTimeout(() => setActionError(null), 5000);
  }

  async function handleCommit(e: React.FormEvent) {
    e.preventDefault();
    if (!commitMessage.trim()) return;

    setCommitting(true);
    setCommitError(null);
    try {
      await apiFetch(`/api/git/${project}/commit`, {
        method: "POST",
        body: JSON.stringify({ message: commitMessage.trim() }),
      });
      setCommitMessage("");
      setCommitDialogOpen(false);
      fetchStatus();
    } catch (err) {
      setCommitError(
        err instanceof Error ? err.message : "Failed to commit"
      );
    } finally {
      setCommitting(false);
    }
  }

  function handleCommitDialogChange(open: boolean) {
    setCommitDialogOpen(open);
    if (!open) {
      setCommitMessage("");
      setCommitError(null);
    }
  }

  async function handleOpenCommitsDialog(open: boolean) {
    setCommitsDialogOpen(open);
    if (open) {
      setCommitsLoading(true);
      try {
        const data = await apiFetch<{ commits: GitCommit[] }>(
          `/api/git/${project}/log`
        );
        setCommits(data.commits);
      } catch {
        setCommits([]);
      } finally {
        setCommitsLoading(false);
      }
    }
  }

  async function handlePush() {
    setPushing(true);
    setActionError(null);
    try {
      await apiFetch(`/api/git/${project}/push`, { method: "POST" });
      fetchStatus();
    } catch (err) {
      showActionError(err instanceof Error ? err.message : "Push failed");
    } finally {
      setPushing(false);
    }
  }

  async function handlePull() {
    setPulling(true);
    setActionError(null);
    try {
      await apiFetch(`/api/git/${project}/pull`, { method: "POST" });
      fetchStatus();
    } catch (err) {
      showActionError(err instanceof Error ? err.message : "Pull failed");
    } finally {
      setPulling(false);
    }
  }

  if (loading) {
    return <Skeleton className="h-20 w-full" />;
  }

  if (error) {
    return (
      <p className="text-sm text-muted-foreground">Git status unavailable</p>
    );
  }

  if (!status || !status.isGitRepo) {
    return (
      <p className="text-sm text-muted-foreground">Not a git repository</p>
    );
  }

  const isClean =
    status.changedFiles === 0 && status.untrackedFiles === 0;
  const hasRemote = status.remoteUrl !== "";

  return (
    <>
      <div className="mb-6 rounded-lg border bg-muted/20 p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="flex items-center gap-1.5 font-medium">
            <GitBranch className="size-3.5" />
            {status.branch}
          </span>
          {isClean ? (
            <>
              <span className="text-muted-foreground">·</span>
              <span className="text-bm-green">Clean</span>
            </>
          ) : (
            <>
              {status.changedFiles > 0 && (
                <>
                  <span className="text-muted-foreground">·</span>
                  <span>{status.changedFiles} changed</span>
                </>
              )}
              {status.untrackedFiles > 0 && (
                <>
                  <span className="text-muted-foreground">·</span>
                  <span>{status.untrackedFiles} untracked</span>
                </>
              )}
              <span className="text-muted-foreground">·</span>
              <span>
                <span className="text-bm-green">+{status.linesAdded}</span>
                {" "}
                <span className="text-bm-red">-{status.linesRemoved}</span>
              </span>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => setCommitDialogOpen(true)}
          >
            <GitCommitHorizontal className="size-3.5" />
            Commit
          </Button>
          {hasRemote && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={handlePush}
                disabled={pushing}
              >
                {pushing ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <ArrowUp className="size-3.5" />
                )}
                Push
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={handlePull}
                disabled={pulling}
              >
                {pulling ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <ArrowDown className="size-3.5" />
                )}
                Pull
              </Button>
            </>
          )}
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => handleOpenCommitsDialog(true)}
          >
            <GitCommitHorizontal className="size-3.5" />
            Commits
          </Button>
          <div className="flex-1" />
          {status.isGitHub && (
            <Button variant="outline" size="sm" className="gap-1.5" asChild>
              <a
                href={status.githubUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink className="size-3.5" />
                GitHub
              </a>
            </Button>
          )}
        </div>

        {actionError && (
          <p className="text-xs text-destructive">{actionError}</p>
        )}
      </div>

      <Dialog open={commitDialogOpen} onOpenChange={handleCommitDialogChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Commit Changes</DialogTitle>
            <DialogDescription>
              Stage and commit all changes in {project}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCommit} className="space-y-4">
            <div className="space-y-2">
              <Input
                placeholder="Commit message..."
                value={commitMessage}
                onChange={(e) =>
                  setCommitMessage(e.target.value.slice(0, 500))
                }
                maxLength={500}
              />
              <p className="text-xs text-muted-foreground text-right">
                {commitMessage.length}/500
              </p>
            </div>

            {commitError && (
              <p className="text-sm text-destructive">{commitError}</p>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleCommitDialogChange(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!commitMessage.trim() || committing}
              >
                {committing && (
                  <Loader2 className="size-4 animate-spin" />
                )}
                {committing ? "Committing..." : "Commit All"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={commitsDialogOpen}
        onOpenChange={setCommitsDialogOpen}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Commits</DialogTitle>
            <DialogDescription>
              Recent commit history for {project}
            </DialogDescription>
          </DialogHeader>
          {commitsLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : commits.length === 0 ? (
            <p className="text-sm text-muted-foreground">No commits yet</p>
          ) : (
            <ScrollArea className="max-h-[60vh]">
              <div>
                {commits.map((commit) => (
                  <div
                    key={commit.hash}
                    className="border-b last:border-0 py-2"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-muted-foreground">
                        {commit.shortHash}
                      </span>
                      <span className="text-sm">
                        <CommitSubject subject={commit.subject} project={project} />
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {commit.author} · {commit.relativeDate}
                    </p>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
