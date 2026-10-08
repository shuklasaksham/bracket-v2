import React from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../ui/primitives";
import { Dialog } from "../ui/overlays";
import { loadBilling } from "../lib/account";

/* Plan limit — Figma › Workspaces · Plan limit reached (108:16807 desktop,
   151:1469 mobile). Shown instead of starting a new workspace when the
   Monthly plan's projects are all in use. Dialog on desktop, sheet on mobile. */
export async function canCreateWorkspace() {
  try {
    const b = await loadBilling();
    if (!b || b.status === "trialing" || b.status === "expired") return true;
    return !(b.workspaces && b.workspaces.used >= b.workspaces.limit);
  } catch { return true; }
}

export default function PlanLimit({ open, onOpenChange, used = 10, limit = 10, wid }) {
  const navigate = useNavigate();
  const go = (to) => { onOpenChange(false); navigate(to); };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="s" title={`You’ve used ${used} of ${limit} projects`}
      description="Archive a finished workspace, or switch to Per project pricing to add more."
      footer={<>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>Not now</Button>
        <Button onClick={() => go(wid ? `/w/${wid}/settings/workspace` : "/app")}>Archive a workspace</Button>
        <Button variant="primary" onClick={() => go(wid ? `/w/${wid}/settings/billing` : "/app")}>Change plan</Button>
      </>} />
  );
}
