import React from "react";
import { Outlet, useLocation, useNavigate, useParams } from "react-router-dom";
import { SearchX, RotateCcw } from "lucide-react";
import { motion } from "framer-motion";
import { WorkspaceProvider, useWorkspace } from "../../lib/workspace";
import AppShell from "../../shell/AppShell";
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
