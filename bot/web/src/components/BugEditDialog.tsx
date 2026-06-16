import { useState, useEffect, useMemo } from "react";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import type { EpicViewModel } from "@/components/NewBugDialog";

interface BugData {
  title: string;
  status: string;
  priority: string;
  linkedFeature?: string;
  body: string;
}

interface BugEditDialogProps {
  project: string;
  bugId: string;
  bug: BugData;
  features: string[];
  epics?: EpicViewModel[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

// Parse a linkedFeature string into (epic, feature) parts for the Edit UI.
// "<epic>/<feature>" → { epic, feature }
// "<bare-epic>" (matches an epic by name) → { epic, feature: "__epic_only__" }
// "<plain-feature>" or "" → { epic: "", feature: linkedFeature }
function parseLinkedFeature(
  value: string | undefined,
  epics: EpicViewModel[]
): { epic: string; feature: string } {
  if (!value) return { epic: "", feature: "" };
  const slashIdx = value.indexOf("/");
  if (slashIdx !== -1) {
    return { epic: value.slice(0, slashIdx), feature: value.slice(slashIdx + 1) };
  }
  if (epics.some((e) => e.name === value)) {
    return { epic: value, feature: "__epic_only__" };
  }
  return { epic: "", feature: value };
}

// Compute the linkedFeature string to PATCH from the current epic+feature selection.
function computeLinkedFeature(epic: string, feature: string): string {
  if (!epic) return feature === "__epic_only__" ? "" : feature;
  if (feature === "__epic_only__" || !feature) return epic;
  return `${epic}/${feature}`;
}

export function BugEditDialog({
  project,
  bugId,
  bug,
  features,
  epics = [],
  open,
  onOpenChange,
  onSaved,
}: BugEditDialogProps) {
  const hasEpics = epics.length > 0;

  // Derive initial epic+feature from the bug's current linkedFeature
  const initialParsed = useMemo(
    () => parseLinkedFeature(bug.linkedFeature, epics),
    // Re-parse only when the bug data changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bug.linkedFeature]
  );

  const [title, setTitle] = useState(bug.title);
  const [status, setStatus] = useState(bug.status);
  const [priority, setPriority] = useState(bug.priority);
  const [selectedEpic, setSelectedEpic] = useState<string>(initialParsed.epic);
  const [selectedFeature, setSelectedFeature] = useState<string>(initialParsed.feature);
  const [description, setDescription] = useState(bug.body);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when bug data changes (e.g., dialog re-opens with fresh data)
  useEffect(() => {
    const parsed = parseLinkedFeature(bug.linkedFeature, epics);
    setTitle(bug.title);
    setStatus(bug.status);
    setPriority(bug.priority);
    setSelectedEpic(parsed.epic);
    setSelectedFeature(parsed.feature);
    setDescription(bug.body);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bug]);

  // Feature options depend on the currently selected epic
  const featureOptions = useMemo(() => {
    if (selectedEpic) {
      const epic = epics.find((e) => e.name === selectedEpic);
      return epic?.children ?? [];
    }
    return features;
  }, [selectedEpic, epics, features]);

  function handleEpicChange(value: string) {
    const newEpic = value === "__none__" ? "" : value;
    setSelectedEpic(newEpic);
    // Reset feature when epic changes
    setSelectedFeature("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;

    const linkedFeature = computeLinkedFeature(selectedEpic, selectedFeature);

    setSubmitting(true);
    setError(null);

    try {
      const body: Record<string, string> = {
        title: title.trim(),
        status,
        priority,
        description,
      };
      if (linkedFeature) {
        body.linkedFeature = linkedFeature;
      }

      await apiFetch(`/api/bugs/${project}/${bugId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });

      onOpenChange(false);
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update bug");
    } finally {
      setSubmitting(false);
    }
  }

  const featureSelectValue = selectedFeature || "__none__";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Bug</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-2 rounded-md bg-destructive/10 text-destructive text-sm">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium">Title</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Bug title"
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Status</label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="in-progress">In Progress</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Priority</label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Epic Select — only shown when epics exist in this project */}
          {hasEpics && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Epic</label>
              <Select
                value={selectedEpic || "__none__"}
                onValueChange={handleEpicChange}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {epics.map((e) => (
                    <SelectItem key={e.name} value={e.name}>
                      {e.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium">
              {selectedEpic ? "Feature (within epic)" : "Linked Feature"}
            </label>
            <Select
              value={featureSelectValue}
              onValueChange={(v) =>
                setSelectedFeature(v === "__none__" ? "" : v)
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">
                  {selectedEpic ? "Epic only (no specific feature)" : "None"}
                </SelectItem>
                {featureOptions.map((f) => (
                  <SelectItem key={f} value={f}>
                    {f}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the bug..."
              rows={6}
              className="w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 resize-y"
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !title.trim()}>
              {submitting ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
