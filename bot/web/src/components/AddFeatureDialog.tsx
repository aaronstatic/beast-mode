import { useState } from "react";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";

interface AddFeatureDialogProps {
  project: string;
  // When set, the feature is created inside this epic (docs/features/<epic>/<feature>).
  epic?: string;
  onCreated: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function toKebabCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function AddFeatureDialog({
  project,
  epic,
  onCreated,
  open,
  onOpenChange,
}: AddFeatureDialogProps) {
  const [name, setName] = useState("");
  const [requirements, setRequirements] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const kebabName = toKebabCase(name);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!kebabName || !requirements.trim()) return;

    setSubmitting(true);
    setError(null);
    try {
      await apiFetch(`/api/features/${project}`, {
        method: "POST",
        body: JSON.stringify({ name: kebabName, requirements, ...(epic ? { epic } : {}) }),
      });
      setName("");
      setRequirements("");
      onOpenChange(false);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create feature");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add Feature</DialogTitle>
          <DialogDescription>
            {epic
              ? `Create a new feature in the ${epic} epic`
              : `Create a new feature for ${project}`}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="feature-name">
              Feature Name
            </label>
            <Input
              id="feature-name"
              placeholder="My New Feature"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            {kebabName && (
              <p className="text-xs text-muted-foreground">
                Slug:{" "}
                <code className="bg-muted px-1 rounded">
                  {epic ? `${epic}/${kebabName}` : kebabName}
                </code>
              </p>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="feature-requirements">
              Requirements
            </label>
            <textarea
              id="feature-requirements"
              placeholder="Describe the feature requirements..."
              value={requirements}
              onChange={(e) => setRequirements(e.target.value)}
              rows={12}
              className="flex min-h-[240px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-y"
            />
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!kebabName || !requirements.trim() || submitting}
            >
              {submitting && <Loader2 className="size-4 animate-spin" />}
              {submitting ? "Creating..." : "Create Feature"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
