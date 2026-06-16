import { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { MarkdownViewer } from "@/components/MarkdownViewer";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import { AddFeatureDialog } from "@/components/AddFeatureDialog";
import { AddEpicDialog } from "@/components/AddEpicDialog";
import { UnlinkedBugsSidebar } from "@/components/UnlinkedBugsSidebar";
import type { EpicViewModel } from "@/components/NewBugDialog";
import { GitPanel } from "@/components/GitPanel";
import { FeatureBoard } from "@/components/FeatureBoard";
import { Badge } from "@/components/ui/badge";
import { Plus, Copy, Check, FileText, Target, BookOpen, Layers } from "lucide-react";

interface ProjectDetail {
  name: string;
  path: string;
  port: number;
  host: string;
  status: "online" | "offline";
  lastSeen: string;
  hasOverview: boolean;
  hasMission: boolean;
  hasTechDesign: boolean;
  beastModeVersion: string | null;
  versionStatus: "current" | "outdated" | null;
}

interface EpicChild {
  name: string;
  status: "planning" | "planned" | "in-progress" | "complete";
  completion: number | null;
  openBugCount: number;
}

interface FeatureResponse {
  name: string;
  status: "planning" | "planned" | "in-progress" | "complete";
  completion: number | null;
  files: string[];
  openBugCount: number;
  isEpic: boolean;
  children?: EpicChild[];
}

interface FeaturesApiResponse {
  features: FeatureResponse[];
  pathAccessible: boolean;
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

export function ProjectDashboard() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();

  const [features, setFeatures] = useState<FeatureResponse[]>([]);
  const [pathAccessible, setPathAccessible] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addEpicDialogOpen, setAddEpicDialogOpen] = useState(false);

  const [projectDetail, setProjectDetail] = useState<ProjectDetail | null>(null);
  const [docDialogOpen, setDocDialogOpen] = useState(false);
  const [docTitle, setDocTitle] = useState("");
  const [docContent, setDocContent] = useState("");
  const [docLoading, setDocLoading] = useState(false);
  const [docEditing, setDocEditing] = useState(false);
  const [docEditContent, setDocEditContent] = useState("");
  const [docSaving, setDocSaving] = useState(false);
  const [docDirty, setDocDirty] = useState(false);
  const [docDocName, setDocDocName] = useState("");

  function fetchFeatures() {
    if (!name) return;
    setLoading(true);
    setError(null);
    apiFetch<FeaturesApiResponse>(`/api/features/${name}`)
      .then((data) => {
        setFeatures(data.features);
        setPathAccessible(data.pathAccessible);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    fetchFeatures();
  }, [name]);

  useEffect(() => {
    if (!name) return;
    apiFetch<ProjectDetail>(`/api/projects/${name}`)
      .then(setProjectDetail)
      .catch(() => setProjectDetail(null));
  }, [name]);

  async function openDoc(docName: string, title: string) {
    if (!name) return;
    setDocTitle(title);
    setDocDocName(docName);
    setDocContent("");
    setDocDialogOpen(true);
    setDocLoading(true);
    setDocEditing(false);
    setDocDirty(false);
    try {
      const content = await apiFetch<string>(
        `/api/projects/${name}/doc/${docName}`
      );
      setDocContent(content);
    } catch {
      // Doc doesn't exist — start in edit mode for writable docs
      setDocContent("");
      const writable = docName === "mission-statement.md" || docName === "technical-design.md";
      if (writable) {
        setDocEditContent("");
        setDocEditing(true);
      }
    } finally {
      setDocLoading(false);
    }
  }

  const isDocWritable = docDocName === "mission-statement.md" || docDocName === "technical-design.md";

  function handleDocEdit() {
    setDocEditContent(docContent);
    setDocEditing(true);
    setDocDirty(false);
  }

  function handleDocCancel() {
    if (docDirty && !window.confirm("Discard unsaved changes?")) return;
    setDocEditing(false);
    setDocDirty(false);
  }

  async function handleDocSave() {
    if (!name) return;
    setDocSaving(true);
    try {
      await apiFetch(`/api/projects/${name}/doc/${docDocName}`, {
        method: "PUT",
        headers: { "Content-Type": "text/plain" },
        body: docEditContent,
      });
      setDocContent(docEditContent);
      setDocEditing(false);
      setDocDirty(false);
      // Update project detail to reflect that the doc now exists
      apiFetch<any>(`/api/projects/${name}`).then(setProjectDetail).catch(() => {});
    } catch (err) {
      alert("Failed to save document");
    } finally {
      setDocSaving(false);
    }
  }

  function handleDocEditorChange(md: string) {
    setDocEditContent(md);
    setDocDirty(md !== docContent);
  }

  // Derive the epics view-model from the features list: epic entries (isEpic)
  // with their children mapped to name strings. Used by bug dialogs + sidebar.
  const epicsViewModel = useMemo<EpicViewModel[]>(
    () =>
      features
        .filter((f) => f.isEpic)
        .map((f) => ({
          name: f.name,
          children: (f.children ?? []).map((c) => c.name),
        })),
    [features]
  );

  if (!name) return null;

  const hasFeatures = features.length > 0;

  return (
    <div className="flex flex-col lg:flex-row h-full">
      <div className="flex-1 overflow-auto p-4 sm:p-6">
        <div className="group flex items-center gap-2 mb-4">
          <CopyButton text={name!} />
          <h2 className="text-2xl font-bold">{name}</h2>
          {projectDetail?.versionStatus !== null && projectDetail?.beastModeVersion !== null && projectDetail?.beastModeVersion !== undefined && (
            <Badge
              className={`text-[10px] px-1.5 py-0 shrink-0 border-0 ${
                projectDetail.versionStatus === "outdated"
                  ? "bg-bm-red/60 text-white"
                  : "bg-blue-600/60 text-white"
              }`}
            >
              v{projectDetail.beastModeVersion}
            </Badge>
          )}
        </div>

        {projectDetail && (
            <div className="flex items-center gap-2 mb-6 overflow-x-auto">
              {projectDetail.hasOverview && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 shrink-0"
                  onClick={() => openDoc("overview.md", "Overview")}
                >
                  <FileText className="size-3.5" />
                  Overview
                </Button>
              )}
              <Button
                variant={projectDetail.hasMission ? "outline" : "ghost"}
                size="sm"
                className="gap-1.5 shrink-0"
                onClick={() => openDoc("mission-statement.md", "Mission Statement")}
              >
                <Target className="size-3.5" />
                {projectDetail.hasMission ? "Mission" : "+ Mission"}
              </Button>
              <Button
                variant={projectDetail.hasTechDesign ? "outline" : "ghost"}
                size="sm"
                className="gap-1.5 shrink-0"
                onClick={() => openDoc("technical-design.md", "Technical Design")}
              >
                <BookOpen className="size-3.5" />
                {projectDetail.hasTechDesign ? "Tech Design" : "+ Tech Design"}
              </Button>
            </div>
          )}

        <GitPanel project={name} />

        {error && (
          <div className="mb-4 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
            {error}
          </div>
        )}

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

        {!loading && !error && !pathAccessible && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <p className="text-muted-foreground mb-2">Project path not accessible</p>
            <p className="text-xs text-muted-foreground">
              The project directory may be on an unmounted drive or the path no longer exists.
            </p>
          </div>
        )}

        {!loading && !error && pathAccessible && !hasFeatures && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <p className="text-muted-foreground mb-4">No features yet</p>
            <div className="flex items-center gap-2">
              <Button onClick={() => setAddDialogOpen(true)}>
                <Plus className="size-4" />
                Add Feature
              </Button>
              <Button variant="outline" onClick={() => setAddEpicDialogOpen(true)}>
                <Layers className="size-4" />
                Add Epic
              </Button>
            </div>
          </div>
        )}

        {!loading && !error && pathAccessible && hasFeatures && (
          <FeatureBoard
            entries={features}
            onOpenFeature={(feature) =>
              navigate(`/projects/${name}/features/${feature}`)
            }
            onOpenEpic={(epic) => navigate(`/projects/${name}/epics/${epic}`)}
            onAddFeature={() => setAddDialogOpen(true)}
            onAddEpic={() => setAddEpicDialogOpen(true)}
          />
        )}

        <AddFeatureDialog
          project={name}
          open={addDialogOpen}
          onOpenChange={setAddDialogOpen}
          onCreated={fetchFeatures}
        />

        <AddEpicDialog
          project={name}
          open={addEpicDialogOpen}
          onOpenChange={setAddEpicDialogOpen}
          onCreated={fetchFeatures}
        />

        <Dialog open={docDialogOpen} onOpenChange={(open) => {
          if (!open && docDirty) {
            if (!window.confirm("Discard unsaved changes?")) return;
          }
          setDocDialogOpen(open);
          if (!open) {
            setDocEditing(false);
            setDocDirty(false);
          }
        }}>
          <DialogContent className="!w-[95vw] sm:!w-[60vw] !max-w-[95vw] sm:!max-w-[60vw] max-h-[80vh] overflow-auto">
            <DialogHeader>
              <DialogTitle>{docTitle}</DialogTitle>
              <DialogDescription>
                <div className="flex items-center justify-between">
                  <span>{name} - {docTitle}</span>
                  {!docLoading && isDocWritable && !docEditing && (
                    <Button size="sm" variant="outline" onClick={handleDocEdit}>
                      Edit
                    </Button>
                  )}
                  {docEditing && (
                    <div className="flex items-center gap-2">
                      {docDirty && (
                        <span className="text-xs text-amber-500">Unsaved changes</span>
                      )}
                      <Button size="sm" variant="ghost" onClick={handleDocCancel}>
                        Cancel
                      </Button>
                      <Button size="sm" onClick={handleDocSave} disabled={docSaving || !docDirty}>
                        {docSaving ? "Saving..." : "Save"}
                      </Button>
                    </div>
                  )}
                </div>
              </DialogDescription>
            </DialogHeader>
            {docLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            ) : docEditing ? (
              <MarkdownEditor content={docEditContent} onChange={handleDocEditorChange} />
            ) : (
              <MarkdownViewer content={docContent} />
            )}
          </DialogContent>
        </Dialog>
      </div>

      <UnlinkedBugsSidebar project={name} epics={epicsViewModel} />
    </div>
  );
}
