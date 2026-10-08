import React from "react";
import { Outlet, useLocation, useNavigate, useParams } from "react-router-dom";
import { SearchX, RotateCcw, Search } from "lucide-react";
import { motion } from "framer-motion";
import { WorkspaceProvider, useWorkspace } from "../../lib/workspace";
import AppShell, { MobileSubHeader } from "../../shell/AppShell";
import { useIsMobile } from "../../lib/useMedia";
import SessionExpired from "../../shell/SessionExpired";
import { Button, EmptyState } from "../../ui/primitives";
import { t as T } from "../../ui/motion";
import { Seo } from "../../shell/Seo";

export default function WorkspaceLayout() {
  const { id } = useParams();
  return (
    <WorkspaceProvider projectId={id}>
      <Guard />
    </WorkspaceProvider>
  );
}

function Guard() {
  const { error, project, refresh } = useWorkspace();
  const navigate = useNavigate();
  const location = useLocation();
  const status = error?.response?.status;
  // Animate between sections (Overview → Memory …), not between items inside one.
  const section = location.pathname.split("/")[3] || "overview";
  if (error && !project && status !== 401) {
    const missing = status === 404 || status === 403;
    return (
      <div className="bk flex min-h-[100dvh] items-center justify-center bg-app px-4">
        <Seo title="Not found" />
        <EmptyState
          icon={SearchX}
          title={missing ? "This workspace doesn’t exist" : "Couldn’t load this workspace"}
          action={
            missing ? (
              <Button variant="primary" onClick={() => navigate("/app", { replace: true })}>Go to my workspaces</Button>
            ) : (
              <Button variant="primary" icon={RotateCcw} onClick={() => refresh()}>Try again</Button>
            )
          }
        >
          {missing ? "The link may be old, or you may not have access to it." : "Check your connection and try again."}
        </EmptyState>
      </div>
    );
  }
  return (
    <AppShell>
      <Seo title={project?.name || "Workspace"} />
      <motion.div key={section} className="h-full" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={T.base}>
        <Outlet />
      </motion.div>
      <SessionExpired />
    </AppShell>
  );
}

/* In-workspace 404 — Figma › 404 · Not found — Mobile 390 (153:1054). */
export function WorkspaceNotFound() {
  const { id } = useParams();
  const navigate = useNavigate();
  const mobile = useIsMobile();
  return (
    <div className="flex h-full flex-col">
      <Seo title="Not found" />
      {mobile && <MobileSubHeader title="Not found" onBack={() => navigate(`/w/${id}`)} />}
      <div className="flex flex-1 flex-col items-center px-4 pt-12 text-center md:justify-center md:pt-0">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.06]"><Search size={18} strokeWidth={1.75} className="text-fg-secondary" /></span>
        <h1 className="mt-4 text-title-m text-fg">This page doesn’t exist</h1>
        <p className="mt-2 max-w-[360px] text-body-s text-fg-secondary">The link may be old, or you may not have access to this workspace.</p>
        <Button variant="primary" className="mt-8 h-11 w-full md:h-8 md:w-auto" onClick={() => navigate(`/w/${id}`)}>Go to Overview</Button>
      </div>
    </div>
  );
}
