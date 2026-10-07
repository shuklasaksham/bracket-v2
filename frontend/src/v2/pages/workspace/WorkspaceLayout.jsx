import React from "react";
import { Outlet, useNavigate, useParams } from "react-router-dom";
import { SearchX, RotateCcw } from "lucide-react";
import { WorkspaceProvider, useWorkspace } from "../../lib/workspace";
import AppShell from "../../shell/AppShell";
import { Button, EmptyState } from "../../ui/primitives";
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
  const status = error?.response?.status;
  if (error && !project) {
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
      <Outlet />
    </AppShell>
  );
}
