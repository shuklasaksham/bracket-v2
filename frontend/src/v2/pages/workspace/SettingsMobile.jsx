import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ChevronRight, Info, Plus, Archive, LogOut, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { useAuth } from "../../../lib/AuthContext";
import { useWorkspace, fetchProjects, useProjects } from "../../lib/workspace";
import { useBilling, setBilling } from "../../lib/account";
import { v2 } from "../../lib/api2";
import { useResource } from "../../lib/data";
import { Avatar, Badge, Button, Input, Toggle } from "../../ui/primitives";
import { FullScreen, Sheet } from "../../ui/overlays";
import { Stagger, StaggerItem, motion, t as T } from "../../ui/motion";
import { MobileSubHeader } from "../../shell/AppShell";
import { cn } from "../../../lib/utils";

/* Settings — Mobile 390. Figma › 03b › 07 · Workspace, settings & billing:
   Profile (112:5773), Members (112:5818), Billing trial (112:5878) / Monthly active
   (152:479) / canceled (152:664), Notifications (151:449), Workspace (151:518),
   Privacy & data (151:593), and their sheets / full-screen flows. Each section is
   a pushed screen with a sticky action bar; dialogs become bottom sheets. */

const money = (amount, cur) => (cur === "inr" ? `₹${Number(amount).toLocaleString("en-IN")}` : `$${Number(amount).toFixed(amount % 1 ? 2 : 0)}`);
const money2 = (amount, cur) => (cur === "inr" ? `₹${Number(amount).toLocaleString("en-IN")}.00` : `$${Number(amount).toFixed(2)}`);
const TITLES = { profile: "Profile", notifications: "Notifications", workspace: "Workspace", members: "Members", billing: "Billing", privacy: "Privacy & data" };

/* ───── shared bits ───── */
const Label = ({ htmlFor, children }) => <label htmlFor={htmlFor} className="mb-2 block text-body-s text-fg-secondary">{children}</label>;
const Footer = ({ children }) => <div className="flex shrink-0 gap-3 border-t border-line-subtle px-4 pt-3 pb-3 safe-bottom [&>*]:h-11 [&>*]:flex-1">{children}</div>;
function NavRows({ rows }) {
  return (
    <Stagger as="ul" className="overflow-hidden rounded-lg border border-line divide-y divide-line-subtle">
      {rows.map((r) => (
        <StaggerItem as="li" key={r.title}>
          <button onClick={r.onClick} disabled={r.disabled} className="flex min-h-[64px] w-full items-center gap-3 px-4 py-3 text-left active:bg-hover disabled:opacity-50">
            <span className="min-w-0 flex-1"><span className={cn("block text-body-m", r.danger ? "text-danger" : "text-fg")}>{r.title}</span>{r.sub && <span className="block text-body-s text-fg-tertiary">{r.sub}</span>}</span>
            {r.trailing ?? <ChevronRight size={16} className="shrink-0 text-fg-tertiary" />}
          </button>
        </StaggerItem>
      ))}
    </Stagger>
  );
}
function Radio({ on, title, sub, right, onClick }) {
  return (
    <button role="radio" aria-checked={on} onClick={onClick} className={cn("flex w-full items-start gap-3 rounded-lg border px-4 py-3 text-left transition-colors duration-fast", on ? "border-fg" : "border-line-control")}>
      <span className={cn("mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border", on ? "border-fg" : "border-line-control")}>{on && <span className="h-2 w-2 rounded-full bg-fg" />}</span>
      <span className="min-w-0 flex-1"><span className="block text-body-m text-fg">{title}</span>{sub && <span className="block text-body-s text-fg-tertiary">{sub}</span>}</span>
      {right && <span className="text-body-m text-fg">{right}</span>}
    </button>
  );
}

/* ───── entry ───── */
export default function SettingsMobile({ section }) {
  const { projectId } = useWorkspace();
  const navigate = useNavigate();
  const Body = { profile: Profile, notifications: Notifications, workspace: WorkspacePage, members: Members, billing: Billing, privacy: Privacy }[section];
  if (!Body) return <SettingsIndex />;
  return (
    <div className="flex h-full flex-col">
      <MobileSubHeader title={TITLES[section]} onBack={() => (window.history.length > 1 ? navigate(-1) : navigate(`/w/${projectId}/settings`))} />
      <Body />
    </div>
  );
}

