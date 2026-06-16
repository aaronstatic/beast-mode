import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { MarkdownViewer } from "@/components/MarkdownViewer";
import { BugEditDialog } from "@/components/BugEditDialog";
import type { EpicViewModel } from "@/components/NewBugDialog";
import { ArrowLeft, Pencil, XCircle, RotateCcw } from "lucide-react";

interface BugDetail {
  id: string;
  title: string;
  status: "open" | "in-progress" | "closed";
  priority: "low" | "medium" | "high" | "critical";
  linkedFeature?: string;
  createdAt: string;
  updatedAt: string;
  body: string;
}

interface FeaturesApiResponse {
  features: { name: string; isEpic: boolean; children?: { name: string }[] }[];
  pathAccessible: boolean;
}

const statusBadgeVariant: Record<
  BugDetail["status"],
  "destructive" | "default" | "secondary"
> = {
  open: "destructive",
  "in-progress": "default",
  closed: "secondary",
};

const priorityBadgeVariant: Record<BugDetail["priority"], "destructive" | "default" | "secondary" | "outline"> = {
  critical: "destructive",
  high: "destructive",
  medium: "outline",
  low: "outline",
};

const priorityBadgeClass: Record<BugDetail["priority"], string> = {
  critical: "",
  high: "",
  medium: "border-yellow-600 bg-yellow-600/20 text-yellow-400 hover:bg-yellow-600/20",
  low: "",
};

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 30) return `${diffDays}d ago`;

  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function BugDetailPage() {
  const { name: project, id: bugId } = useParams<{
    name: string;
    id: string;
  }>();
  const navigate = useNavigate();

  const [bug, setBug] = useState<BugDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [features, setFeatures] = useState<string[]>([]);
  const [epics, setEpics] = useState<EpicViewModel[]>([]);
  const [editOpen, setEditOpen] = useState(false);
  const [closing, setClosing] = useState(false);

  const fetchBug = useCallback(() => {
    if (!project || !bugId) return;
    setLoading(true);
    setError(null);
    apiFetch<BugDetail>(`/api/bugs/${project}/${bugId}`)
      .then(setBug)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [project, bugId]);

  useEffect(() => {
    fetchBug();
  }, [fetchBug]);

  // Fetch features list for the edit dialog (derive epics view-model too)
  useEffect(() => {
    if (!project) return;
    apiFetch<FeaturesApiResponse>(`/api/features/${project}`)
      .then((data) => {
        setFeatures(
          data.features.filter((f) => !f.isEpic).map((f) => f.name)
        );
        setEpics(
          data.features
            .filter((f) => f.isEpic)
            .map((f) => ({
              name: f.name,
              children: (f.children ?? []).map((c) => c.name),
            }))
        );
      })
      .catch(() => {
        setFeatures([]);
        setEpics([]);
      });
  }, [project]);

  async function handleToggleStatus() {
    if (!bug || !project || !bugId) return;
    const newStatus = bug.status === "closed" ? "open" : "closed";

    if (
      newStatus === "closed" &&
      !window.confirm("Are you sure you want to close this bug?")
    ) {
      return;
    }

    setClosing(true);
    try {
      const updated = await apiFetch<BugDetail>(
        `/api/bugs/${project}/${bugId}`,
        {
          method: "PATCH",
          body: JSON.stringify({ status: newStatus }),
        }
      );
      setBug(updated);
    } catch {
      // ignore
    } finally {
      setClosing(false);
    }
  }

  if (!project || !bugId) return null;

  // Loading state
  if (loading) {
    return (
      <div className="p-4 sm:p-6 space-y-4 w-full max-w-4xl">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-full sm:w-96" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // Error state
  if (error || !bug) {
    return (
      <div className="p-4 sm:p-6 space-y-4 w-full max-w-4xl">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate(`/projects/${project}`)}
        >
          <ArrowLeft className="size-4 mr-1" />
          Back
        </Button>
        <div className="p-4 rounded-md bg-destructive/10 text-destructive text-sm">
          {error ?? "Bug not found"}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-6 w-full max-w-4xl">
      {/* Header */}
      <div className="space-y-3">
        {/* Back + Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => navigate(`/projects/${project}`)}
          >
            <ArrowLeft className="size-4" />
          </Button>
          <Link
            to={`/projects/${project}`}
            className="hover:text-foreground transition-colors truncate max-w-[120px] sm:max-w-none"
          >
            {project}
          </Link>
          <span>/</span>
          <span className="text-foreground">{bug.id}</span>
        </div>

        {/* Title */}
        <h1 className="text-xl sm:text-2xl font-bold">{bug.title}</h1>

        {/* Info panel */}
        <div className="flex items-center gap-3 flex-wrap">
          <Badge variant={statusBadgeVariant[bug.status]} className={bug.status === "in-progress" ? "bg-blue-600/60 text-white hover:bg-blue-600/60" : ""}>{bug.status}</Badge>
          <Badge variant={priorityBadgeVariant[bug.priority]} className={cn(priorityBadgeClass[bug.priority])}>
            {bug.priority}
          </Badge>
          {bug.linkedFeature && (
            <span className="text-sm">
              <span className="text-muted-foreground mr-1">Feature:</span>
              <Link
                to={`/projects/${project}/features/${bug.linkedFeature}`}
                className="text-primary hover:underline"
              >
                {bug.linkedFeature}
              </Link>
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            Created {formatDate(bug.createdAt)}
          </span>
          <span className="text-xs text-muted-foreground">
            Updated {formatDate(bug.updatedAt)}
          </span>
        </div>

        {/* Action buttons */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
            <Pencil className="size-4 mr-1" />
            Edit
          </Button>
          <Button
            size="sm"
            variant={bug.status === "closed" ? "outline" : "destructive"}
            onClick={handleToggleStatus}
            disabled={closing}
          >
            {bug.status === "closed" ? (
              <>
                <RotateCcw className="size-4 mr-1" />
                {closing ? "Reopening..." : "Reopen"}
              </>
            ) : (
              <>
                <XCircle className="size-4 mr-1" />
                {closing ? "Closing..." : "Close Bug"}
              </>
            )}
          </Button>
        </div>
      </div>

      <Separator />

      {/* Body */}
      {bug.body ? (
        <MarkdownViewer content={bug.body} />
      ) : (
        <p className="text-sm text-muted-foreground">No description provided.</p>
      )}

      {/* Edit Dialog */}
      <BugEditDialog
        project={project}
        bugId={bugId}
        bug={bug}
        features={features}
        epics={epics}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={fetchBug}
      />
    </div>
  );
}
