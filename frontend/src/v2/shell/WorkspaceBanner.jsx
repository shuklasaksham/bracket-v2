import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Info, Lock, Unplug, Unlink, Eye, Archive, Clock } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { cn } from "../../lib/utils";
import { useWorkspace, refreshAll } from "../lib/workspace";
import { useBilling, useOnline, money } from "../lib/account";
import { v2 } from "../lib/api2";
import { Button } from "../ui/primitives";
import { AnimatePresence, motion, t as T } from "../ui/motion";

const fmt = (iso, f = "MMM d") => (iso ? format(new Date(iso), f) : "");
const daysUntil = (iso) => Math.max(0, Math.ceil((new Date(iso) - Date.now()) / 864e5));

const TONE = {
  warning: "bg-warning/[0.14] border-warning/30 text-warning",
  danger: "bg-danger/[0.14] border-danger/30 text-danger",
  info: "bg-info/[0.16] border-info/30 text-info",
  neutral: "bg-raised border-line text-fg-secondary",
};

/* WorkspaceBanner — one strip under the top bar for account- and workspace-level
   states (Figma: Trial ended · Payment failed · Workspace expiring · Archived ·
   View only · Offline). Highest-priority state wins. */
export default function WorkspaceBanner() {
  const { workspace, projectId, sources } = useWorkspace();
  const [dismissed, setDismissed] = useState(() => new Set());
  const broken = (sources || []).find((s) => (s.status === "error" || s.health === "reconnect") && !dismissed.has(s.id));
  const { billing, reload } = useBilling();
  const online = useOnline();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const toBilling = (q = "") => navigate(`/w/${projectId}/settings/billing${q}`);

  let b = null;
  if (!online) {
    b = { tone: "neutral", icon: Unplug, title: "You’re offline", body: "Memory is read-only. Actions you take are saved and sync when you’re back." };
  } else if (billing?.status === "expired") {
    b = { tone: "warning", icon: Lock, title: `Your free trial ended on ${fmt(billing.trial_ends_at)}`, body: "Memory and history are read-only and sources are paused. Nothing is deleted.", cta: "Choose a plan", primary: true, onClick: () => toBilling("?choose=1") };
  } else if (billing?.status === "past_due") {
    const r = billing.retry || {};
    b = { tone: "danger", icon: AlertTriangle, title: `We couldn’t charge ${billing.card?.brand || "your card"} ···· ${billing.card?.last4 || ""}`,
      body: `Your bank declined ${money(billing.amount, billing.currency)}${r.last_at ? ` on ${fmt(r.last_at)}` : ""}. We’ll retry ${r.of || 3} times over 7 days. If it still fails, syncing pauses on ${fmt(r.grace_ends_at)} — nothing is deleted.`,
      cta: "Update card", primary: true, onClick: () => toBilling("?card=1") };
  } else if (broken) {
    const hrs = broken.disconnected_at ? Math.max(1, Math.round((Date.now() - new Date(broken.disconnected_at)) / 36e5)) : null;
    b = { tone: "danger", icon: Unlink, title: `${broken.label} disconnected${hrs ? ` ${hrs} hour${hrs === 1 ? "" : "s"} ago` : ""}`, body: "New emails aren’t being read, so memory may be missing recent changes. Nothing you’ve already reviewed is affected.",
      cta: `Reconnect ${broken.label}`, primary: true, onClick: () => navigate(`/w/${projectId}/sources/${broken.id}?reconnect=1`), dismiss: () => setDismissed((d) => new Set([...d, broken.id])) };
  } else if (workspace?.status === "archived") {
    b = { tone: "neutral", icon: Archive, title: `Archived on ${fmt(workspace.archived_at)}${workspace.archived_by ? ` by ${workspace.archived_by}` : " by Maya Rao"}`, body: "Read-only. Sources are paused and nothing new is learned.", cta: "Restore workspace",
      onClick: async () => {
        setBusy(true);
        try { await v2.unarchive(projectId); toast.success("Workspace restored"); refreshAll(); } catch (e) {
          if (e?.response?.data?.code === "plan_limit") navigate(`/w/${projectId}/settings/billing?limit=1`); else toast.error(e?.response?.data?.detail || "Couldn’t restore");
        } finally { setBusy(false); }
      } };
  } else if (workspace?.status === "expiring") {
    const n = daysUntil(workspace.expires_at);
    b = { tone: "info", icon: Info, title: `This workspace expires in ${n} day${n === 1 ? "" : "s"} (${fmt(workspace.expires_at)})`, body: "Per-workspace plan: Extend for another 60 days, move it to Monthly, or let it become read-only.", cta: `Extend for ${billing?.currency === "usd" ? "$2" : "₹199"}`, onClick: () => toBilling("?extend=1") };
  } else if (workspace?.role === "viewer") {
    b = { tone: "neutral", icon: Eye, title: "You have view access", body: "You can read memory and ask questions. Ask Maya Rao to make you an Editor to accept changes or send replies.", cta: "Request edit access",
      onClick: () => toast.success("Request sent to Maya Rao", { description: "You’ll get an email when your role changes." }) };
  } else if (billing?.status === "trialing" && billing.trial_ends_at && daysUntil(billing.trial_ends_at) <= 3) {
    const n = daysUntil(billing.trial_ends_at);
    b = { tone: "info", icon: Clock, title: `Your free trial ends in ${n} day${n === 1 ? "" : "s"}`, body: "Choose a plan to keep syncing. Nothing is deleted if you don’t.", cta: "Choose a plan", onClick: () => toBilling("?choose=1") };
  }

  return (
    <AnimatePresence initial={false}>
      {b && (
        <motion.div key={b.title} initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={T.base} className="overflow-hidden shrink-0">
          <div role="status" aria-live="polite" className={cn("flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center md:px-6", TONE[b.tone])}>
            <b.icon size={16} className="mt-0.5 shrink-0 self-start sm:self-center" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-body-m text-fg">{b.title}</p>
              <p className="text-body-s text-fg-secondary">{b.body}</p>
            </div>
            {b.dismiss && <Button size="m" variant="ghost" onClick={b.dismiss} className="shrink-0 self-start sm:self-center">Dismiss</Button>}
            {b.cta && (
              <Button size="m" variant={b.primary ? "primary" : "secondary"} onClick={b.onClick} disabled={busy} className="shrink-0 self-start sm:self-center">
                {b.cta}
              </Button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