/* Settings index — reached from the workspace sheet. */
function SettingsIndex() {
  const { projectId, project } = useWorkspace();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const go = (k) => navigate(`/w/${projectId}/settings/${k}`);
  return (
    <div className="flex h-full flex-col">
      <MobileSubHeader title="Settings" onBack={() => navigate(`/w/${projectId}`)} />
      <div className="scroll-pane min-h-0 flex-1 px-4 py-4">
        <p className="eyebrow mb-3">{project?.name || "This workspace"}</p>
        <NavRows rows={[
          { title: "Workspace", sub: "Name, memory rules, archive, delete", onClick: () => go("workspace") },
          { title: "Members", sub: "Who can see and act on this memory", onClick: () => go("members") },
        ]} />
        <p className="eyebrow mt-6 mb-3">Account</p>
        <NavRows rows={[
          { title: "Profile", sub: user?.email, onClick: () => go("profile") },
          { title: "Notifications", sub: "Push and email", onClick: () => go("notifications") },
          { title: "Billing", sub: "Plan, payment method, invoices", onClick: () => go("billing") },
          { title: "Privacy & data", sub: "What Bracket reads, export, delete", onClick: () => go("privacy") },
        ]} />
        <Button size="l" className="mt-6 w-full" icon={LogOut} onClick={async () => { await logout(); navigate("/login"); }}>Sign out</Button>
      </div>
    </div>
  );
}

/* ───── Profile — 112:5773 ───── */
function Profile() {
  const { user, setUser, logout } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState(user?.name || "");
  const [email, setEmail] = useState(user?.email || "");
  const [tz, setTz] = useState(user?.timezone || "Asia/Kolkata (GMT+5:30)");
  const dirty = name !== (user?.name || "") || tz !== (user?.timezone || "Asia/Kolkata (GMT+5:30)");
  const save = async () => {
    const { api } = await import("../../../lib/api");
    const u = (await api.patch("/auth/me", { name, timezone: tz })).data;
    setUser?.(u); toast.success("Profile saved");
  };
  return (
    <>
      <div className="scroll-pane min-h-0 flex-1 px-4 py-4">
        <div className="flex items-center gap-3">
          <Avatar name={user?.name} email={user?.email} src={user?.picture} size="l" />
          <div className="min-w-0"><p className="text-body-m font-medium text-fg">{user?.name}</p><p className="text-body-s text-fg-tertiary">{[user?.designation || "Design lead", user?.company || "Northlight Studio"].join(" · ")}</p></div>
        </div>
        <div className="mt-5 space-y-4">
          <div><Label htmlFor="m-name">Full name</Label><Input id="m-name" className="h-11" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><Label htmlFor="m-email">Email</Label><Input id="m-email" className="h-11" type="email" value={email} onChange={(e) => setEmail(e.target.value)} onBlur={() => email !== user?.email && toast("We sent a verification code to " + email)} /></div>
          <div><Label htmlFor="m-tz">Time zone</Label><Input id="m-tz" className="h-11" value={tz} onChange={(e) => setTz(e.target.value)} /></div>
        </div>
        <Button size="l" className="mt-4 w-full" onClick={async () => { await logout(); navigate("/login"); }}>Sign out</Button>
      </div>
      {dirty && <Footer><Button variant="ghost" onClick={() => { setName(user?.name || ""); setTz(user?.timezone || "Asia/Kolkata (GMT+5:30)"); }}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></Footer>}
    </>
  );
}

/* ───── Notifications — 151:449 ───── */
function Notifications() {
  const { data, setData } = useResource(() => v2.notificationPrefs(), []);
  const ev = (k) => (data?.events || []).find((e) => e.key === k) || {};
  const setPush = async (key, value) => {
    setData((d) => ({ ...d, events: d.events.map((e) => (e.key === key ? { ...e, push: value } : e)) }));
    await v2.updateNotificationPrefs({ event: key, channel: "push", value });
  };
  const setDigest = async (k, v) => { setData((d) => ({ ...d, [k]: { ...(d[k] || {}), enabled: v } })); await v2.updateNotificationPrefs({ [k]: { enabled: v } }); };
  const Row = ({ title, help, checked, onChange }) => (
    <div className="flex items-center gap-4 px-4 py-3"><div className="min-w-0 flex-1"><p className="text-body-m text-fg">{title}</p><p className="text-body-s text-fg-tertiary">{help}</p></div><Toggle checked={!!checked} label={title} onChange={onChange} /></div>
  );
  return (
    <div className="scroll-pane min-h-0 flex-1 px-4 py-4">
      <p className="eyebrow mb-3">Push</p>
      <div className="overflow-hidden rounded-lg border border-line divide-y divide-line-subtle">
        <Row title="Needs your attention" help="Scope changes, conflicts, waiting on you" checked={ev("needs_review").push} onChange={(v) => setPush("needs_review", v)} />
        <Row title="Commitments due" help="1 day before the due date" checked={ev("commitment_due").push} onChange={(v) => setPush("commitment_due", v)} />
      </div>
      <p className="eyebrow mt-6 mb-3">Email</p>
      <div className="overflow-hidden rounded-lg border border-line divide-y divide-line-subtle">
        <Row title="Daily digest" help={`Everything else, once a day at ${data?.digest?.time || "9:00"}`} checked={data?.digest?.enabled} onChange={(v) => setDigest("digest", v)} />
        <Row title="Weekly summary" help="Mondays · what changed across workspaces" checked={data?.weekly?.enabled} onChange={(v) => setDigest("weekly", v)} />
      </div>
      <p className="mt-4 text-body-s text-fg-tertiary">Bracket never notifies anyone except you.</p>
    </div>
  );
}

