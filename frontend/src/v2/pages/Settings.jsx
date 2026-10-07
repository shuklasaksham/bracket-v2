import React, { useEffect, useState } from "react";
import { NavLink, Navigate, useNavigate, useParams, Link } from "react-router-dom";
import {
  ArrowLeft, User, KeyRound, CreditCard, LayoutGrid, Bell, MoreHorizontal, Archive, ArchiveRestore, Trash2, Pencil, LogOut, ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError, longDate, PLAN_LABEL } from "../lib/data";
import { useProjects, fetchProjects } from "../lib/workspace";
import { useAuth } from "../../lib/AuthContext";
import { enablePushNotifications } from "../../lib/push";
import { Avatar, Badge, Banner, Button, Card, EmptyState, Field, IconButton, Input, Skeleton, Toggle } from "../ui/primitives";
import { Dialog, Menu, MenuTrigger, MenuContent, MenuItem, MenuSeparator } from "../ui/overlays";
import { Logo } from "../shell/Logo";
import { Seo } from "../shell/Seo";
import { cn } from "../../lib/utils";

const SECTIONS = [
  { key: "profile", label: "Profile", icon: User },
  { key: "security", label: "Sign-in & security", icon: KeyRound },
  { key: "billing", label: "Billing", icon: CreditCard },
  { key: "workspaces", label: "Workspaces", icon: LayoutGrid },
  { key: "notifications", label: "Notifications", icon: Bell },
];

