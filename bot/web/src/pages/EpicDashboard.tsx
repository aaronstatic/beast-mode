import { useState, useEffect, useMemo, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { apiFetch, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { FeatureBoard, type BoardEntry } from "@/components/FeatureBoard";
import { AddFeatureDialog } from "@/components/AddFeatureDialog";
import { UnlinkedBugsSidebar } from "@/components/UnlinkedBugsSidebar";
import type { EpicViewModel } from "@/components/NewBugDialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { MarkdownViewer } from "@/components/MarkdownViewer";
import { ArrowLeft, Layers, Copy, Check, FileText, BookOpen, Plus } from "lucide-react";

// --- Types ---

// Matches GET /api/epics/:project/:epic (bot/api-epics.ts). Children are
// FeatureInfo objects (name/status/completion/files); they do NOT carry a
// per-child openBugCount, so the board renders them without a bug badge.
interface EpicChild {
  name: string;
  status: "planning" | "planned" | "in-progress" | "complete";
  completion: number | null;
  files: string[];
  openBugCount?: number;
}

interface EpicDetail {
  name: string;
  status: "planning" | "planned" | "in-progress" | "complete";
  isPlanning: boolean;
  children: EpicChild[];
  hasOverview: boolean;
  hasRequirements: boolean;
}

const statusBadgeVariant: Record<
  EpicDetail["status"],
  "outline" | "secondary" | "default" | "destructive"
> = {
  planning: "outline",
  planned: "secondary",
  "in-progress": "default",
  complete: "default",
};

const statusBadgeClass: Record<EpicDetail["status"], string> = {
  planning: "",
  planned: "",
  "in-progress": "bg-blue-600/60 text-white hover:bg-blue-600/60",
  complete: "bg-bm-green/60 text-white hover:bg-bm-green/60",
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button
      onClick={handleCopy}
      className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-accent"
      title="Copy epic name"
    >
      {copied ? (
        <Check className="size-3 text-bm-green" />
      ) : (
        <Copy className="size-3 text-muted-foreground" />
      )}
    </button>
  );
}

export function EpicDashboard() {
  const { name, epic } = useParams<{ name: string; epic: string }>();
  const navigate = useNavigate();

  const [detail, setDetail] = useState<EpicDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [addFeatureDialogOpen, setAddFeatureDialogOpen] = useState(false);

  // Doc viewer dialog state (read-only, mirrors ProjectDashboard's pattern)
  const [docDialogOpen, setDocDialogOpen] = useState(false);
  const [docTitle, setDocTitle] = useState("");
  const [docContent, setDocContent] = useState("");
  const [docLoading, setDocLoading] = useState(false);

  async function openDoc(file: string, title: string) {
    if (!name || !detail) return;
    setDocTitle(title);
    setDocContent("");
    setDocDialogOpen(true);
    setDocLoading(true);
    try {
      const content = await apiFetch<string>(
        `/api/features/${name}/${detail.name}/${file}`
      );
      setDocContent(content);
    } catch {
      setDocContent("");
    } finally {
      setDocLoading(false);
    }
  }

  const loadDetail = useCallback(() => {
    if (!name || !epic) return;
    setLoading(true);
    setError(null);
    setNotFound(false);
    apiFetch<EpicDetail>(`/api/epics/${name}/${epic}`)
      .then(setDetail)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) {
          setNotFound(true);
        } else {
          setError(err.message);
        }
      })
      .finally(() => setLoading(false));
  }, [name, epic]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  // Build an EpicViewModel for this single epic so the NewBugDialog inside the
  // sidebar can offer the epic's children in the Feature select.
  // When epicScope is set on the sidebar the epic selector is hidden, but the
  // children are still needed so the user can pick a specific child feature.
  const epicsViewModel = useMemo<EpicViewModel[]>(
    () =>
      detail
        ? [{ name: detail.name, children: detail.children.map((c) => c.name) }]
        : [],
    [detail]
  );

  if (!name || !epic) return null;

  const breadcrumb = (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        onClick={() => navigate(`/projects/${name}`)}
      >
        <ArrowLeft className="size-4" />
      </Button>
      <Link
        to={`/projects/${name}`}
        className="hover:text-foreground transition-colors truncate max-w-[120px] sm:max-w-none"
      >
        {name}
      </Link>
      <span>/</span>
      <span className="text-foreground truncate">{epic}</span>
    </div>
  );

  // Map the epic's children to board entries (plain feature cards — no epic
  // nesting, no add affordances). openBugCount comes from the Phase 4 backend
  // follow-up; if absent (old API response) the board renders no bug badge.
  const entries: BoardEntry[] = (detail?.children ?? []).map((child) => ({
    name: child.name,
    status: child.status,
    completion: child.completion,
    files: child.files,
    isEpic: false,
    openBugCount: child.openBugCount,
  }));

  const hasChildren = entries.length > 0;

  return (
    <div className="flex flex-col lg:flex-row h-full">
      <div className="flex-1 overflow-auto p-4 sm:p-6">
        {/* Breadcrumb / back link */}
        <div className="mb-4">{breadcrumb}</div>

        {/* Header: epic name + status badge */}
        {loading ? (
          <div className="group flex items-center gap-2 mb-6">
            <Skeleton className="h-8 w-48" />
          </div>
        ) : detail ? (
          <>
            <div className="group flex items-center gap-3 mb-3 flex-wrap">
              <Layers className="size-5 text-violet-600 dark:text-violet-400" />
              <h2 className="text-2xl font-bold">{detail.name}</h2>
              <CopyButton text={detail.name} />
              <Badge className="bg-violet-600/60 text-white hover:bg-violet-600/60">
                Epic
              </Badge>
              <Badge
                variant={statusBadgeVariant[detail.status]}
                className={cn(statusBadgeClass[detail.status])}
              >
                {detail.status}
              </Badge>
            </div>
            {(detail.hasOverview || detail.hasRequirements) && (
              <div className="flex items-center gap-2 mb-6 overflow-x-auto">
                {detail.hasOverview && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 shrink-0"
                    onClick={() => openDoc("epic-overview.md", "Epic Overview")}
                  >
                    <FileText className="size-3.5" />
                    Overview
                  </Button>
                )}
                {detail.hasRequirements && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 shrink-0"
                    onClick={() => openDoc("epic-requirements.md", "Epic Requirements")}
                  >
                    <BookOpen className="size-3.5" />
                    Requirements
                  </Button>
                )}
              </div>
            )}
          </>
        ) : null}

        {error && (
          <div className="mb-4 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
            {error}
          </div>
        )}

        {/* Loading skeletons (mirror the dashboard board skeleton) */}
        {loading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {["planning", "planned", "in-progress", "complete"].map((col) => (
              <div key={col} className="space-y-1.5">
                <Skeleton className="h-6 w-24" />
                <Skeleton className="h-28 w-full" />
                <Skeleton className="h-28 w-full" />
              </div>
            ))}
          </div>
        )}

        {/* Epic not found (404) */}
        {!loading && notFound && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <p className="text-muted-foreground mb-2">Epic not found</p>
            <p className="text-xs text-muted-foreground mb-4">
              No epic named <code className="bg-muted px-1 rounded">{epic}</code> exists in this project.
            </p>
            <Button variant="outline" onClick={() => navigate(`/projects/${name}`)}>
              <ArrowLeft className="size-4" />
              Back to project
            </Button>
          </div>
        )}

        {/* Empty state: a planning/planned epic with no child features yet */}
        {!loading && !error && !notFound && detail && !hasChildren && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <p className="text-muted-foreground mb-3">No features in this epic yet</p>
            <Button onClick={() => setAddFeatureDialogOpen(true)} className="mb-4 gap-1">
              <Plus className="size-4" />
              Add Feature
            </Button>
            <p className="text-xs text-muted-foreground max-w-md">
              Or add one from the CLI with{" "}
              <code className="bg-muted px-1 rounded">
                /plan-feature {epic}/&lt;feature&gt;
              </code>
              .
            </p>
          </div>
        )}

        {/* Board scoped to this epic's children */}
        {!loading && !error && !notFound && detail && hasChildren && (
          <FeatureBoard
            entries={entries}
            onOpenFeature={(feature) =>
              navigate(`/projects/${name}/features/${epic}/${feature}`)
            }
            onAddFeature={() => setAddFeatureDialogOpen(true)}
            copyPrefix={detail.name}
          />
        )}

        {/* Doc viewer dialog (read-only) */}
        <Dialog open={docDialogOpen} onOpenChange={setDocDialogOpen}>
          <DialogContent className="!w-[95vw] sm:!w-[60vw] !max-w-[95vw] sm:!max-w-[60vw] max-h-[80vh] overflow-auto">
            <DialogHeader>
              <DialogTitle>{docTitle}</DialogTitle>
              <DialogDescription>
                {detail?.name} — {docTitle}
              </DialogDescription>
            </DialogHeader>
            {docLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            ) : (
              <MarkdownViewer content={docContent} />
            )}
          </DialogContent>
        </Dialog>

        {/* Add Feature into this epic — creates docs/features/<epic>/<feature>/requirements.md */}
        <AddFeatureDialog
          project={name}
          epic={epic}
          open={addFeatureDialogOpen}
          onOpenChange={setAddFeatureDialogOpen}
          onCreated={loadDetail}
        />
      </div>

      {/* Bug sidebar scoped to the epic + its child features (Model A).
          epics prop provides the children so NewBugDialog can offer a Feature
          select within the epic (even though the epic selector is hidden). */}
      <UnlinkedBugsSidebar project={name} epicScope={epic} epics={epicsViewModel} />
    </div>
  );
}