/* ───── Workspace — 151:518 + delete / archive / leave sheets (153:2, 153:101, 153:173) ───── */
function WorkspacePage() {
  const { projectId, workspace, refresh, role } = useWorkspace();
  const navigate = useNavigate();
  const [name, setName] = useState(workspace?.name || "");
  const [client, setClient] = useState(workspace?.client_name || "");
  const [sheet, setSheet] = useState(null);
  const [typed, setTyped] = useState("");
  const owner = role === "owner";
  useEffect(() => { setName(workspace?.name || ""); setClient(workspace?.client_name || ""); }, [workspace?.name, workspace?.client_name]);
  const saveField = async (body) => { await v2.updateWorkspace(projectId, body); refresh(); fetchProjects(true); toast.success("Saved"); };
  return (
    <div className="scroll-pane min-h-0 flex-1 px-4 py-4">
      <div className="space-y-4">
        <div><Label htmlFor="mw-name">Workspace name</Label><Input id="mw-name" className="h-11" value={name} disabled={!owner} onChange={(e) => setName(e.target.value)} onBlur={() => name !== workspace?.name && saveField({ name })} /></div>
        <div><Label htmlFor="mw-client">Client or business</Label><Input id="mw-client" className="h-11" value={client} disabled={!owner} onChange={(e) => setClient(e.target.value)} onBlur={() => client !== workspace?.client_name && saveField({ client_name: client })} /></div>
      </div>
      <div className="mt-4">
        <NavRows rows={[
          { title: "Export workspace", sub: "Memory, timeline and sources as JSON + PDF", onClick: async () => { const r = await v2.exportWorkspace(projectId, "json"); toast.success("Export started", { description: `We’ll email ${r.email} a download link.` }); } },
          { title: "Archive workspace", sub: "Stops syncing · read-only · doesn’t count to your plan", disabled: !owner || workspace?.status === "archived", onClick: () => setSheet("archive") },
          { title: "Leave workspace", sub: "You lose access; others keep it", onClick: () => (owner ? toast("Transfer ownership first", { description: "Make another member an Owner in Members, then leave." }) : setSheet("leave")) },
          { title: "Delete workspace", sub: "Recoverable for 30 days, then deleted", disabled: !owner, onClick: () => { setTyped(""); setSheet("delete"); } },
        ]} />
      </div>
      <Sheet open={sheet === "delete"} onOpenChange={(o) => !o && setSheet(null)} title="Delete this workspace?"
        description={`Memory, timeline and sources for ${workspace?.name} are recoverable for 30 days, then permanently deleted. Encrypted backups expire automatically.`}
        footer={<><Button variant="ghost" onClick={() => setSheet(null)}>Cancel</Button><Button variant="danger" disabled={typed !== workspace?.name} onClick={async () => {
          const r = await v2.deleteWorkspace(projectId, typed); setSheet(null); await fetchProjects(true);
          navigate(r.next_workspace ? `/w/${r.next_workspace}` : "/app");
          toast.success(`“${workspace?.name}” will be deleted on ${format(new Date(r.deletion_at), "MMM d")}`, { action: { label: "Cancel deletion", onClick: async () => { await v2.restoreWorkspace(projectId); fetchProjects(true); toast("Deletion canceled"); } } });
        }}>Delete workspace</Button></>}>
        <Label htmlFor="mw-del">Type the workspace name to confirm</Label>
        <Input id="mw-del" className="h-11" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={workspace?.name} />
      </Sheet>
      <Sheet open={sheet === "archive"} onOpenChange={(o) => !o && setSheet(null)} title="Archive this workspace?"
        description="Syncing stops and the workspace becomes read-only. It no longer counts toward your plan. Unarchive anytime."
        footer={<><Button variant="ghost" onClick={() => setSheet(null)}>Cancel</Button><Button variant="primary" icon={Archive} onClick={async () => { await v2.archive(projectId); setSheet(null); refresh(); fetchProjects(true); navigate(`/w/${projectId}`); toast.success("Workspace archived"); }}>Archive workspace</Button></>} />
      <Sheet open={sheet === "leave"} onOpenChange={(o) => !o && setSheet(null)} title="Leave this workspace?"
        description={`You lose access to ${workspace?.name}. James Park (admin) can invite you back.`}
        footer={<><Button variant="ghost" onClick={() => setSheet(null)}>Cancel</Button><Button variant="danger" onClick={async () => { await v2.leave(projectId); setSheet(null); await fetchProjects(true); navigate("/app"); toast(`You left ${workspace?.name}`); }}>Leave workspace</Button></>} />
    </div>
  );
}