export default function Settings() {
  const { section = "profile" } = useParams();
  const navigate = useNavigate();
  if (!SECTIONS.find((s) => s.key === section)) return <Navigate to="/settings" replace />;
  const Body = { profile: Profile, security: Security, billing: Billing, workspaces: Workspaces, notifications: Notifications }[section];
  return (
    <div className="bk flex min-h-[100dvh] flex-col bg-app md:flex-row">
      <Seo title="Settings" />
      <aside className="border-b border-line-subtle bg-sidebar md:w-[240px] md:shrink-0 md:border-b-0 md:border-r">
        <div className="flex h-14 items-center px-4"><Logo to="/app" /></div>
        <div className="px-2 pb-3">
          <button onClick={() => navigate("/app")} className="mb-2 flex h-8 w-full items-center gap-2 rounded-md px-2 text-body-m text-fg-tertiary hover:bg-hover hover:text-fg"><ArrowLeft size={14} /> Back to Bracket</button>
          <p className="eyebrow px-2 pb-1.5 pt-2 hidden md:block">Settings</p>
          <nav className="flex gap-1 overflow-x-auto md:block md:space-y-0.5" aria-label="Settings">
            {SECTIONS.map((s) => (
              <NavLink key={s.key} to={`/settings/${s.key === "profile" ? "" : s.key}`} end
                className={({ isActive }) => cn("flex h-8 shrink-0 items-center gap-2.5 rounded-md px-2 text-body-m whitespace-nowrap", (isActive || (s.key === "profile" && section === "profile")) ? "bg-selected text-fg" : "text-fg-secondary hover:bg-hover hover:text-fg")}>
                <s.icon size={15} strokeWidth={1.75} /> {s.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </aside>
      <main className="flex-1 min-w-0 scroll-pane">
        <div className="mx-auto max-w-[760px] px-4 py-6 md:px-10 md:py-10"><Body /></div>
      </main>
    </div>
  );
}

function Header({ title, desc }) {
  return (
    <div className="mb-6">
      <h1 className="text-title-l">{title}</h1>
      {desc && <p className="mt-1 text-body-m text-fg-tertiary">{desc}</p>}
    </div>
  );
}

/* ───────── Profile — PATCH /auth/me ───────── */
function Profile() {
  const { user, setUser, logout } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState(user?.name || "");
  const [designation, setDesignation] = useState(user?.designation || "");
  const [busy, setBusy] = useState(false);
  const dirty = name !== (user?.name || "") || designation !== (user?.designation || "");
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { data } = await api.patch("/auth/me", { name: name.trim(), designation: designation.trim(), avatar: user?.avatar || "mono-1" });
      setUser(data);
      toast.success("Profile saved");
    } catch (err) { toast.error(formatApiError(err)); } finally { setBusy(false); }
  };
  return (
    <>
      <Header title="Profile" desc="How you appear in drafts, decisions and the timeline." />
      <form onSubmit={save}>
        <Card className="p-5">
          <div className="flex items-center gap-4">
            <Avatar name={user?.name} email={user?.email} src={user?.picture} size="l" />
            <div className="min-w-0">
              <p className="text-title-m truncate">{user?.name || "Your name"}</p>
              <p className="text-body-s text-fg-tertiary truncate">{user?.email}</p>
            </div>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="s-name"><Input id="s-name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Role" htmlFor="s-role"><Input id="s-role" value={designation} onChange={(e) => setDesignation(e.target.value)} placeholder="e.g. Design lead" /></Field>
            <Field label="Email" htmlFor="s-email" helper="Your sign-in email can’t be changed here." className="sm:col-span-2"><Input id="s-email" value={user?.email || ""} disabled /></Field>
          </div>
          <div className="mt-5 flex justify-end"><Button type="submit" variant="primary" loading={busy} disabled={!dirty || !name.trim()}>Save changes</Button></div>
        </Card>
      </form>
      <Card className="mt-6 flex items-center justify-between gap-3 p-5">
        <div><p className="text-title-s">Sign out</p><p className="text-body-s text-fg-tertiary">Sign out of Bracket on this device.</p></div>
        <Button variant="secondary" icon={LogOut} onClick={async () => { await logout(); navigate("/login"); }}>Sign out</Button>
      </Card>
    </>
  );
}

/* ───────── Security — POST /auth/password/set ───────── */
function Security() {
  const { user, refresh } = useAuth();
  const [pwd, setPwd] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [busy, setBusy] = useState(false);
  const mismatch = pwd2 && pwd !== pwd2;
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/auth/password/set", { password: pwd });
      await refresh();
      setPwd(""); setPwd2("");
      toast.success(user?.has_password ? "Password updated" : "Password set — you can now sign in with it");
    } catch (err) { toast.error(formatApiError(err)); } finally { setBusy(false); }
  };
  return (
    <>
      <Header title="Sign-in & security" desc="You can always sign in with Google or a one-time email code." />
      <form onSubmit={save}>
        <Card className="p-5">
          <p className="text-title-s">{user?.has_password ? "Change password" : "Set a password"}</p>
          <p className="mt-0.5 text-body-s text-fg-tertiary">At least 8 characters.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="New password" htmlFor="p1"><Input id="p1" type="password" autoComplete="new-password" value={pwd} onChange={(e) => setPwd(e.target.value)} invalid={pwd && pwd.length < 8} /></Field>
            <Field label="Confirm password" htmlFor="p2" error={mismatch ? "Passwords don’t match" : ""}><Input id="p2" type="password" autoComplete="new-password" value={pwd2} onChange={(e) => setPwd2(e.target.value)} invalid={mismatch} /></Field>
          </div>
          <div className="mt-5 flex justify-end"><Button type="submit" variant="primary" loading={busy} disabled={pwd.length < 8 || pwd !== pwd2}>{user?.has_password ? "Update password" : "Set password"}</Button></div>
        </Card>
      </form>
      <Card className="mt-6 p-5">
        <p className="text-title-s">Your data</p>
        <p className="mt-1 text-body-s text-fg-tertiary">Your business data is never used to train general AI models — ours or our providers’. Deleted data is recoverable for 30 days, then removed from active systems.</p>
        <Link to="/privacy" className="mt-3 inline-flex items-center gap-1 text-body-s text-fg-secondary hover:text-fg">Privacy policy <ExternalLink size={12} /></Link>
      </Card>
    </>
  );
}

