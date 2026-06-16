import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import { MarkdownViewer } from "@/components/MarkdownViewer";
import { NewBugDialog } from "@/components/NewBugDialog";
import type { EpicViewModel } from "@/components/NewBugDialog";
import { ArrowLeft, Pencil, Save, X, Bug, Plus, ChevronDown, ChevronUp, Copy, Check } from "lucide-react";

// --- Types ---

interface PhaseInfo {
  number: number;
  title: string;
  completion: number | null;
}

interface FeatureDetail {
  name: string;
  status: "planning" | "planned" | "in-progress" | "complete";
  completion: number | null;
  files: string[];
  description: string | null;
  phases: PhaseInfo[];
}

interface LinkedBug {
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

// --- Helpers ---

const statusBadgeVariant: Record<
  FeatureDetail["status"],
  "outline" | "secondary" | "default" | "destructive"
> = {
  planning: "outline",
  planned: "secondary",
  "in-progress": "default",
  complete: "default",
};

const statusBadgeClass: Record<FeatureDetail["status"], string> = {
  planning: "",
  planned: "",
  "in-progress": "bg-blue-600/60 text-white hover:bg-blue-600/60",
  complete: "bg-bm-green/60 text-white hover:bg-bm-green/60",
};

const priorityBadgeVariant: Record<LinkedBug["priority"], "destructive" | "default" | "secondary" | "outline"> = {
  critical: "destructive",
  high: "destructive",
  medium: "outline",
  low: "outline",
};

const priorityBadgeClass: Record<LinkedBug["priority"], string> = {
  critical: "",
  high: "",
  medium: "border-yellow-600 bg-yellow-600/20 text-yellow-400 hover:bg-yellow-600/20",
  low: "",
};

const bugStatusVariant: Record<LinkedBug["status"], "outline" | "secondary" | "default"> = {
  open: "outline",
  "in-progress": "outline",
  closed: "secondary",
};

const bugStatusClass: Record<LinkedBug["status"], string> = {
  open: "",
  "in-progress": "border-blue-600 bg-blue-600/20 text-blue-400",
  closed: "opacity-50",
};

function tabLabel(filename: string): string {
  const name = filename.replace(/\.md$/, "");
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// --- Tab Content Component ---

function FileTabContent({
  project,
  feature,
  file,
  isActive,
}: {
  project: string;
  feature: string;
  file: string;
  isActive: boolean;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [savedContent, setSavedContent] = useState<string | null>(null);
  const [editContent, setEditContent] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const fetchedRef = useRef(false);

  const fetchContent = useCallback(() => {
    setLoading(true);
    apiFetch<string>(`/api/features/${project}/${feature}/${file}`)
      .then((text) => {
        setContent(text);
        setSavedContent(text);
        fetchedRef.current = true;
      })
      .catch(() => {
        setContent("*Failed to load file*");
        setSavedContent("");
      })
      .finally(() => setLoading(false));
  }, [project, feature, file]);

  useEffect(() => {
    if (isActive && !fetchedRef.current) {
      fetchContent();
    }
  }, [isActive, fetchContent]);

  function handleEdit() {
    setEditContent(savedContent ?? "");
    setEditing(true);
    setDirty(false);
  }

  function handleCancel() {
    if (dirty) {
      if (!window.confirm("Discard unsaved changes?")) return;
    }
    setEditing(false);
    setDirty(false);
    setEditContent("");
  }

  async function handleSave() {
    setSaving(true);
    try {
      await apiFetch(`/api/features/${project}/${feature}/${file}`, {
        method: "PUT",
        headers: { "Content-Type": "text/plain" },
        body: editContent,
      });
      setContent(editContent);
      setSavedContent(editContent);
      setEditing(false);
      setDirty(false);
    } catch {
      // stay in edit mode on failure
    } finally {
      setSaving(false);
    }
  }

  function handleEditorChange(md: string) {
    setEditContent(md);
    setDirty(md !== savedContent);
  }

  // beforeunload guard
  useEffect(() => {
    if (!dirty) return;
    function handler(e: BeforeUnloadEvent) {
      e.preventDefault();
    }
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  if (loading || content === null) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end gap-2">
        {editing ? (
          <>
            {dirty && (
              <span className="text-xs text-amber-500 mr-2">
                Unsaved changes
              </span>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={handleCancel}
              disabled={saving}
            >
              <X className="size-4 mr-1" />
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving}>
              <Save className="size-4 mr-1" />
              {saving ? "Saving..." : "Save"}
            </Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" onClick={handleEdit}>
            <Pencil className="size-4 mr-1" />
            Edit
          </Button>
        )}
      </div>

      {editing ? (
        <MarkdownEditor
          content={editContent}
          onChange={handleEditorChange}
          className="min-h-[250px] sm:min-h-[400px]"
        />
      ) : (
        <MarkdownViewer content={content} />
      )}
    </div>
  );
}

// --- Linked Bugs Section (used for both mobile and desktop) ---

function LinkedBugsList({
  project,
  bugs,
  bugsLoading,
  navigate,
}: {
  project: string;
  bugs: LinkedBug[];
  bugsLoading: boolean;
  navigate: ReturnType<typeof useNavigate>;
}) {
  return (
    <div className="p-2 space-y-2">
      {bugsLoading && (
        <>
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </>
      )}

      {!bugsLoading && bugs.length === 0 && (
        <div className="p-4 text-center text-sm text-muted-foreground">
          No linked bugs
        </div>
      )}

      {!bugsLoading &&
        bugs.map((bug) => (
          <button
            key={bug.id}
            onClick={() =>
              navigate(`/projects/${project}/bugs/${bug.id}`)
            }
            className={cn(
              "w-full text-left rounded-md border bg-card p-3 space-y-1.5 hover:bg-accent/50 transition-colors",
              bug.status === "closed" && "opacity-50",
              bug.status === "in-progress" && "border-l-2 border-l-blue-500"
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-mono text-muted-foreground">
                {bug.id}
              </span>
              <div className="flex items-center gap-1">
                <Badge
                  variant={bugStatusVariant[bug.status]}
                  className={cn("text-[10px] px-1.5", bugStatusClass[bug.status])}
                >
                  {bug.status}
                </Badge>
                <Badge
                  variant={priorityBadgeVariant[bug.priority]}
                  className={cn("text-[10px] px-1.5", priorityBadgeClass[bug.priority])}
                >
                  {bug.priority}
                </Badge>
              </div>
            </div>
            <p className={cn(
              "text-sm font-medium leading-tight line-clamp-2",
              bug.status === "closed" && "line-through"
            )}>
              {bug.title}
            </p>
          </button>
        ))}
    </div>
  );
}

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
      className="p-0.5 rounded hover:bg-accent"
      title="Copy to clipboard"
    >
      {copied ? (
        <Check className="size-3.5 text-bm-green" />
      ) : (
        <Copy className="size-3.5 text-muted-foreground" />
      )}
    </button>
  );
}

// --- Phase Strip ---

function PhaseStrip({ phases }: { phases: PhaseInfo[] }) {
  if (phases.length === 0) return null;

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
        Phases
      </h3>
      <div className="flex flex-col gap-1">
        {phases.map((phase) => {
          const isComplete = phase.completion === 100;
          const isInProgress =
            phase.completion !== null &&
            phase.completion > 0 &&
            phase.completion < 100;

          return (
            <div
              key={phase.number}
              className={cn(
                "flex items-center gap-3 rounded-md border px-3 py-2 text-sm",
                isComplete &&
                  "border-bm-green/50 bg-bm-green/10 text-bm-green",
                isInProgress &&
                  "border-blue-600/50 bg-blue-600/10 text-blue-400",
                !isComplete &&
                  !isInProgress &&
                  "border-border bg-muted/30 text-muted-foreground"
              )}
            >
              <span className="font-mono font-semibold opacity-60 w-5 text-center flex-shrink-0">
                {phase.number}
              </span>
              <span className="font-medium flex-1 truncate">
                {phase.title}
              </span>
              {phase.completion !== null && (
                <div className="flex items-center gap-2 flex-shrink-0">
                  <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all",
                        isComplete ? "bg-bm-green" : "bg-blue-500"
                      )}
                      style={{ width: `${phase.completion}%` }}
                    />
                  </div>
                  <span
                    className={cn(
                      "text-xs tabular-nums w-8 text-right",
                      isComplete
                        ? "text-bm-green"
                        : "text-muted-foreground"
                    )}
                  >
                    {phase.completion}%
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- Main Page ---

export function FeatureDetailPage() {
  const { name: project, epic, feature: featureName } = useParams<{
    name: string;
    epic?: string;
    feature: string;
  }>();
  const navigate = useNavigate();

  // When this page is reached via the nested route
  // (/projects/:name/features/:epic/:feature), `epic` is set and every feature
  // API call + bug link uses the `<epic>/<feature>` reference. On the plain
  // route `epic` is undefined and the ref is just the feature name — behavior
  // is identical to before. (The `?? ""` only satisfies the type: featureRef is
  // never used before the `if (!project || !featureName) return null` guard,
  // and the effects early-return when featureName is falsy.)
  const featureRef = epic ? `${epic}/${featureName ?? ""}` : featureName ?? "";
  // Where "back" returns to: the epic page when nested, else the project.
  const backTo = epic
    ? `/projects/${project}/epics/${epic}`
    : `/projects/${project}`;

  const [detail, setDetail] = useState<FeatureDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [bugs, setBugs] = useState<LinkedBug[]>([]);
  const [bugsLoading, setBugsLoading] = useState(true);

  const [activeTab, setActiveTab] = useState<string>("");

  // Track which tabs have dirty state for the unsaved indicator
  const [dirtyTabs, setDirtyTabs] = useState<Set<string>>(new Set());

  // New Bug dialog state
  const [newBugOpen, setNewBugOpen] = useState(false);

  // Project-wide features + epics, so the New Bug dialog can show the Epic
  // dropdown and populate the Feature dropdown options (matching BugDetailPage).
  // Without this, opening "New Bug" on a feature inside an epic leaves the
  // epic/feature dropdowns empty instead of pre-filled.
  const [allFeatures, setAllFeatures] = useState<string[]>([]);
  const [epics, setEpics] = useState<EpicViewModel[]>([]);

  useEffect(() => {
    if (!project) return;
    apiFetch<FeaturesApiResponse>(`/api/features/${project}`)
      .then((data) => {
        setAllFeatures(
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
        setAllFeatures([]);
        setEpics([]);
      });
  }, [project]);

  // Mobile bugs section
  const [mobileBugsExpanded, setMobileBugsExpanded] = useState(false);

  // Bug status filter
  const [bugStatusFilter, setBugStatusFilter] = useState<"all" | "open" | "closed">("all");

  useEffect(() => {
    if (!project || !featureName) return;
    setLoading(true);
    setError(null);
    apiFetch<FeatureDetail>(`/api/features/${project}/${featureRef}`)
      .then((data) => {
        setDetail(data);
        if (data.files.length > 0 && !activeTab) {
          setActiveTab(data.files[0]);
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [project, featureRef]);

  function fetchBugs() {
    if (!project || !featureName) return;
    setBugsLoading(true);
    apiFetch<LinkedBug[]>(
      `/api/bugs/${project}?linkedFeature=${encodeURIComponent(featureRef)}`
    )
      .then((data) => {
        const sorted = [...data].sort((a, b) => {
          const aOpen = a.status !== "closed" ? 0 : 1;
          const bOpen = b.status !== "closed" ? 0 : 1;
          return aOpen - bOpen;
        });
        setBugs(sorted);
      })
      .catch(() => setBugs([]))
      .finally(() => setBugsLoading(false));
  }

  useEffect(() => {
    fetchBugs();
  }, [project, featureRef]);

  if (!project || !featureName) return null;

  // --- Loading state ---
  if (loading) {
    return (
      <div className="p-4 sm:p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-full sm:w-96" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // --- Error state ---
  if (error || !detail) {
    return (
      <div className="p-4 sm:p-6 space-y-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate(backTo)}
        >
          <ArrowLeft className="size-4 mr-1" />
          Back
        </Button>
        <div className="p-4 rounded-md bg-destructive/10 text-destructive text-sm">
          {error ?? "Feature not found"}
        </div>
      </div>
    );
  }

  const openBugCount = bugs.filter((b) => b.status !== "closed").length;
  const closedBugCount = bugs.filter((b) => b.status === "closed").length;

  const filteredBugs = bugs.filter((bug) => {
    if (bugStatusFilter === "open") return bug.status === "open" || bug.status === "in-progress";
    if (bugStatusFilter === "closed") return bug.status === "closed";
    return true;
  });

  const bugFilterButtons = (
    <div className="px-2 pt-2 flex gap-1">
      {(["all", "open", "closed"] as const).map((f) => (
        <Button
          key={f}
          variant={bugStatusFilter === f ? "secondary" : "ghost"}
          size="xs"
          className="text-[11px] px-2 h-6 rounded-full"
          onClick={() => setBugStatusFilter(f)}
        >
          {f === "all" ? "All" : f === "open" ? "Open" : "Closed"}
        </Button>
      ))}
    </div>
  );

  function handleTabChange(newTab: string) {
    // Warn if current tab has unsaved changes
    if (dirtyTabs.has(activeTab)) {
      if (
        !window.confirm(
          "You have unsaved changes. Switch tab and discard them?"
        )
      ) {
        return;
      }
      setDirtyTabs((prev) => {
        const next = new Set(prev);
        next.delete(activeTab);
        return next;
      });
    }
    setActiveTab(newTab);
  }

  return (
    <div className="flex flex-col lg:flex-row h-full">
      {/* Main content area */}
      <div className="flex-1 overflow-auto p-4 sm:p-6 space-y-6">
        {/* Header */}
        <div className="space-y-3">
          {/* Back + Breadcrumb */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => navigate(backTo)}
            >
              <ArrowLeft className="size-4" />
            </Button>
            <Link
              to={`/projects/${project}`}
              className="hover:text-foreground transition-colors truncate max-w-[120px] sm:max-w-none"
            >
              {project}
            </Link>
            {epic && (
              <>
                <span>/</span>
                <Link
                  to={`/projects/${project}/epics/${epic}`}
                  className="hover:text-foreground transition-colors truncate max-w-[120px] sm:max-w-none"
                >
                  {epic}
                </Link>
              </>
            )}
            <span>/</span>
            <span className="text-foreground truncate">{featureName}</span>
          </div>

          {/* Title + Status */}
          <div className="flex items-center gap-3 flex-wrap">
            <CopyButton text={featureRef} />
            <h1 className="text-xl sm:text-2xl font-bold">{detail.name}</h1>
            <Badge
              variant={statusBadgeVariant[detail.status]}
              className={cn(statusBadgeClass[detail.status])}
            >
              {detail.status}
            </Badge>
            {detail.status === "in-progress" && detail.completion != null && (
              <span className="text-sm text-muted-foreground">
                {detail.completion}% complete
              </span>
            )}
          </div>

          {/* Description */}
          {detail.description && (
            <div className="text-sm text-muted-foreground">
              <MarkdownViewer content={detail.description} className="border-0 [&>div]:p-0 [&>div]:min-h-0" />
            </div>
          )}
        </div>

        {detail.phases.length > 0 && <PhaseStrip phases={detail.phases} />}

        <Separator />

        {/* Tabbed Doc View */}
        {detail.files.length > 0 ? (
          <Tabs value={activeTab} onValueChange={handleTabChange}>
            <div className="overflow-x-auto overflow-y-hidden -mx-4 px-4 sm:mx-0 sm:px-0">
              <TabsList>
                {detail.files.map((file) => (
                  <TabsTrigger key={file} value={file} className="gap-1.5">
                    {tabLabel(file)}
                    {dirtyTabs.has(file) && (
                      <span className="size-1.5 rounded-full bg-amber-500" />
                    )}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>

            {detail.files.map((file) => (
              <TabsContent key={file} value={file}>
                <FileTabContent
                  project={project}
                  feature={featureRef}
                  file={file}
                  isActive={activeTab === file}
                />
              </TabsContent>
            ))}
          </Tabs>
        ) : (
          <p className="text-sm text-muted-foreground">
            No documentation files for this feature.
          </p>
        )}
      </div>

      {/* Desktop: Right sidebar — Linked Bugs */}
      <aside className="hidden lg:flex w-72 border-l bg-muted/10 flex-col h-full">
        <div className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bug className="size-4" />
            <h2 className="text-sm font-semibold">Linked Bugs</h2>
            {!bugsLoading && (
              <Badge variant="secondary" className="text-[10px] px-1.5">
                {bugs.length}
              </Badge>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs gap-1"
            onClick={() => setNewBugOpen(true)}
          >
            <Plus className="size-3" />
            New Bug
          </Button>
        </div>

        <Separator />

        {!bugsLoading && bugs.length > 0 && bugFilterButtons}

        <ScrollArea className="flex-1">
          <LinkedBugsList
            project={project}
            bugs={filteredBugs}
            bugsLoading={bugsLoading}
            navigate={navigate}
          />
        </ScrollArea>
      </aside>

      {/* Mobile: Collapsible Linked Bugs section */}
      <div className="lg:hidden border-t">
        <button
          onClick={() => setMobileBugsExpanded((v) => !v)}
          className="w-full flex items-center justify-between p-4 hover:bg-accent/50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Bug className="size-4" />
            <h2 className="text-sm font-semibold">Linked Bugs</h2>
            {!bugsLoading && bugs.length > 0 && (
              <>
                <Badge variant="secondary" className="text-xs">
                  {openBugCount} open
                </Badge>
                {closedBugCount > 0 && (
                  <Badge variant="outline" className="text-xs opacity-60">
                    {closedBugCount} closed
                  </Badge>
                )}
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs gap-1"
              onClick={(e) => {
                e.stopPropagation();
                setNewBugOpen(true);
              }}
            >
              <Plus className="size-3" />
              New Bug
            </Button>
            {mobileBugsExpanded ? (
              <ChevronUp className="size-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="size-4 text-muted-foreground" />
            )}
          </div>
        </button>
        {mobileBugsExpanded && (
          <>
            {!bugsLoading && bugs.length > 0 && bugFilterButtons}
            <LinkedBugsList
              project={project}
              bugs={filteredBugs}
              bugsLoading={bugsLoading}
              navigate={navigate}
            />
          </>
        )}
      </div>

      <NewBugDialog
        project={project}
        features={allFeatures}
        epics={epics}
        defaultLinkedFeature={featureRef}
        open={newBugOpen}
        onOpenChange={setNewBugOpen}
        onCreated={fetchBugs}
      />
    </div>
  );
}