/* ───── Members — 112:5818 + Invite (151:667), Change role (151:735), Remove (151:842) ───── */
const ROLE_LABEL = { owner: "Owner", admin: "Admin", editor: "Editor", viewer: "Viewer" };
const ROLE_HELP = { admin: "Billing, members and all workspaces", editor: "Review changes, edit memory, reply", viewer: "Read only" };
function Members() {
  const { projectId, role } = useWorkspace();
  const { data, setData, reload } = useResource(() => v2.members(projectId), [projectId]);
  const [invite, setInvite] = useState(false);
  const [editing, setEditing] = useState(null);
  const [newRole, setNewRole] = useState("editor");
  const [removing, setRemoving] = useState(null);
  const owner = role === "owner";
  const members = data?.members || [];
  const active = members.filter((m) => m.status === "active").length;
  const pending = members.filter((m) => m.status === "pending").length;
  const first = (m) => (m?.name || m?.email || "").split(" ")[0];
  return (
    <div className="scroll-pane min-h-0 flex-1 py-4">
      <div className="flex items-center px-4"><p className="flex-1 text-body-s text-fg-tertiary">{active} members · {pending} pending</p><Button variant="primary" icon={Plus} disabled={!owner} onClick={() => setInvite(true)}>Invite</Button></div>
      <Stagger as="ul" className="mt-3 border-y border-line-subtle divide-y divide-line-subtle">
        {members.map((m) => (
          <StaggerItem as="li" key={m.id}>
            <button disabled={!owner || m.role === "owner"} onClick={() => { setEditing(m); setNewRole(m.role); }} className="flex min-h-[68px] w-full items-center gap-3 px-4 py-3 text-left active:bg-hover disabled:opacity-100">
              {m.name ? <Avatar name={m.name} /> : <span className="flex h-7 w-7 items-center justify-center rounded-full border border-line text-fg-tertiary">—</span>}
              <span className="min-w-0 flex-1"><span className="block truncate text-body-s text-fg">{m.name || m.email}</span><span className="block text-body-s text-fg-tertiary">{m.status === "pending" ? `Pending · ${ROLE_LABEL[m.role]}` : ROLE_LABEL[m.role]}</span></span>
              <ChevronRight size={16} className="text-fg-tertiary" />
            </button>
          </StaggerItem>
        ))}
      </Stagger>
      <InviteScreen open={invite} onOpenChange={setInvite} wid={projectId} onDone={reload} />
      <Sheet open={!!editing} onOpenChange={(o) => !o && setEditing(null)} title={`Change role for ${editing?.name || editing?.email || ""}`}
        description={`Takes effect immediately. ${first(editing)} is notified by email.`}
        footer={<>
          <Button variant="ghost" className="text-danger" onClick={async () => { const m = editing; setEditing(null); setRemoving({ m, commitments: (await v2.memberCommitments(projectId, m.id)).items }); }}>Remove from workspace</Button>
          <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
          <Button variant="primary" onClick={async () => {
            const m = editing; setEditing(null);
            if (newRole === m.role) return;
            setData((d) => ({ ...d, members: d.members.map((x) => (x.id === m.id ? { ...x, role: newRole } : x)) }));
            await v2.updateMember(projectId, m.id, { role: newRole });
            toast.success(`${first(m)} is now ${newRole === "admin" || newRole === "editor" ? "an" : "a"} ${ROLE_LABEL[newRole]}`);
          }}>Save role</Button>
        </>}>
        <div role="radiogroup" className="space-y-4">
          {["admin", "editor", "viewer"].map((r) => <Radio key={r} on={newRole === r} title={ROLE_LABEL[r]} sub={ROLE_HELP[r]} onClick={() => setNewRole(r)} />)}
        </div>
      </Sheet>
      <Sheet open={!!removing} onOpenChange={(o) => !o && setRemoving(null)} title={`Remove ${removing?.m?.name || removing?.m?.email || ""}?`}
        description={`${first(removing?.m)} loses access to this workspace now. Memories and history they created stay.${removing?.commitments?.length ? ` Their ${removing.commitments.length} open commitment moves to Maya Rao.` : ""}`}
        footer={<><Button variant="ghost" onClick={() => setRemoving(null)}>Cancel</Button><Button variant="danger" onClick={async () => { const { m, commitments } = removing; await v2.removeMember(projectId, m.id, commitments?.length ? "Maya Rao" : undefined); setRemoving(null); reload(); toast(`${m.name || m.email} removed`); }}>Remove from workspace</Button></>} />
    </div>
  );
}
function InviteScreen({ open, onOpenChange, wid, onDone }) {
  const [emails, setEmails] = useState("");
  const [role, setRole] = useState("editor");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  useEffect(() => { if (open) { setEmails(""); setRole("editor"); setErr(null); } }, [open]);
  const list = emails.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
  const send = async () => {
    setBusy(true); setErr(null);
    try { const r = await v2.invite(wid, list, role); onOpenChange(false); onDone(); toast.success(`Sent ${r.invited} invite${r.invited === 1 ? "" : "s"}`); }
    catch (e) { setErr(e?.response?.data?.detail || "Couldn’t send invites"); } finally { setBusy(false); }
  };
  return (
    <FullScreen open={open} onOpenChange={onOpenChange} title="Invite people"
      footer={<Button variant="primary" loading={busy} disabled={!list.length} onClick={send}>Send invite{list.length > 1 ? "s" : ""}</Button>}>
      <Label htmlFor="inv-m">Email addresses</Label>
      <Input id="inv-m" className="h-11" type="email" inputMode="email" value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="name@company.com" autoFocus />
      <p className="mt-2 text-body-s text-fg-tertiary">Separate several with commas.</p>
      {err && <p className="mt-2 text-body-s text-danger">{err}</p>}
      <p className="eyebrow mt-5 mb-3">Role</p>
      <div role="radiogroup" className="space-y-4">
        <Radio on={role === "editor"} title="Editor" sub="Review changes, edit memory, reply" onClick={() => setRole("editor")} />
        <Radio on={role === "viewer"} title="Viewer" sub="Read memory and timeline only — ideal for clients" onClick={() => setRole("viewer")} />
      </div>
    </FullScreen>
  );
}