/* ───────── Billing — GET /payments/billing, POST /payments/cancel ───────── */
function Billing() {
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [b, setB] = useState(null);
  const [quota, setQuota] = useState(null);
  const [cancel, setCancel] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = () => Promise.all([api.get("/payments/billing"), api.get("/project-quota")]).then(([x, y]) => { setB(x.data); setQuota(y.data); }).catch(() => setB({}));
  useEffect(() => { load(); }, []);
  const doCancel = async () => {
    setBusy(true);
    try {
      await api.post("/payments/cancel");
      await refresh();
      toast.success("Subscription cancelled");
      setCancel(false);
      load();
    } catch (e) { toast.error(formatApiError(e)); } finally { setBusy(false); }
  };
  if (!b) return <><Header title="Billing" /><Skeleton className="h-40" /></>;
  const money = (v, c) => (v == null ? "" : c === "inr" ? `₹${Number(v).toLocaleString("en-IN")}` : `$${Number(v).toFixed(2)}`);
  return (
    <>
      <Header title="Billing" desc="Your plan, usage and renewal." />
      {quota?.plan_expired && <Banner tone="warning" className="mb-4" title="Your plan has ended" action={<Button size="s" variant="primary" onClick={() => navigate("/plan")}>Choose a plan</Button>}>Workspaces are read-only until you renew. Nothing is deleted.</Banner>}
      <Card className="p-5">
        {b.plan ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-title-m">{PLAN_LABEL[b.plan] || b.label || b.plan}</p>
              <Badge tone="success" dot>Active</Badge>
            </div>
            <p className="mt-1 text-body-m text-fg-tertiary">
              {b.amount != null && <>{money(b.amount, b.currency)}{b.recurring ? " / month" : " one-time"} · </>}
              Since {longDate(b.since)}{b.renews_on ? ` · ${b.recurring ? "Renews" : "Active until"} ${longDate(b.renews_on)}` : ""}
            </p>
            {quota && quota.limit != null && (
              <div className="mt-5">
                <div className="flex justify-between text-body-s text-fg-tertiary"><span>Active workspaces</span><span className="num">{quota.used} of {quota.limit}</span></div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-hover"><div className="h-full rounded-full bg-fg-secondary" style={{ width: `${Math.min(100, (quota.used / quota.limit) * 100)}%` }} /></div>
                <p className="mt-1.5 text-body-s text-fg-tertiary">{quota.archived} archived (don’t count toward your plan)</p>
              </div>
            )}
            <div className="mt-6 flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => navigate("/plan")}>Change plan</Button>
              {b.recurring && <Button variant="ghost" onClick={() => setCancel(true)}>Cancel subscription</Button>}
            </div>
          </>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><p className="text-title-m">No active plan</p><p className="text-body-s text-fg-tertiary">Choose a plan to keep syncing and create workspaces.</p></div>
            <Button variant="primary" onClick={() => navigate("/plan")}>Choose a plan</Button>
          </div>
        )}
      </Card>
      <p className="mt-4 text-body-s text-fg-tertiary">Receipts are emailed after every payment. Prices in ₹ include GST. Questions? <a className="underline hover:text-fg" href="mailto:support@use-bracket.com">support@use-bracket.com</a></p>
      <Dialog open={cancel} onOpenChange={setCancel} size="s" title="Cancel subscription?"
        description="Bracket stops syncing your sources. Your memory, history and drafts stay readable — nothing is deleted."
        footer={<><Button variant="ghost" onClick={() => setCancel(false)}>Keep my plan</Button><Button variant="danger" loading={busy} onClick={doCancel}>Cancel subscription</Button></>}>
        <p className="text-body-s text-fg-tertiary">You can resubscribe any time from this page.</p>
      </Dialog>
    </>
  );
}

