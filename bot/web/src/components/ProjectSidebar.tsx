import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiFetch } from "@/lib/api";
import { useMobileSidebar } from "@/lib/mobile-sidebar";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { MarkdownViewer } from "@/components/MarkdownViewer";
import { FileText, BookOpen, Target, LogOut } from "lucide-react";

interface ProjectResponse {
  name: string;
  path: string;
  port: number;
  host: string;
  status: "online" | "offline";
  lastSeen: string;
  hasOverview: boolean;
  hasMission: boolean;
  hasTechDesign: boolean;
  openBugCount: number;
  beastModeVersion: string | null;
  versionStatus: "current" | "outdated" | null;
}

function sortProjects(list: ProjectResponse[]): ProjectResponse[] {
  return [...list].sort((a, b) => {
    if (a.status !== b.status) return a.status === "online" ? -1 : 1;
    if (a.status === "online") return a.name.localeCompare(b.name);
    return (
      new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime()
    );
  });
}

export function ProjectSidebar() {
  const navigate = useNavigate();
  const { name: activeProject } = useParams<{ name: string }>();
  const { user, logout } = useAuth();
  const { close: closeMobileSidebar } = useMobileSidebar();

  const [projects, setProjects] = useState<ProjectResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [docDialogOpen, setDocDialogOpen] = useState(false);
  const [docTitle, setDocTitle] = useState("");
  const [docContent, setDocContent] = useState("");
  const [docLoading, setDocLoading] = useState(false);

  useEffect(() => {
    apiFetch<ProjectResponse[]>("/api/projects")
      .then((list) => setProjects(sortProjects(list)))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    function handleBugCreated(e: Event) {
      const { project } = (e as CustomEvent<{ project: string }>).detail;
      setProjects((prev) =>
        prev.map((p) =>
          p.name === project
            ? { ...p, openBugCount: p.openBugCount + 1 }
            : p
        )
      );
    }
    window.addEventListener("bug-created", handleBugCreated);
    return () => window.removeEventListener("bug-created", handleBugCreated);
  }, []);

  const activeProjectData = projects.find((p) => p.name === activeProject);

  function handleNavigate(path: string) {
    navigate(path);
    closeMobileSidebar();
  }

  async function openDoc(docName: string, title: string) {
    if (!activeProject) return;
    setDocTitle(title);
    setDocContent("");
    setDocDialogOpen(true);
    setDocLoading(true);
    try {
      const content = await apiFetch<string>(
        `/api/projects/${activeProject}/doc/${docName}`
      );
      setDocContent(content);
    } catch (err) {
      setDocContent(`Failed to load document: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setDocLoading(false);
    }
  }

  return (
    <>
      <aside className="w-64 border-r bg-muted/30 flex flex-col h-full">
        <div className="p-4 pb-2">
          <h1 className="text-lg font-semibold">Beast Mode</h1>
        </div>

        <Separator />

        <ScrollArea className="flex-1 p-2">
          {loading && (
            <div className="space-y-2 p-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          )}

          {error && (
            <div className="p-2 text-sm text-destructive">{error}</div>
          )}

          {!loading && !error && projects.length === 0 && (
            <div className="p-2 text-sm text-muted-foreground">
              No projects registered.
            </div>
          )}

          {!loading &&
            !error &&
            projects.map((project) => (
              <button
                key={project.name}
                onClick={() => handleNavigate(`/projects/${project.name}`)}
                className={cn(
                  "w-full flex items-center gap-2 rounded-md px-3 py-2 text-sm text-left transition-colors hover:bg-accent",
                  project.name === activeProject && "bg-accent"
                )}
              >
                <span
                  className={cn(
                    "w-2 h-2 rounded-full shrink-0",
                    project.status === "online"
                      ? "bg-bm-green"
                      : "bg-gray-400"
                  )}
                />
                <span className="truncate flex-1">{project.name}</span>
                {project.versionStatus !== null && project.beastModeVersion !== null && (
                  <Badge
                    className={cn(
                      "text-[10px] px-1.5 py-0 shrink-0 border-0",
                      project.versionStatus === "outdated"
                        ? "bg-bm-red/60 text-white"
                        : "bg-blue-600/60 text-white"
                    )}
                  >
                    v{project.beastModeVersion}
                  </Badge>
                )}
                {project.openBugCount > 0 && (
                  <Badge variant="destructive" className="text-[10px] px-1.5 py-0 shrink-0">
                    {project.openBugCount}
                  </Badge>
                )}
              </button>
            ))}
        </ScrollArea>

        {activeProjectData && (
          <>
            <Separator />
            <div className="p-3 space-y-1">
              <p className="text-xs text-muted-foreground font-medium mb-2">
                Project Docs
              </p>
              {activeProjectData.hasOverview && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start gap-2"
                  onClick={() => openDoc("overview.md", "Overview")}
                >
                  <FileText className="size-3.5" />
                  Overview
                </Button>
              )}
              {activeProjectData.hasMission && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start gap-2"
                  onClick={() =>
                    openDoc("mission-statement.md", "Mission Statement")
                  }
                >
                  <Target className="size-3.5" />
                  Mission
                </Button>
              )}
              {activeProjectData.hasTechDesign && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start gap-2"
                  onClick={() =>
                    openDoc("technical-design.md", "Technical Design")
                  }
                >
                  <BookOpen className="size-3.5" />
                  Tech Design
                </Button>
              )}
            </div>
          </>
        )}

        <Separator />

        <div className="p-3 flex items-center gap-2">
          <span className="text-sm truncate flex-1">{user?.username}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={logout}
            className="shrink-0 gap-1 text-muted-foreground"
          >
            <LogOut className="size-3.5" />
            Logout
          </Button>
        </div>
      </aside>

      <Dialog open={docDialogOpen} onOpenChange={setDocDialogOpen}>
        <DialogContent className="!w-[95vw] sm:!w-[60vw] !max-w-[95vw] sm:!max-w-[60vw] max-h-[80vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>{docTitle}</DialogTitle>
            <DialogDescription>
              {activeProject} - {docTitle}
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
    </>
  );
}