/* ───── Billing — trial (112:5878) · monthly (152:479) · canceled (152:664) + Choose a plan (151:916), Change plan (151:985), Cancel (152:562) ───── */
function Billing() {
  const { billing: b, reload } = useBilling();
  const [params, setParams] = useSearchParams();
  const [choose, setChoose] = useState(false);
  const [change, setChange] = useState(false);
  const [cancel, setCancel] = useState(false);
  const [plan, setPlan] = useState("monthly");
  useEffect(() => {
    if (params.get("choose") || params.get("card") || params.get("extend")) { setChoose(true); setParams({}, { replace: true }); }
  }, [params, setParams]);
  if (!b) return null;
  const trial = b.status === "trialing" || b.status === "expired";
  const daysLeft = b.trial_ends_at ? Math.max(0, Math.ceil((new Date(b.trial_ends_at) - Date.now()) / 864e5)) : 0;
  const p = (k) => money(b.prices?.[k]?.[b.currency] ?? 0, b.currency);
  const until = b.ends_on || b.renews_on;

  if (trial) {
    return (
      <>
        <div className="scroll-pane min-h-0 flex-1 px-4 py-4">
          <div className={cn("flex items-start gap-3 rounded-lg border px-4 py-3", b.status === "expired" ? "border-warning/70 bg-warning-bg" : "border-info/70 bg-info-bg")}>
            <Info size={16} className={cn("mt-0.5 shrink-0", b.status === "expired" ? "text-warning" : "text-info")} />
            <div><p className="text-body-m text-fg">{b.status === "expired" ? "Your free trial ended" : `Free trial · ${daysLeft} days left`}</p><p className="text-body-s text-fg-secondary">{b.status === "expired" ? "Memory is read-only and sources are paused. Nothing is deleted." : `Ends ${format(new Date(b.trial_ends_at), "MMM d")}. Nothing is charged until you choose a plan.`}</p></div>
          </div>
          <p className="eyebrow mt-6 mb-3">Plans</p>
          <div role="radiogroup" className="space-y-4">
            <Radio on={plan === "monthly"} title="Monthly" sub={`Up to ${b.workspaces?.limit || 10} projects`} right={`${p("monthly")}/mo`} onClick={() => setPlan("monthly")} />
            <Radio on={plan === "project"} title="Per project" sub="One workspace, 60 days" right={p("project")} onClick={() => setPlan("project")} />
          </div>
          <p className="mt-4 text-body-s text-fg-tertiary">Payment is handled securely by our payment provider.{b.currency === "inr" ? " Prices include GST." : ""}</p>
        </div>
        <Footer><Button variant="primary" onClick={() => setChoose(true)}>Continue with {plan === "monthly" ? "Monthly" : "Per project"}</Button></Footer>
        <ChoosePlan open={choose} onOpenChange={setChoose} b={b} initial={plan} />
      </>
    );
  }

  return (
    <>
      <div className="scroll-pane min-h-0 flex-1 px-4 py-4">
        {b.status === "canceled" && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={T.base} className="mb-4 flex items-center gap-3 rounded-lg border border-line-strong px-4 py-3">
            <Info size={16} className="shrink-0 text-fg-secondary" />
            <div className="min-w-0 flex-1"><p className="text-body-m text-fg">Subscription canceled</p><p className="text-body-s text-fg-secondary">Full access until {format(new Date(until), "MMM d")}, then read-only.</p></div>
            <Button className="shrink-0" onClick={async () => { await v2.resume(); await reload(); toast.success("Subscription resumed"); }}>Resubscribe</Button>
          </motion.div>
        )}
        {b.status === "past_due" && (
          <div className="mb-4 flex items-center gap-3 rounded-lg border border-danger/70 bg-danger-bg px-4 py-3">
            <Info size={16} className="shrink-0 text-danger" />
            <div className="min-w-0 flex-1"><p className="text-body-m text-fg">Payment failed</p><p className="text-body-s text-fg-secondary">Update your card by {format(new Date(b.retry.grace_ends_at), "MMM d")} to keep syncing.</p></div>
            <Button className="shrink-0" onClick={() => setChoose(true)}>Update card</Button>
          </div>
        )}
        <div className="rounded-lg border border-line px-4 py-3">
          <div className="flex items-center gap-2"><p className="flex-1 text-body-m text-fg">{b.label} · {p(b.plan)}/{b.interval === "month" ? "month" : "project"}</p>{b.status === "canceled" ? <Badge dot>Ends {format(new Date(until), "MMM d")}</Badge> : <Badge tone="success" dot>Active</Badge>}</div>
          <p className="mt-1 text-body-s text-fg-tertiary">{b.status === "canceled" ? `Canceled ${format(new Date(b.canceled_at || Date.now()), "MMM d")} · access until ${format(new Date(until), "MMM d")}` : `${b.workspaces.used} of ${b.workspaces.limit} projects used${b.renews_on ? ` · renews ${format(new Date(b.renews_on), "MMM d")}` : ""}`}{b.pending_change ? ` · switches to ${b.pending_change.plan === "project" ? "Per project" : "Monthly"} on ${format(new Date(b.pending_change.on), "MMM d")}` : ""}</p>
        </div>
        <p className="eyebrow mt-6 mb-3">Payment method</p>
        <NavRows rows={[{ title: b.card ? `${b.card.brand} ···· ${b.card.last4}` : "No payment method", sub: b.card ? `Expires ${b.card.exp} · ${b.card.email || ""}` : "Added when you choose a plan", onClick: () => setChoose(true) }]} />
        <p className="eyebrow mt-6 mb-3">Invoices</p>
        {(b.invoices || []).length === 0 ? <p className="text-body-s text-fg-tertiary">No invoices yet.</p> : (
          <ul className="overflow-hidden rounded-lg border border-line divide-y divide-line-subtle">
            {b.invoices.map((i) => (
              <li key={i.id}>
                <button onClick={() => toast("Downloading invoice PDF…")} className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-hover">
                  <span className="min-w-0 flex-1"><span className="block text-body-m text-fg">{format(new Date(i.at), "MMM d, yyyy")}</span><span className="block text-body-s text-fg-tertiary">{i.label} · Paid</span></span>
                  <span className="font-mono text-[12px] text-fg">{money2(i.amount, i.currency)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {b.status === "active" && (
        <Footer>
          {b.plan === "monthly" && <Button variant="ghost" onClick={() => setCancel(true)}>Cancel subscription</Button>}
          <Button onClick={() => setChange(true)}>Change plan</Button>
        </Footer>
      )}
      <ChoosePlan open={choose} onOpenChange={setChoose} b={b} initial={b.plan === "project" ? "project" : "monthly"} />
      <ChangePlan open={change} onOpenChange={setChange} b={b} />
      <CancelSheet open={cancel} onOpenChange={setCancel} b={b} />
    </>
  );
}

function ChoosePlan({ open, onOpenChange, b, initial }) {
  const [plan, setPlan] = useState(initial || "monthly");
  const [card, setCard] = useState("");
  const [exp, setExp] = useState("");
  const [cvc, setCvc] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  useEffect(() => { if (open) { setPlan(initial || "monthly"); setErr(null); } }, [open, initial]);
  const amount = b.prices?.[plan]?.[b.currency] ?? 0;
  const trialing = b.status === "trialing";
  const due = trialing && plan === "monthly" ? 0 : amount;
  const updateOnly = b.status === "past_due" || (b.status === "active" && !!b.card);
  const pay = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await v2.checkout(plan, b.currency, card || "4242 4242 4242 4242", exp || "08/28");
      setBilling(r.billing); onOpenChange(false);
      toast.success(updateOnly ? "Card updated" : plan === "monthly" ? "Monthly plan active" : "Workspace active for 60 days");
    } catch (e) { setErr(e?.response?.data?.detail || "Payment didn’t go through. Nothing was charged."); } finally { setBusy(false); }
  };
  const fmtCard = (v) => v.replace(/\D/g, "").slice(0, 16).replace(/(\d{4})(?=\d)/g, "$1 ");
  return (
    <FullScreen open={open} onOpenChange={onOpenChange} title={updateOnly ? "Payment method" : "Choose a plan"}
      footer={<Button variant="primary" loading={busy} onClick={pay}>{updateOnly ? (b.status === "past_due" ? "Save card & retry" : "Save card") : due ? `Pay ${money(due, b.currency)} and continue` : `Start ${plan === "monthly" ? "Monthly" : "Per project"} · nothing due today`}</Button>}>
      {!updateOnly && (
        <div role="radiogroup" className="space-y-4">
          <Radio on={plan === "monthly"} title="Monthly" sub={`Up to ${b.workspaces?.limit || 10} active projects · billed monthly`} right={`${money(b.prices?.monthly?.[b.currency] ?? 0, b.currency)}/mo`} onClick={() => setPlan("monthly")} />
          <Radio on={plan === "project"} title="Per project" sub="Pay per project · each active 60 days" right={`${money(b.prices?.project?.[b.currency] ?? 0, b.currency)} each`} onClick={() => setPlan("project")} />
        </div>
      )}
      <p className={cn("mb-2 text-body-s text-fg-secondary", !updateOnly && "mt-5")}>Card</p>
      <div className="flex h-11 items-center gap-2 rounded-md border border-line-control bg-surface px-3 focus-within:border-fg">
        <input aria-label="Card number" inputMode="numeric" autoComplete="cc-number" value={card} onChange={(e) => setCard(fmtCard(e.target.value))} placeholder="Card number" className="min-w-0 flex-1 bg-transparent text-body-m text-fg placeholder:text-fg-tertiary outline-none" />
        <input aria-label="Expiry" autoComplete="cc-exp" value={exp} onChange={(e) => setExp(e.target.value.replace(/[^\d/]/g, "").slice(0, 5))} placeholder="MM/YY" className="w-14 bg-transparent text-body-m text-fg placeholder:text-fg-tertiary outline-none" />
        <input aria-label="CVC" autoComplete="cc-csc" inputMode="numeric" value={cvc} onChange={(e) => setCvc(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="CVC" className="w-10 bg-transparent text-body-m text-fg placeholder:text-fg-tertiary outline-none" />
      </div>
      {err && <p className="mt-2 text-body-s text-danger">{err}</p>}
      {!updateOnly && (
        <>
          <div className="mt-4 flex items-center"><span className="flex-1 text-body-m text-fg-secondary">Due today</span><span className="text-body-m text-fg">{money2(due, b.currency)}</span></div>
          <p className="mt-3 text-body-s text-fg-tertiary">
            {trialing && plan === "monthly" ? `First charge of ${money2(amount, b.currency)} on ${format(new Date(b.trial_ends_at), "MMM d")}, when your trial ends. ` : ""}
            {plan === "monthly" ? "Renews monthly · cancel anytime from Settings → Billing." : "One-time payment · this workspace stays active for 60 days."}{b.currency === "inr" ? " Includes GST." : ""}
          </p>
        </>
      )}
      <p className="mt-3 text-body-s text-fg-tertiary">Card details go straight to our payment provider. Bracket never stores them.</p>
    </FullScreen>
  );
}

function ChangePlan({ open, onOpenChange, b }) {
  const [plan, setPlan] = useState(b.plan);
  useEffect(() => { if (open) setPlan(b.plan); }, [open, b.plan]);
  const renew = b.renews_on ? format(new Date(b.renews_on), "MMM d") : "your next renewal";
  const used = b.workspaces?.used || 1;
  const perProject = b.prices?.project?.[b.currency] ?? 2;
  return (
    <FullScreen open={open} onOpenChange={onOpenChange} title="Change plan"
      footer={<Button variant="primary" onClick={async () => { const r = await v2.changePlan(plan); setBilling(r.billing); onOpenChange(false); if (plan !== b.plan) toast.success(`Switching to ${plan === "project" ? "Per project" : "Monthly"} on ${renew}`); }}>{plan === b.plan ? `Keep ${b.plan === "monthly" ? "Monthly" : "Per project"}` : `Switch to ${plan === "project" ? "Per project" : "Monthly"}`}</Button>}>
      <div role="radiogroup" className="space-y-4">
        <Radio on={plan === "monthly"} title="Monthly" sub={b.plan === "monthly" ? `Current plan · ${used} of ${b.workspaces?.limit || 10} projects used` : `Up to ${b.workspaces?.limit || 10} active projects`} right={`${money(b.prices?.monthly?.[b.currency] ?? 0, b.currency)}/mo`} onClick={() => setPlan("monthly")} />
        <Radio on={plan === "project"} title="Per project" sub={`${used} active project${used === 1 ? "" : "s"} × ${money(perProject, b.currency)} · 60 days each`} right={money(used * perProject, b.currency)} onClick={() => setPlan("project")} />
      </div>
      {plan !== b.plan && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={T.base} className="mt-4 flex items-start gap-3 rounded-lg border border-info/70 bg-info-bg px-4 py-3">
          <Info size={16} className="mt-0.5 shrink-0 text-info" />
          <div><p className="text-body-m text-fg">Takes effect {renew}</p><p className="text-body-s text-fg-secondary">You keep {b.plan === "monthly" ? "Monthly" : "Per project"} until your current period ends. No refund is issued for the switch.</p></div>
        </motion.div>
      )}
    </FullScreen>
  );
}

function CancelSheet({ open, onOpenChange, b }) {
  const [reason, setReason] = useState("Too expensive");
  const until = b.renews_on ? format(new Date(b.renews_on), "MMM d") : "the end of this period";
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Cancel subscription?"
      description={`You keep full access until ${until}. After that, workspaces become read-only — nothing is deleted.`}
      footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Keep my plan</Button><Button variant="danger" onClick={async () => { const r = await v2.cancel(reason); setBilling(r.billing); onOpenChange(false); }}>Cancel subscription</Button></>}>
      <div role="radiogroup" className="space-y-4">
        {["Too expensive", "Not using it enough", "Missing a feature"].map((r) => <Radio key={r} on={reason === r} title={r} onClick={() => setReason(r)} />)}
      </div>
    </Sheet>
  );
}

/* ───── Privacy & data — 151:593 + Delete account (153:243) ───── */
function Privacy() {
  const { projectId } = useWorkspace();
  const { projects } = useProjects();
  const navigate = useNavigate();
  const [del, setDel] = useState(false);
  const [typed, setTyped] = useState("");
  const owned = (projects || []).filter((p) => p.role === "owner" && p.status !== "deletion_scheduled");
  return (
    <>
      <div className="scroll-pane min-h-0 flex-1 px-4 py-4">
        <NavRows rows={[
          { title: "What Bracket reads", sub: "Only the threads, channels and files you choose", onClick: () => navigate(`/w/${projectId}/sources`) },
          { title: "AI training", sub: "Never used to train general AI models", trailing: <Badge>Off</Badge>, onClick: () => toast("Your data is never used to train general AI models", { description: "This can’t be turned on." }) },
          { title: "Retention", sub: "Recoverable for 30 days after deletion, then permanently deleted", onClick: () => window.open("/privacy", "_blank", "noopener") },
          { title: "Export my data", sub: "Emailed as a download link", onClick: async () => { const r = await v2.exportAccount(); toast.success("Export requested", { description: `We’ll email ${r.email} within 24 hours.` }); } },
        ]} />
      </div>
      <Footer><Button variant="danger" icon={Trash2} onClick={() => { setTyped(""); setDel(true); }}>Delete account</Button></Footer>
      <Sheet open={del} onOpenChange={setDel} title="Delete your account?"
        description={`Your account and the ${owned.length} workspace${owned.length === 1 ? "" : "s"} you own are recoverable for 30 days, then permanently deleted. Shared workspaces stay with their other admins.`}
        footer={<><Button variant="ghost" onClick={() => setDel(false)}>Cancel</Button><Button variant="danger" disabled={typed !== "DELETE"} onClick={async () => { await v2.deleteAccount(typed); setDel(false); navigate("/login"); toast("Your account will be deleted in 30 days", { description: "Sign in before then to cancel." }); }}>Delete account</Button></>}>
        <Label htmlFor="m-del-acc">Type DELETE to confirm</Label>
        <Input id="m-del-acc" className="h-11" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="DELETE" />
      </Sheet>
    </>
  );
}

