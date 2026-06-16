import { useState, useEffect, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { NewBugDialog } from "@/components/NewBugDialog";
import type { EpicViewModel } from "@/components/NewBugDialog";
import { Bug, Plus, ChevronDown, ChevronUp } from "lucide-react";

interface BugResponse {
  id: string;
  title: string;
  status: "open" | "in-progress" | "closed";
  priority: "low" | "medium" | "high" | "critical";
  linkedFeature?: string;
  createdAt: string;
  updatedAt: string;
  body: string;
}

const priorityVariant: Record<BugResponse["priority"], "destructive" | "default" | "secondary" | "outline"> = {
  critical: "destructive",
  high: "destructive",
  medium: "outline",
  low: "outline",
};

const priorityClass: Record<BugResponse["priority"], string> = {
  critical: "",
  high: "",
  medium: "border-yellow-600 bg-yellow-600/20 text-yellow-400 hover:bg-yellow-600/20",
  low: "",
};

const bugStatusVariant: Record<BugResponse["status"], "outline" | "secondary" | "default"> = {
  open: "outline",
  "in-progress": "outline",
  closed: "secondary",
};

const bugStatusClass: Record<BugResponse["status"], string> = {
  open: "",
  "in-progress": "border-blue-600 bg-blue-600/20 text-blue-400",
  closed: "opacity-50",
};

interface BugsSidebarProps {
  project: string;
  // epics view-model: used to populate the Epic filter dropdown. When provided,
  // the sidebar shows an Epic select that filters by epic membership (Model A).
  epics?: EpicViewModel[];
  // When set, the sidebar is scoped to a single epic (the epic detail page):
  // it shows only bugs linked to the epic or one of its child features
  // (Model A: linkedFeature === epicScope || startsWith(epicScope + "/")),
  // its New-Bug dialog pre-selects the epic as the linked target, and the
  // epic selector is hidden (the scope is already locked).
  // When unset, the sidebar behaves exactly as on the project dashboard.
  epicScope?: string;
}

// Model A epic-membership test: a bug belongs to an epic if its linkedFeature
// is the epic itself or one of its nested features. The "/" boundary prevents
// epic "web" from matching feature "web-app".
function isInEpic(linkedFeature: string | undefined, epic: string): boolean {
  if (!linkedFeature) return false;
  return linkedFeature === epic || linkedFeature.startsWith(epic + "/");
}

interface FeaturesApiResponse {
  features: { name: string }[];
  pathAccessible: boolean;
}

export function BugsSidebar({ project, epics = [], epicScope }: BugsSidebarProps) {
  const navigate = useNavigate();
  const { name } = useParams<{ name: string }>();

  const [allBugs, setAllBugs] = useState<BugResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newBugOpen, setNewBugOpen] = useState(false);
  const [features, setFeatures] = useState<string[]>([]);
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "closed">("all");
  const [featureFilter, setFeatureFilter] = useState<string>("all");
  // Epic filter: when epicScope is set it is locked to that value and the selector
  // is hidden. When unset, the user can choose from the epics view-model.
  const [epicFilter, setEpicFilter] = useState<string>(epicScope ?? "all");

  function fetchBugs() {
    setLoading(true);
    setError(null);
    apiFetch<BugResponse[]>(`/api/bugs/${project}`)
      .then((data) => {
        const sorted = [...data].sort((a, b) => {
          const aOpen = a.status !== "closed" ? 0 : 1;
          const bOpen = b.status !== "closed" ? 0 : 1;
          return aOpen - bOpen;
        });
        setAllBugs(sorted);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    fetchBugs();
  }, [project]);

  useEffect(() => {
    apiFetch<FeaturesApiResponse>(`/api/features/${project}`)
      .then((data) => setFeatures(data.features.map((f) => f.name)))
      .catch(() => setFeatures([]));
  }, [project]);

  // When scoped to an epic, restrict the working set to the epic + its children
  // (Model A). Without epicScope this is the full bug list — identical to before.
  const bugs = useMemo(
    () =>
      epicScope
        ? allBugs.filter((b) => isInEpic(b.linkedFeature, epicScope))
        : allBugs,
    [allBugs, epicScope]
  );

  const openCount = bugs.filter((b) => b.status !== "closed").length;
  const closedCount = bugs.filter((b) => b.status === "closed").length;

  // Collect unique linked features from bugs for the feature filter
  const bugFeatures = useMemo(() => {
    const set = new Set<string>();
    for (const b of bugs) {
      if (b.linkedFeature) set.add(b.linkedFeature);
    }
    return Array.from(set).sort();
  }, [bugs]);

  // Compose all three filters: status + epic + feature.
  // Filter order: epic first (scopes the set), then status, then feature.
  // When epicScope is set, the epic filter is already applied via the `bugs` memo above.
  const filteredBugs = useMemo(() => {
    return bugs.filter((bug) => {
      // Epic filter (project view only — when epicScope is set, bugs is already scoped)
      if (!epicScope && epicFilter !== "all") {
        if (!isInEpic(bug.linkedFeature, epicFilter)) return false;
      }
      // Status filter
      if (statusFilter === "open" && bug.status === "closed") return false;
      if (statusFilter === "closed" && bug.status !== "closed") return false;
      // Feature filter
      if (featureFilter === "unlinked" && bug.linkedFeature) return false;
      if (featureFilter !== "all" && featureFilter !== "unlinked" && bug.linkedFeature !== featureFilter) return false;
      return true;
    });
  }, [bugs, epicScope, epicFilter, statusFilter, featureFilter]);

  const statusButtons = (
    <div className="flex gap-1">
      {(["all", "open", "closed"] as const).map((f) => (
        <Button
          key={f}
          variant={statusFilter === f ? "secondary" : "ghost"}
          size="xs"
          className="text-[11px] px-2 h-6 rounded-full"
          onClick={() => setStatusFilter(f)}
        >
          {f === "all" ? "All" : f === "open" ? "Open" : "Closed"}
        </Button>
      ))}
    </div>
  );

  // Epic filter dropdown — only shown on the project view when epics exist
  // (i.e. when epicScope is NOT set and there are epics in the view-model).
  const epicSelect = !epicScope && epics.length > 0 ? (
    <select
      value={epicFilter}
      onChange={(e) => {
        setEpicFilter(e.target.value);
        // Reset feature filter when epic changes — the feature set changes
        setFeatureFilter("all");
      }}
      className="h-6 text-[11px] rounded-full bg-muted border border-border px-2 text-foreground outline-none cursor-pointer"
    >
      <option value="all">All epics</option>
      {epics.map((e) => (
        <option key={e.name} value={e.name}>{e.name}</option>
      ))}
    </select>
  ) : null;

  const featureSelect = (
    <select
      value={featureFilter}
      onChange={(e) => setFeatureFilter(e.target.value)}
      className="h-6 text-[11px] rounded-full bg-muted border border-border px-2 text-foreground outline-none cursor-pointer"
    >
      <option value="all">All features</option>
      <option value="unlinked">Unlinked</option>
      {bugFeatures.map((f) => (
        <option key={f} value={f}>{f}</option>
      ))}
    </select>
  );

  const filterRow = (
    <div className="px-3 pt-2 pb-1 flex flex-col gap-1.5">
      {statusButtons}
      {epicSelect}
      {featureSelect}
    </div>
  );

  const bugsList = (
    <div className="p-2 space-y-2">
      {loading && (
        <>
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </>
      )}

      {error && (
        <div className="p-2 text-sm text-destructive">{error}</div>
      )}

      {!loading && !error && filteredBugs.length === 0 && (
        <div className="p-4 text-center text-sm text-muted-foreground">
          No bugs found
        </div>
      )}

      {!loading &&
        !error &&
        filteredBugs.map((bug) => (
          <button
            key={bug.id}
            onClick={() => navigate(`/projects/${name}/bugs/${bug.id}`)}
            className={cn(
              "w-full text-left rounded-md border bg-card p-3 space-y-1.5 hover:bg-accent/50 transition-colors overflow-hidden",
              bug.status === "closed" && "opacity-50",
              bug.status === "in-progress" && "border-l-2 border-l-blue-500"
            )}
          >
            <div className="flex items-center justify-between gap-2 min-w-0">
              <span className="text-xs font-mono text-muted-foreground shrink-0">
                {bug.id}
              </span>
              <div className="flex items-center gap-1 shrink-0">
                <Badge
                  variant={bugStatusVariant[bug.status]}
                  className={cn("text-[10px] px-1.5", bugStatusClass[bug.status])}
                >
                  {bug.status}
                </Badge>
                <Badge variant={priorityVariant[bug.priority]} className={cn("text-[10px] px-1.5", priorityClass[bug.priority])}>
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
            {bug.linkedFeature && (
              <p className="text-[11px] text-muted-foreground truncate">
                {bug.linkedFeature}
              </p>
            )}
          </button>
        ))}
    </div>
  );

  // Determine what to pass to NewBugDialog:
  // - When epicScope is set (epic page): pre-select the epic as the linked target.
  //   Pass the epics view-model so the dialog can populate the Feature select
  //   with the epic's children (the Epic select itself is visible but pre-selected
  //   to the epic via defaultLinkedFeature → parseDefaultLinkedFeature).
  //   Pass an empty plain-features list since we don't want plain features showing
  //   when the dialog is opened from the epic page.
  // - When no epicScope: pass plain features + the full epics view-model.
  const newBugFeatures = epicScope ? [] : features;
  const newBugEpics = epics.length > 0 ? epics : undefined;

  return (
    <>
      {/* Desktop: fixed sidebar */}
      <aside className="hidden lg:flex w-72 shrink-0 border-l bg-muted/10 flex-col h-full overflow-hidden">
        <div className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bug className="size-4" />
            <h2 className="text-sm font-semibold">Bugs</h2>
          </div>
          <Button variant="outline" size="xs" onClick={() => setNewBugOpen(true)}>
            <Plus className="size-3" />
            New Bug
          </Button>
        </div>

        <Separator />

        {!loading && bugs.length > 0 && filterRow}

        <ScrollArea className="flex-1 min-h-0">
          {bugsList}
        </ScrollArea>
      </aside>

      {/* Mobile: collapsible section */}
      <div className="lg:hidden border-t">
        <button
          onClick={() => setMobileExpanded((v) => !v)}
          className="w-full flex items-center justify-between p-4 hover:bg-accent/50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Bug className="size-4" />
            <h2 className="text-sm font-semibold">Bugs</h2>
            {!loading && bugs.length > 0 && (
              <>
                <Badge variant="secondary" className="text-xs">
                  {openCount} open
                </Badge>
                {closedCount > 0 && (
                  <Badge variant="outline" className="text-xs opacity-60">
                    {closedCount} closed
                  </Badge>
                )}
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="xs"
              onClick={(e) => {
                e.stopPropagation();
                setNewBugOpen(true);
              }}
            >
              <Plus className="size-3" />
              New Bug
            </Button>
            {mobileExpanded ? (
              <ChevronUp className="size-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="size-4 text-muted-foreground" />
            )}
          </div>
        </button>
        {mobileExpanded && (
          <>
            {!loading && bugs.length > 0 && filterRow}
            {bugsList}
          </>
        )}
      </div>

      <NewBugDialog
        project={project}
        features={newBugFeatures}
        epics={newBugEpics}
        defaultLinkedFeature={epicScope}
        open={newBugOpen}
        onOpenChange={setNewBugOpen}
        onCreated={fetchBugs}
      />
    </>
  );
}

// Keep backward-compatible export name
export { BugsSidebar as UnlinkedBugsSidebar };
