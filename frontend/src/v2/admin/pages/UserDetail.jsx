import React, { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, CalendarPlus, Lock, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import { cn } from "../../../lib/utils";
import { useResource, formatApiError } from "../../lib/data";
import { Avatar, Badge, Banner, Button, Checkbox, EmptyState, Input, SourceMark, SyncStatus } from "../../ui/primitives";
import { Dialog } from "../../ui/overlays";
import { Page } from "../../ui/motion";
import { admin } from "../api";
import { Columns, Panel, PanelSkeleton, ago, fmtMoney, fmtNum, shortDate } from "../ui";
import { STATUS_TONE } from "./Users";

/* Admin › User detail — Figma 207:607, 5b Extend trial (209:979),
   5c Suspend (209:1195). Admins see counts and metadata, never content. */
const COUNTRY = { IN: "India", US: "United States", GB: "United Kingdom", DE: "Germany", FR: "France", ES: "Spain", IT: "Italy", JP: "Japan", AE: "UAE", SG: "Singapore", NL: "Netherlands" };

export default function UserDetail() {
  const { uid } = useParams();
  const { data: u, error, reload } = useResource(() => admin.user(uid), [uid]);
  const [dialog, setDialog] = useState(null); // "extend" | "suspend"
  const [busy, setBusy] = useState(false);

  if (error && !u) {
    return (
      <Page>
        <BackLink />
        {error?.response?.status === 404
          ? <EmptyState title="No user with that ID" action={<Button onClick={() => window.history.back()}>Go back</Button>}>They may have deleted their account.</EmptyState>
          : <Banner tone="danger" title="Couldn’t load this user" action={<Button size="s" onClick={reload}>Try again</Button>}>{formatApiError(error)}</Banner>}
      </Page>
    );
  }
  if (!u) return <Page className="space-y-4"><BackLink /><PanelSkeleton h={64} /><div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]"><PanelSkeleton h={320} /><PanelSkeleton h={320} /></div></Page>;

  const canExtend = (u.status === "trial" || u.status === "expired") && !u.paid_since && !u.suspended;
  const unsuspend = async () => {
    setBusy(true);
    try { await admin.unsuspend(u.id); toast.success("Access restored", { description: `${u.name} can sign in again.` }); reload(); } catch (e) { toast.error(formatApiError(e)); } finally { setBusy(false); }
  };
  const meta = [u.email, u.company, `Signed up ${shortDate(u.created_at)} with ${u.sign_in === "google" ? "Google" : "email"}`, `${COUNTRY[u.country] || u.country} (${u.currency.toUpperCase()})`].filter(Boolean).join(" · ");

  return (
    <Page className="space-y-5">
      <BackLink />
      <header className="flex flex-wrap items-center gap-4">
        <Avatar name={u.name} size="l" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-display-s text-fg">{u.name}</h2>
            <Badge tone={STATUS_TONE[u.status] || "neutral"} dot>{u.plan_label}{u.trial_day ? ` · day ${u.trial_day} of ${u.trial_length}` : ""}</Badge>
            {u.from_sandbox && <Badge tone="info">From sandbox</Badge>}
          </div>
          <p className="mt-1 text-body-m text-fg-secondary">{meta}</p>
        </div>
        <div className="flex gap-2">
          {canExtend && <Button icon={CalendarPlus} onClick={() => setDialog("extend")}>Extend trial</Button>}
          {u.suspended
            ? <Button icon={ShieldOff} loading={busy} onClick={unsuspend}>Restore access</Button>
            : <Button variant="danger" onClick={() => setDialog("suspend")}>Suspend account</Button>}
        </div>
      </header>
      {u.suspended && <Banner tone="danger" title="This account is suspended">{u.suspended_reason ? `Reason: ${u.suspended_reason}. ` : ""}They can’t sign in and syncing is stopped. Nothing has been deleted.</Banner>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-4">
          <Panel title="Workspaces" meta={`${u.workspaces.length} of 10 projects`} bodyClassName="mt-2">
            {u.workspaces.length === 0 && <p className="py-3 text-body-s text-fg-tertiary">No workspaces yet.</p>}
            <ul>
              {u.workspaces.map((w) => (
                <li key={w.id} className="flex items-center gap-3 border-t border-line-subtle py-2.5 first:border-t-0">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body-m text-fg">{w.name}</span>
                    <span className="block truncate text-body-s text-fg-tertiary">{[w.client, w.sources.map((s) => s[0].toUpperCase() + s.slice(1)).join(" · ")].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className="font-mono text-[12px] text-fg-secondary">{w.memories} memories</span>
                  <span className={cn("w-[120px] text-right text-body-s", w.attention ? "text-warning" : "text-fg-tertiary")}>{w.attention ? `${w.attention} need${w.attention === 1 ? "s" : ""} attention` : "—"}</span>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="Activity" meta="Last 30 days">
            <Columns data={u.activity.map((d) => ({ label: d.date.slice(5), values: [d.sessions] }))} height={90} labels={{ aria: "Sessions per day" }} />
            <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[["Sessions", fmtNum(u.usage.sessions)], ["Changes accepted", `${u.usage.accepted} of ${u.usage.reviewed}`], ["Questions asked", fmtNum(u.usage.asks)], ["Replies sent", fmtNum(u.usage.replies)]].map(([k, v]) => (
                <div key={k}><dd className="text-title-l text-fg">{v}</dd><dt className="text-body-s text-fg-tertiary">{k}</dt></div>
              ))}
            </dl>
          </Panel>
          <p className="flex items-center gap-2 rounded-lg border border-line-subtle p-3 text-body-s text-fg-tertiary"><Lock size={16} className="shrink-0" />Admins see counts and metadata only. Email, Slack and note content is never shown here.</p>
        </div>

        <div className="min-w-0 space-y-4">
          <Panel title="Billing" meta={<Badge tone={STATUS_TONE[u.status] || "neutral"}>{u.billing.plan_label}</Badge>}>
            <Rows rows={[
              ["Plan", u.plan === "trial" ? (u.status === "trial" ? "None yet — on trial" : "None — trial ended") : u.billing.plan_label],
              u.trial_ends_at && !u.paid_since && [u.status === "trial" ? "Trial ends" : "Trial ended", `${shortDate(u.trial_ends_at)}${u.status === "trial" ? ` (${Math.max(0, Math.ceil((Date.parse(u.trial_ends_at) - Date.now()) / 864e5))} days)` : ""}`],
              u.paid_since && ["Paying since", shortDate(u.paid_since)],
              u.canceled_at && ["Canceled", shortDate(u.canceled_at)],
              ["Currency", u.currency === "inr" ? "INR, GST included" : "USD"],
              ["Payment method", u.billing.payment_method ? `${u.billing.payment_method.brand} ···· ${u.billing.payment_method.last4}` : "Not added"],
              u.billing.retry && ["Retry", `Attempt ${u.billing.retry.attempt} of 3 · grace ends ${shortDate(u.billing.retry.grace_ends_at)}`, "text-warning"],
              ["Invoices", u.billing.invoices ? fmtNum(u.billing.invoices) : "None"],
              ["Lifetime value", fmtMoney(u.billing.lifetime_value, u.currency)],
            ]} />
          </Panel>
          <Panel title="Sources" meta={`${u.sources.length} connected`}>
            {u.sources.length === 0 && <p className="text-body-s text-fg-tertiary">Nothing connected yet.</p>}
            <ul className="space-y-3">
              {u.sources.map((s) => (
                <li key={s.provider} className="flex items-center gap-2.5">
                  <SourceMark provider={s.provider} />
                  <span className="min-w-0 flex-1"><span className="block text-body-m text-fg">{s.provider[0].toUpperCase() + s.provider.slice(1)}</span><span className="block truncate text-body-s text-fg-tertiary">{s.label}</span></span>
                  <SyncStatus state={s.status === "error" ? "error" : "synced"} label={s.status === "error" ? `${s.error} · since ${ago(s.since)}` : `Synced ${ago(s.since)}${ago(s.since).match(/\d/) ? " ago" : ""}`} />
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="Account">
            <Rows rows={[
              ["User ID", <span className="font-mono text-[12px]">{u.id}</span>],
              ["Sign-in", u.sign_in === "google" ? "Google" : "Email and password"],
              ["Email verified", u.email_verified ? "Yes" : "No"],
              ["Last active", `${ago(u.last_active_at)}${/\d/.test(ago(u.last_active_at)) && !/[A-Z]/.test(ago(u.last_active_at)) ? " ago" : ""} · ${u.account.last_device}, ${u.account.last_city}`],
              ["Members invited", fmtNum(u.account.members_invited)],
            ]} />
          </Panel>
          {u.actions?.length > 0 && (
            <Panel title="Admin actions" meta="audit log">
              <ul className="space-y-2">
                {u.actions.map((a) => (
                  <li key={a.id} className="text-body-s"><span className="text-fg">{a.action.replace(/_/g, " ")}</span> <span className="text-fg-tertiary">· {ago(a.at)}{a.detail?.reason ? ` · ${a.detail.reason}` : ""}</span></li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>

      <ExtendTrial open={dialog === "extend"} user={u} onClose={() => setDialog(null)} onDone={reload} />
      <Suspend open={dialog === "suspend"} user={u} onClose={() => setDialog(null)} onDone={reload} />
    </Page>
  );
}

const BackLink = () => <Link to="/admin/users" className="inline-flex items-center gap-1.5 text-body-s text-fg-secondary transition-colors hover:text-fg"><ArrowLeft size={16} /> All users</Link>;
function Rows({ rows }) {
  return (
    <dl className="space-y-2.5">
      {rows.filter(Boolean).map(([k, v, tone]) => (
        <div key={k} className="flex items-baseline gap-3 text-body-m">
          <dt className="shrink-0 text-fg-tertiary">{k}</dt>
          <dd className={cn("min-w-0 flex-1 text-right", tone || "text-fg")}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
const first = (n) => (n || "").split(" ")[0];

function ExtendTrial({ open, user, onClose, onDone }) {
  const [days, setDays] = useState(7);
  const [reason, setReason] = useState("");
  const [notify, setNotify] = useState(true);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const base = Math.max(Date.now(), Date.parse(user.trial_ends_at) || Date.now());
  const end = (d) => new Date(base + d * 864e5).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const submit = async () => {
    if (!reason.trim()) { setErr("Add a reason. It’s kept in the audit log."); return; }
    setBusy(true);
    try {
      const r = await admin.extendTrial(user.id, { days, reason: reason.trim(), notify });
      toast.success(`Trial extended to ${shortDate(r.trial_ends_at)}`, { description: notify ? `${first(user.name)} will get an email.` : undefined });
      setReason(""); setErr(null); onClose(); onDone();
    } catch (e) { setErr(formatApiError(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={`Extend ${first(user.name)}’s trial`}
      description={`${user.status === "trial" ? `The trial ends ${shortDate(user.trial_ends_at)}` : `The trial ended ${shortDate(user.trial_ends_at)}`}. Extending doesn’t charge anything and keeps all their data.`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit}>Extend trial</Button></>}>
      <div role="radiogroup" aria-label="Extend by" className="space-y-2">
        {[7, 14].map((d) => (
          <button key={d} type="button" role="radio" aria-checked={days === d} onClick={() => setDays(d)}
            className={cn("flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors", days === d ? "border-fg-secondary bg-raised" : "border-line hover:bg-hover")}>
            <span className={cn("inline-flex h-4 w-4 items-center justify-center rounded-full border", days === d ? "border-fg" : "border-line-control")}>{days === d && <span className="h-2 w-2 rounded-full bg-fg" />}</span>
            <span><span className="block text-body-m font-medium text-fg">{d} more days</span><span className="block text-body-s text-fg-tertiary">New end date: {end(d)}</span></span>
          </button>
        ))}
      </div>
      <label htmlFor="extend-reason" className="mb-2 mt-4 block text-body-s font-medium text-fg-secondary">Reason (kept in the audit log)</label>
      <Input id="extend-reason" value={reason} invalid={!!err} onChange={(e) => { setReason(e.target.value); setErr(null); }} placeholder="e.g. Onboarding call ran late" />
      {err && <p role="alert" className="mt-2 text-body-s text-danger">{err}</p>}
      <label className="mt-4 flex cursor-pointer items-center gap-2.5 text-body-m text-fg"><Checkbox checked={notify} onChange={setNotify} />Email {first(user.name)} that their trial was extended</label>
    </Dialog>
  );
}

function Suspend({ open, user, onClose, onDone }) {
  const [reason, setReason] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!reason.trim()) { setErr("Add a reason. It’s kept in the audit log."); return; }
    setBusy(true);
    try {
      await admin.suspend(user.id, reason.trim());
      toast.success(`${user.name} suspended`, { description: "You can restore access from this page." });
      setReason(""); setErr(null); onClose(); onDone();
    } catch (e) { setErr(formatApiError(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={`Suspend ${user.name}?`} description="Use this for abuse or a payment dispute."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="danger" loading={busy} onClick={submit}>Suspend account</Button></>}>
      <ul className="space-y-1.5 rounded-lg border border-line-subtle p-3 text-body-m text-fg">
        <li>• They’re signed out on every device and can’t sign back in</li>
        <li>• Syncing stops for their {user.workspaces.length} workspace{user.workspaces.length === 1 ? "" : "s"}; nothing is deleted</li>
        <li>• You can restore access at any time from this page</li>
      </ul>
      <label htmlFor="suspend-reason" className="mb-2 mt-4 block text-body-s font-medium text-fg-secondary">Reason (kept in the audit log)</label>
      <Input id="suspend-reason" autoFocus value={reason} invalid={!!err} onChange={(e) => { setReason(e.target.value); setErr(null); }} />
      {err && <p role="alert" className="mt-2 text-body-s text-danger">{err}</p>}
    </Dialog>
  );
}
