import { useState } from "react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Copy, Check, Search, X, Layers } from "lucide-react";

// --- Types ---

// A single card on the board. Plain features and epic children both fit this
// shape; epics additionally carry `isEpic` + `children`. `openBugCount` is
// optional because the epic-children endpoint (GET /api/epics/:project/:epic)
// does not currently roll per-child bug counts — a missing count renders
// identically to a zero count (no badge), matching the project view exactly.
export interface BoardEntry {
  name: string;
  status: "planning" | "planned" | "in-progress" | "complete";
  completion: number | null;
  files: string[];
  openBugCount?: number;
  isEpic?: boolean;
  children?: { name: string }[];
}

interface FeatureBoardProps {
  entries: BoardEntry[];
  // Navigation: opening a plain feature / epic child.
  onOpenFeature: (name: string) => void;
  // Opening an epic. Optional because a board scoped to a single epic's
  // children never renders epic cards (children are plain features).
  onOpenEpic?: (name: string) => void;
  // Per-column add affordances. When undefined the corresponding button is NOT
  // rendered — the epic view passes neither, hiding both buttons.
  onAddFeature?: () => void;
  onAddEpic?: () => void;
  // When set, the plain-feature card's CopyButton copies `<copyPrefix>/<feature.name>`
  // instead of the bare feature name — used by EpicDashboard so child features
  // copy the full `<epic>/<feature>` reference. Epic cards always copy the bare name.
  copyPrefix?: string;
}

// --- Status maps (moved verbatim from ProjectDashboard) ---

const statusColumns: {
  key: BoardEntry["status"];
  label: string;
}[] = [
  { key: "planning", label: "Planning" },
  { key: "planned", label: "Planned" },
  { key: "in-progress", label: "In Progress" },
  { key: "complete", label: "Complete" },
];

const statusBadgeVariant: Record<
  BoardEntry["status"],
  "outline" | "secondary" | "default" | "destructive"
> = {
  planning: "outline",
  planned: "secondary",
  "in-progress": "default",
  complete: "default",
};

const statusBadgeClass: Record<BoardEntry["status"], string> = {
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
      title="Copy feature name"
    >
      {copied ? (
        <Check className="size-3 text-bm-green" />
      ) : (
        <Copy className="size-3 text-muted-foreground" />
      )}
    </button>
  );
}

export function FeatureBoard({
  entries,
  onOpenFeature,
  onOpenEpic,
  onAddFeature,
  onAddEpic,
  copyPrefix,
}: FeatureBoardProps) {
  const [search, setSearch] = useState("");

  const searchLower = search.toLowerCase();
  const filteredFeatures = search
    ? entries.filter((f) => f.name.toLowerCase().includes(searchLower))
    : entries;

  const grouped = statusColumns.map((col) => {
    const filtered = filteredFeatures.filter((f) => f.status === col.key);
    filtered.sort((a, b) => {
      // 1. Epics always shown first within a column
      if (!!a.isEpic !== !!b.isEpic) return a.isEpic ? -1 : 1;
      // 2. In the Complete column, most bugs first
      if (col.key === "complete") {
        const byBugs = (b.openBugCount ?? 0) - (a.openBugCount ?? 0);
        if (byBugs !== 0) return byBugs;
      }
      // 3. Alphabetical by name
      return a.name.localeCompare(b.name);
    });
    return { ...col, features: filtered };
  });

  return (
    <div className="space-y-4">
      <div className="relative w-full sm:max-w-xs">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          placeholder="Filter features..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8 pr-8 h-8 text-sm"
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-accent"
          >
            <X className="size-3.5 text-muted-foreground" />
          </button>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {grouped.map((col) => (
          <div key={col.key} className="space-y-1.5">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">{col.label}</h3>
              <Badge variant="secondary" className="text-xs">
                {col.features.length}
              </Badge>
            </div>

            {col.features.map((feature) =>
              feature.isEpic ? (
                <Card
                  key={feature.name}
                  className="group cursor-pointer hover:shadow-md transition-shadow bg-violet-50 dark:bg-violet-950/30 border-violet-300 dark:border-violet-700 overflow-hidden !py-0 !gap-0"
                  onClick={() => onOpenEpic?.(feature.name)}
                >
                  <div className="px-3 py-4 flex flex-col gap-0.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Layers className="size-3.5 shrink-0 text-violet-600 dark:text-violet-400" />
                        <span className="text-sm font-medium truncate">
                          {feature.name}
                        </span>
                        <CopyButton text={feature.name} />
                      </div>
                      {(feature.openBugCount ?? 0) > 0 && (
                        <Badge variant="destructive" className="text-[10px] px-1.5 py-0 shrink-0">
                          {feature.openBugCount}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge
                        className="text-[10px] py-0 bg-violet-600/60 text-white hover:bg-violet-600/60"
                      >
                        Epic
                      </Badge>
                      <Badge
                        variant={statusBadgeVariant[feature.status]}
                        className={cn("text-[10px] py-0", statusBadgeClass[feature.status])}
                      >
                        {feature.status}
                      </Badge>
                      {feature.children != null && (
                        <span className="text-xs text-muted-foreground">
                          {feature.children.length} {feature.children.length === 1 ? "feature" : "features"}
                        </span>
                      )}
                    </div>
                  </div>
                </Card>
              ) : (
                <Card
                  key={feature.name}
                  className="group cursor-pointer hover:shadow-md transition-shadow bg-muted/40 overflow-hidden !py-0 !gap-0"
                  onClick={() => onOpenFeature(feature.name)}
                >
                  <div className="px-3 py-4 flex flex-col gap-0.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-sm font-medium truncate">
                          {feature.name}
                        </span>
                        <CopyButton text={copyPrefix ? `${copyPrefix}/${feature.name}` : feature.name} />
                      </div>
                      {(feature.openBugCount ?? 0) > 0 && (
                        <Badge variant="destructive" className="text-[10px] px-1.5 py-0 shrink-0">
                          {feature.openBugCount}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={statusBadgeVariant[feature.status]}
                        className={cn("text-[10px] py-0", statusBadgeClass[feature.status])}
                      >
                        {feature.status}
                      </Badge>
                      {feature.status === "in-progress" &&
                        feature.completion != null && (
                          <span className="text-xs text-muted-foreground">
                            {feature.completion}%
                          </span>
                        )}
                    </div>
                  </div>
                  {feature.status === "in-progress" && feature.completion != null && (
                    <div className="h-1 bg-muted">
                      <div
                        className="h-full bg-primary transition-all"
                        style={{ width: `${feature.completion}%` }}
                      />
                    </div>
                  )}
                </Card>
              )
            )}

            {col.key === "planning" && (onAddFeature || onAddEpic) && (
              <div className="flex flex-col gap-1">
                {onAddFeature && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full gap-1"
                    onClick={onAddFeature}
                  >
                    <Plus className="size-3.5" />
                    Add Feature
                  </Button>
                )}
                {onAddEpic && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full gap-1 border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-950/40"
                    onClick={onAddEpic}
                  >
                    <Layers className="size-3.5" />
                    Add Epic
                  </Button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
