import { useState, useMemo } from "react";
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

export interface EpicViewModel {
  name: string;
  children: string[];
}

interface NewBugDialogProps {
  project: string;
  features: string[];
  epics?: EpicViewModel[];
  defaultLinkedFeature?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

// Parse a defaultLinkedFeature string into an initial (epicName, featureName) pair.
// "<epic>/<feature>" → { epic, feature }
// "<bare-epic>" (matches an epic by name) → { epic, feature: "__epic_only__" }
// "<plain-feature>" → { epic: "", feature }
// "" → { epic: "", feature: "" }
function parseDefaultLinkedFeature(
  value: string | undefined,
  epics: EpicViewModel[]
): { epic: string; feature: string } {
  if (!value) return { epic: "", feature: "" };
  const slashIdx = value.indexOf("/");
  if (slashIdx !== -1) {
    // Two-part: epic/feature
    return { epic: value.slice(0, slashIdx), feature: value.slice(slashIdx + 1) };
  }
  // Single-part: check if it matches an epic name
  if (epics.some((e) => e.name === value)) {
    return { epic: value, feature: "__epic_only__" };
  }
  // Plain feature
  return { epic: "", feature: value };
}

// Compute the linkedFeature string for the POST body from the current epic+feature selection.
// epic="" feature="" → ""
// epic="" feature="user-auth" → "user-auth"
// epic="editor" feature="__epic_only__" → "editor"
// epic="editor" feature="base" → "editor/base"
function computeLinkedFeature(epic: string, feature: string): string {
  if (!epic) return feature === "__epic_only__" ? "" : feature;
  if (feature === "__epic_only__" || !feature) return epic;
  return `${epic}/${feature}`;
}

export function NewBugDialog({
  project,
  features,
  epics = [],
  defaultLinkedFeature,
  open,
  onOpenChange,
  onCreated,
}: NewBugDialogProps) {
  const hasEpics = epics.length > 0;

  const initialParsed = useMemo(
    () => parseDefaultLinkedFeature(defaultLinkedFeature, epics),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [defaultLinkedFeature]
  );

  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<string>("medium");
  const [selectedEpic, setSelectedEpic] = useState<string>(initialParsed.epic);
  const [selectedFeature, setSelectedFeature] = useState<string>(initialParsed.feature);
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The Feature Select options depend on whether an epic is chosen.
  const featureOptions = useMemo(() => {
    if (selectedEpic) {
      const epic = epics.find((e) => e.name === selectedEpic);
      return epic?.children ?? [];
    }
    return features;
  }, [selectedEpic, epics, features]);

  function resetForm() {
    setTitle("");
    setPriority("medium");
    setSelectedEpic(initialParsed.epic);
    setSelectedFeature(initialParsed.feature);
    setDescription("");
    setError(null);
  }

  function handleOpenChange(next: boolean) {
    if (!next) resetForm();
    onOpenChange(next);
  }

  function handleEpicChange(value: string) {
    const newEpic = value === "__none__" ? "" : value;
    setSelectedEpic(newEpic);
    // Reset feature selection when epic changes — the options list changes entirely
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
        description,
        priority,
      };
      if (linkedFeature) {
        body.linkedFeature = linkedFeature;
      }

      await apiFetch(`/api/bugs/${project}`, {
        method: "POST",
        body: JSON.stringify(body),
      });

      window.dispatchEvent(
        new CustomEvent("bug-created", { detail: { project } })
      );

      resetForm();
      onOpenChange(false);
      onCreated();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create bug");
    } finally {
      setSubmitting(false);
    }
  }

  // The computed linkedFeature string shown in the feature select value.
  // When no epic is selected, selectedFeature IS the linkedFeature.
  // When an epic is selected, we display the feature portion only.
  const featureSelectValue = selectedFeature || "__none__";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New Bug</DialogTitle>
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
          </div>

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
              onClick={() => handleOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !title.trim()}>
              {submitting ? "Creating..." : "Create Bug"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