/* ───────── Workspaces — rename / archive / unarchive / delete ───────── */
function Workspaces() {
  const { projects, reload } = useProjects();
  const navigate = useNavigate();
  const [rename, setRename] = useState(null);
  const [del, setDel] = useState(null);
  const [name, setName] = useState("");
  const [confirmName, setConfirmName] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (fn, ok) => {
    setBusy(true);
    try { await fn(); await reload(); toast.success(ok); } catch (e) { toast.error(formatApiError(e)); } finally { setBusy(false); }
  };
  const active = (projects || []).filter((p) => !p.archived);
  const archived = (projects || []).filter((p) => p.archived);
  const Row = ({ p }) => (
    <div className="flex items-center gap-3 border-b border-line-subtle px-4 py-3 last:border-0">
      <button onClick={() => !p.archived && navigate(`/w/${p.id}`)} className="min-w-0 flex-1 text-left">
        <p className="truncate text-body-m text-fg">{p.name || "Untitled"} {p.is_demo && <Badge className="ml-1">Demo</Badge>}</p>
        <p className="text-body-s text-fg-tertiary">{p.archived ? `Archived ${longDate(p.archived_at)}` : `Updated ${longDate(p.updated_at)}`}</p>
      </button>
      <Menu>
        <MenuTrigger asChild><IconButton icon={MoreHorizontal} label={`Actions for ${p.name}`} /></MenuTrigger>
        <MenuContent>
          <MenuItem icon={Pencil} onSelect={() => { setRename(p); setName(p.name || ""); }}>Rename</MenuItem>
          {p.archived
            ? <MenuItem icon={ArchiveRestore} onSelect={() => run(() => api.post(`/projects/${p.id}/unarchive`), "Workspace restored — syncing resumes")}>Unarchive</MenuItem>
            : <MenuItem icon={Archive} onSelect={() => run(() => api.post(`/projects/${p.id}/archive`), "Archived — no longer counts toward your plan")}>Archive</MenuItem>}
          <MenuSeparator />
          <MenuItem icon={Trash2} danger onSelect={() => { setDel(p); setConfirmName(""); }}>Delete…</MenuItem>
        </MenuContent>
      </Menu>
    </div>
  );
  return (
    <>
      <Header title="Workspaces" desc="Archive finished work to free up your plan. Archived workspaces stop syncing and stay readable." />
      {!projects ? <Skeleton className="h-40" /> : (
        <>
          <p className="eyebrow mb-2">Active · {active.length}</p>
          {active.length ? <Card className="overflow-hidden">{active.map((p) => <Row key={p.id} p={p} />)}</Card>
            : <Card><EmptyState title="No active workspaces" action={<Button variant="primary" onClick={() => navigate("/connect?new=1")}>New workspace</Button>} /></Card>}
          {archived.length > 0 && (<><p className="eyebrow mb-2 mt-8">Archived · {archived.length}</p><Card className="overflow-hidden">{archived.map((p) => <Row key={p.id} p={p} />)}</Card></>)}
        </>
      )}
      <Dialog open={!!rename} onOpenChange={(o) => !o && setRename(null)} size="s" title="Rename workspace"
        footer={<><Button variant="ghost" onClick={() => setRename(null)}>Cancel</Button><Button variant="primary" loading={busy} disabled={!name.trim()} onClick={() => run(() => api.patch(`/projects/${rename.id}`, { name: name.trim() }), "Renamed").then(() => setRename(null))}>Save</Button></>}>
        <Field label="Name" htmlFor="rn"><Input id="rn" autoFocus value={name} maxLength={120} onChange={(e) => setName(e.target.value)} /></Field>
      </Dialog>
      <Dialog open={!!del} onOpenChange={(o) => !o && setDel(null)} size="s" title={`Delete ${del?.name || "workspace"}?`}
        description="Its memory, timeline and connected sources are deleted. Deleted data is recoverable for 30 days, then permanently removed."
        footer={<><Button variant="ghost" onClick={() => setDel(null)}>Cancel</Button><Button variant="danger" loading={busy} disabled={confirmName.trim() !== (del?.name || "").trim()} onClick={() => run(() => api.post("/projects/bulk-delete", { ids: [del.id] }), "Workspace deleted").then(async () => { setDel(null); await fetchProjects(true); })}>Delete workspace</Button></>}>
        <Field label="Type the workspace name to confirm" htmlFor="dn"><Input id="dn" value={confirmName} onChange={(e) => setConfirmName(e.target.value)} placeholder={del?.name} /></Field>
      </Dialog>
    </>
  );
}

/* ───────── Notifications — web push ───────── */
function Notifications() {
  const supported = typeof window !== "undefined" && "Notification" in window && "serviceWorker" in navigator;
  const [perm, setPerm] = useState(supported ? Notification.permission : "unsupported");
  const enable = async () => { await enablePushNotifications(); setPerm(Notification.permission); if (Notification.permission === "granted") toast.success("Notifications on for this device"); };
  return (
    <>
      <Header title="Notifications" desc="Bracket only interrupts you for things that change your work." />
      <Card className="overflow-hidden">
        <div className="flex items-center gap-4 border-b border-line-subtle px-5 py-4">
          <div className="flex-1"><p className="text-title-s">Push on this device</p><p className="text-body-s text-fg-tertiary">Scope changes, conflicts and things waiting on you.</p></div>
          {perm === "granted" ? <Badge tone="success" dot>On</Badge> : perm === "denied" ? <Badge tone="warning">Blocked in browser</Badge> : perm === "unsupported" ? <Badge>Not supported</Badge> : <Button size="s" variant="primary" onClick={enable}>Turn on</Button>}
        </div>
        <div className="flex items-center gap-4 px-5 py-4">
          <div className="flex-1"><p className="text-title-s">In-app updates</p><p className="text-body-s text-fg-tertiary">The bell in the top bar. Always on.</p></div>
          <Toggle checked disabled label="In-app updates" />
        </div>
      </Card>
      {perm === "denied" && <p className="mt-3 text-body-s text-fg-tertiary">Notifications are blocked for this site. Allow them in your browser’s site settings, then come back.</p>}
    </>
  );
}
