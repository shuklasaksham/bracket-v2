import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Info, Lock, Unplug, Unlink, Eye, Archive, Clock, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { cn } from "../../lib/utils";
import { useWorkspace, refreshAll } from "../lib/workspace";
import { useBilling, useOnline, money } from "../lib/account";
import { v2 } from "../lib/api2";
import { Button } from "../ui/primitives";
import { AnimatePresence, motion, t as T } from "../ui/motion";
import { useIsMobile } from "../lib/useMedia";

const fmt = (iso, f = "MMM d") => (iso ? format(new Date(iso), f) : "");
const daysUntil = (iso) => Math.max(0, Math.ceil((new Date(iso) - Date.now()) / 864e5));

const TONE = {
  warning: "bg-warning/[0.14] border-warning/30 text-warning",
  danger: "bg-danger/[0.14] border-danger/30 text-danger",
  info: "bg-info/[0.16] border-info/30 text-info",
  neutral: "bg-raised border-line text-fg-secondary",
};
/* Mobile 390 banners are inset cards (Figma 151:1180 … 153:641): solid tinted fill, 1px tone border. */
const TONE_M = {
  warning: "bg-warning-bg border-warning/70 text-warning",
  danger: "bg-danger-bg border-danger/70 text-danger",
  info: "bg-info-bg border-info/70 text-info",
  neutral: "bg-app border-line-strong text-fg-secondary",
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
  const mobile = useIsMobile();
  const toBilling = (q = "") => navigate(`/w/${projectId}/settings/billing${q}`);

  let b = null;
  if (!online) {
    b = { tone: "neutral", icon: Unplug, title: "You’re offline", body: "Memory is read-only. Actions you take are saved and sync when you’re back.", m: { tone: "neutral", icon: Info, body: `Showing memory from ${format(new Date(), "HH:mm")}. Changes sync when you’re back.` } };
  } else if (billing?.status === "expired") {
    b = { tone: "warning", icon: Lock, title: `Your free trial ended on ${fmt(billing.trial_ends_at)}`, body: "Memory and history are read-only and sources are paused. Nothing is deleted.", cta: "Choose a plan", primary: true, onClick: () => toBilling("?choose=1"),
      m: { tone: "danger", icon: AlertTriangle, title: "Your trial ended", body: "Workspaces are read-only. Choose a plan to resume syncing.", cta: "Choose plan" } };
  } else if (billing?.status === "past_due") {
    const r = billing.retry || {};
    b = { tone: "danger", icon: AlertTriangle, title: `We couldn’t charge ${billing.card?.brand || "your card"} ···· ${billing.card?.last4 || ""}`,
      body: `Your bank declined ${money(billing.amount, billing.currency)}${r.last_at ? ` on ${fmt(r.last_at)}` : ""}. We’ll retry ${r.of || 3} times over 7 days. If it still fails, syncing pauses on ${fmt(r.grace_ends_at)} — nothing is deleted.`,
      cta: "Update card", primary: true, onClick: () => toBilling("?card=1"),
      m: { tone: "danger", title: "Payment failed", body: `Update your card by ${fmt(r.grace_ends_at)} to keep syncing.` } };
  } else if (broken) {
    const hrs = broken.disconnected_at ? Math.max(1, Math.round((Date.now() - new Date(broken.disconnected_at)) / 36e5)) : null;
    b = { tone: "danger", icon: Unlink, title: `${broken.label} disconnected${hrs ? ` ${hrs} hour${hrs === 1 ? "" : "s"} ago` : ""}`, body: "New emails aren’t being read, so memory may be missing recent changes. Nothing you’ve already reviewed is affected.",
      cta: `Reconnect ${broken.label}`, primary: true, onClick: () => navigate(`/w/${projectId}/sources/${broken.id}?reconnect=1`), dismiss: () => setDismissed((d) => new Set([...d, broken.id])) };
  } else if (workspace?.status === "deletion_scheduled") {
    b = { tone: "danger", icon: Trash2, title: `This workspace will be deleted on ${fmt(workspace.deletion_at)}`, body: "Everything in it — memory, history and files — is permanently deleted then. Restore it to cancel.", cta: "Restore",
      m: { icon: AlertTriangle, title: `Deletion scheduled for ${fmt(workspace.deletion_at)}`, body: "Everything here is deleted then. Restore to cancel." },
      onClick: async () => {
        setBusy(true);
        try { await v2.restoreWorkspace(projectId); toast.success("Deletion canceled", { description: "The workspace is back to normal." }); refreshAll(); } catch (e) { toast.error(e?.response?.data?.detail || "Couldn’t restore"); } finally { setBusy(false); }
      } };
  } else if (workspace?.status === "archived") {
    b = { tone: "neutral", icon: Archive, title: `Archived on ${fmt(workspace.archived_at)}${workspace.archived_by ? ` by ${workspace.archived_by}` : " by Maya Rao"}`, body: "Read-only. Sources are paused and nothing new is learned.", cta: "Restore workspace",
      m: { icon: Info, title: "Archived · read-only", body: "Syncing is off. Unarchive to resume.", cta: "Unarchive" },
      onClick: async () => {
        setBusy(true);
        try { await v2.unarchive(projectId); toast.success("Workspace restored"); refreshAll(); } catch (e) {
          if (e?.response?.data?.code === "plan_limit") navigate(`/w/${projectId}/settings/billing?limit=1`); else toast.error(e?.response?.data?.detail || "Couldn’t restore");
        } finally { setBusy(false); }
      } };
  } else if (workspace?.status === "expiring") {
    const n = daysUntil(workspace.expires_at);
    b = { tone: "info", icon: Info, title: `This workspace expires in ${n} day${n === 1 ? "" : "s"} (${fmt(workspace.expires_at)})`, body: "Per-workspace plan: Extend for another 60 days, move it to Monthly, or let it become read-only.", cta: `Extend for ${billing?.currency === "usd" ? "$2" : "₹199"}`, onClick: () => toBilling("?extend=1"),
      m: { tone: "warning", icon: AlertTriangle, title: `This workspace expires in ${n} day${n === 1 ? "" : "s"}`, body: `Extend it to keep syncing. After ${fmt(workspace.expires_at)} it becomes read-only.`, cta: "Extend" } };
  } else if (workspace?.role === "viewer") {
    b = { tone: "neutral", icon: Eye, title: "You have view access", body: "You can read memory and ask questions. Ask Maya Rao to make you an Editor to accept changes or send replies.", cta: "Request edit access",
      onClick: () => toast.success("Request sent to Maya Rao", { description: "You’ll get an email when your role changes." }),
      m: { tone: "info", icon: Info, body: "Ask Maya Rao for edit access to review changes.", cta: null } };
  } else if (billing?.status === "trialing" && billing.trial_ends_at && daysUntil(billing.trial_ends_at) <= 3) {
    const n = daysUntil(billing.trial_ends_at);
    b = { tone: "info", icon: Clock, title: `Your free trial ends in ${n} day${n === 1 ? "" : "s"}`, body: "Choose a plan to keep syncing. Nothing is deleted if you don’t.", cta: "Choose a plan", onClick: () => toBilling("?choose=1"),
      m: { strip: true, title: `Trial ends in ${n} day${n === 1 ? "" : "s"}`, body: null, cta: "Choose plan" } };
  }
  if (b && mobile && b.m) b = { ...b, ...Object.fromEntries(Object.entries(b.m).filter(([, v]) => v !== undefined)), primary: false };

  return (
    <AnimatePresence initial={false}>
      {b && (
        <motion.div key={b.title} initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={T.base} className="overflow-hidden shrink-0">
          {mobile && !b.strip ? (
            <div className="px-0 pb-1 pt-0">
              <div role="status" aria-live="polite" className={cn("flex items-center gap-3 rounded-lg border px-4 py-3", TONE_M[b.tone])}>
                <b.icon size={16} className="shrink-0" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-body-m text-fg">{b.title}</p>
                  {b.body && <p className="mt-0.5 text-body-s text-fg-secondary">{b.body}</p>}
                </div>
                {b.cta && <Button size="m" variant="secondary" onClick={b.onClick} disabled={busy} className="shrink-0">{b.cta}</Button>}
              </div>
            </div>
          ) : (
          <div role="status" aria-live="polite" className={cn("flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center md:px-6", TONE[b.tone], mobile && "flex-row items-center border-info/70 bg-info-bg")}>
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
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
