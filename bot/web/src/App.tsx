import { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/lib/auth";
import { MobileSidebarProvider, useMobileSidebar } from "@/lib/mobile-sidebar";
import { apiFetch } from "@/lib/api";
import { ProjectSidebar } from "@/components/ProjectSidebar";
import { ProjectDashboard } from "@/pages/ProjectDashboard";
import { EpicDashboard } from "@/pages/EpicDashboard";
import { FeatureDetailPage } from "@/pages/FeatureDetailPage";
import { BugDetailPage } from "@/pages/BugDetailPage";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";

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
}

function DefaultRedirect() {
  const navigate = useNavigate();
  const [checked, setChecked] = useState(false);
  const [noProjects, setNoProjects] = useState(false);

  useEffect(() => {
    apiFetch<ProjectResponse[]>("/api/projects")
      .then((projects) => {
        if (projects.length > 0) {
          navigate(`/projects/${projects[0].name}`, { replace: true });
        } else {
          setNoProjects(true);
        }
      })
      .catch(() => setNoProjects(true))
      .finally(() => setChecked(true));
  }, [navigate]);

  if (!checked) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (noProjects) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-2 max-w-md">
          <p className="text-lg font-medium">No projects registered</p>
          <p className="text-sm text-muted-foreground">
            Start a Claude Code session with Beast Mode to register a project.
          </p>
        </div>
      </div>
    );
  }

  return null;
}

function MobileTopBar() {
  const { toggle } = useMobileSidebar();

  return (
    <div className="md:hidden flex items-center gap-3 px-4 py-3 border-b bg-muted/30">
      <Button variant="ghost" size="icon" className="size-8" onClick={toggle}>
        <Menu className="size-5" />
      </Button>
      <h1 className="text-lg font-semibold">Beast Mode</h1>
    </div>
  );
}

function MobileSidebarOverlay() {
  const { isOpen, close } = useMobileSidebar();

  if (!isOpen) return null;

  return (
    <div className="md:hidden fixed inset-0 z-40">
      <div className="absolute inset-0 bg-black/60" onClick={close} />
      <div className="relative z-50 h-full w-64">
        <ProjectSidebar />
      </div>
    </div>
  );
}

function AppLayout() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!user) {
    window.location.href = "/auth/login";
    return null;
  }

  return (
    <MobileSidebarProvider>
      <div className="flex flex-col md:flex-row h-screen">
        <MobileTopBar />
        <MobileSidebarOverlay />
        <div className="hidden md:flex">
          <ProjectSidebar />
        </div>
        <main className="flex-1 overflow-auto">
          <Routes>
            <Route path="/projects/:name" element={<ProjectDashboard />} />
            <Route path="/projects/:name/epics/:epic" element={<EpicDashboard />} />
            <Route path="/projects/:name/features/:feature" element={<FeatureDetailPage />} />
            <Route path="/projects/:name/features/:epic/:feature" element={<FeatureDetailPage />} />
            <Route path="/projects/:name/bugs/:id" element={<BugDetailPage />} />
            <Route path="*" element={<DefaultRedirect />} />
          </Routes>
        </main>
      </div>
    </MobileSidebarProvider>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppLayout />
      </AuthProvider>
    </BrowserRouter>
  );
}
