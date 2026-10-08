import React, { useEffect, useState } from "react";
import { Link, NavLink, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Plus, ChevronDown, Upload, Check, X, Lock, Info, AlertTriangle, Send, Link2, MoreHorizontal, FileText, Download, Clock,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { useAuth } from "../../../lib/AuthContext";
import { useWorkspace, fetchProjects, useProjects } from "../../lib/workspace";
import { useBilling, setBilling } from "../../lib/account";
import { v2 } from "../../lib/api2";
import { useResource } from "../../lib/data";
import { useIsMobile } from "../../lib/useMedia";
import { Avatar, Badge, Button, IconButton, Input, SourceMark, Toggle } from "../../ui/primitives";
import { Dialog, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "../../ui/overlays";
import { AnimatePresence, Stagger, StaggerItem, motion, t as T } from "../../ui/motion";
import { MobileSubHeader } from "../../shell/AppShell";
import { SourceStatus } from "../../features/sources";
import { cn } from "../../../lib/utils";

/* Settings — Figma › ✓ Settings · Profile / Notifications / Workspace / Members /
   Billing / Privacy & data and every dialog: Choose a plan (checkout), Billing
   (Monthly active), Change plan, Cancel subscription, Subscription canceled,
   Invite people, Change role, Member actions, Remove member, Workspace archive /
   delete / leave, export started, Privacy export requested, Delete account,
   Profile · other sessions signed out; plus the Mobile 390 frames. */
const SECTIONS = [["profile", "Profile"], ["notifications", "Notifications"], ["workspace", "Workspace"], ["members", "Members"], ["billing", "Billing"], ["sources", "Sources"], ["privacy", "Privacy & data"]];
const ROLES = { owner: ["Owner", "Billing, members, delete workspace"], editor: ["Editor", "Accept changes, edit memory, send replies"], viewer: ["Viewer", "Read and ask questions only"] };
const money = (amount, cur) => (cur === "inr" ? `₹${Number(amount).toLocaleString("en-IN")}` : `$${Number(amount).toFixed(amount % 1 ? 2 : 0)}`);
const money2 = (amount, cur) => (cur === "inr" ? `₹${Number(amount).toLocaleString("en-IN")}.00` : `$${Number(amount).toFixed(2)}`);

export default function Settings() {
  const { section = "profile" } = useParams();
  const { projectId } = useWorkspace();
  const mobile = useIsMobile();
  const navigate = useNavigate();
  const base = `/w/${projectId}/settings`;
  const Body = { profile: Profile, notifications: Notifications, workspace: WorkspaceSection, members: Members, billing: Billing, sources: SourcesSection, privacy: Privacy }[section] || Profile;
  const title = (SECTIONS.find(([k]) => k === section) || SECTIONS[0])[1];
  const content = (
    <motion.div key={section} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={T.base} className="max-w-[720px]">
      {!mobile && <h1 className="mb-6 text-title-l text-fg">{title}</h1>}
      <Body />
    </motion.div>
  );
  if (mobile) {
    return (
      <div className="flex h-full flex-col">
        <MobileSubHeader title={title} onBack={() => navigate(`/w/${projectId}`)} />
        <div className="flex gap-2 overflow-x-auto border-b border-line-subtle px-4 py-2 [scrollbar-width:none]">
          {SECTIONS.map(([k, l]) => (
            <NavLink key={k} to={`${base}/${k}`} className={({ isActive }) => cn("h-8 shrink-0 rounded-md px-3 text-[12px] font-medium leading-8", isActive || (k === "profile" && section === "profile") ? "bg-selected text-fg" : "text-fg-secondary")}>{l}</NavLink>
          ))}
        </div>
        <div className="scroll-pane flex-1 px-4 py-4 pb-10">{content}</div>
      </div>
    );
  }
  return (
    <div className="flex h-full">
      <nav aria-label="Settings" className="hidden w-[232px] shrink-0 border-r border-line-subtle px-4 py-6 lg:block">
        <div className="space-y-0.5">
          {SECTIONS.map(([k, l]) => (
            <NavLink key={k} to={`${base}/${k}`} className={({ isActive }) => cn("relative flex h-[30px] items-center rounded-md px-2 text-[12px] transition-colors duration-fast", isActive || (k === "profile" && !section) ? "font-medium text-fg" : "text-fg-secondary hover:bg-hover hover:text-fg")}>
              {({ isActive }) => <>{(isActive) && <motion.span layoutId="settings-nav" className="absolute inset-0 rounded-md bg-selected" transition={T.base} />}<span className="relative">{l}</span></>}
            </NavLink>
          ))}
        </div>
      </nav>
      <div className="scroll-pane min-w-0 flex-1 px-4 py-6 md:px-8">{content}</div>
    </div>
  );
}

const Card = ({ className, children, danger }) => <section className={cn("rounded-lg border p-4", danger ? "border-danger/70" : "border-line", className)}>{children}</section>;
const FieldRow = ({ label, help, children, id }) => (
  <div className="mt-4 first:mt-0">
    <label htmlFor={id} className="mb-2 block text-[12px] font-medium text-fg-secondary">{label}</label>
    {children}
    {help && <p className="mt-2 text-[12px] text-fg-tertiary">{help}</p>}
  </div>
);
const Line = ({ title, help, action, className }) => (
  <div className={cn("flex items-center gap-4", className)}>
    <div className="min-w-0 flex-1"><p className="text-[12px] text-fg">{title}</p>{help && <p className="text-[12px] text-fg-tertiary">{help}</p>}</div>
    {action}
  </div>
);

/* ───────────────────────── Profile ───────────────────────── */
function Profile() {
  const { user, setUser, logout } = useAuth();
  const navigate = useNavigate();
  const sessions = useResource(() => v2.sessions(), []);
  const [name, setName] = useState(user?.name || "");
  const [email, setEmail] = useState(user?.email || "");
  const [tz, setTz] = useState(user?.timezone || "Asia/Kolkata (GMT+5:30)");
  const [pw, setPw] = useState(false);
  const dirty = name !== (user?.name || "") || tz !== (user?.timezone || "Asia/Kolkata (GMT+5:30)");
  const save = async () => {
    const u = await v2Me({ name, timezone: tz });
    setUser?.(u);
    toast.success("Profile saved");
  };
  const others = (sessions.data?.sessions || []).filter((s) => !s.current);
  const current = (sessions.data?.sessions || []).find((s) => s.current);
  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center gap-3">
          <Avatar name={user?.name} email={user?.email} src={user?.picture} size="l" />
          <div className="min-w-0 flex-1"><p className="text-body-m text-fg">{user?.name}</p><p className="text-[12px] text-fg-tertiary">{[user?.designation || "Design lead", user?.company || "Northlight Studio"].join(" · ")}</p></div>
          <Button size="s" onClick={() => toast("Choose a square image, at least 128px")}>Change photo</Button>
        </div>
        <div className="mt-4">
          <FieldRow label="Full name" id="pf-name"><Input id="pf-name" value={name} onChange={(e) => setName(e.target.value)} /></FieldRow>
          <FieldRow label="Email" id="pf-email" help="Used to sign in. Changing it requires verification."><Input id="pf-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} onBlur={() => email !== user?.email && toast("We sent a verification code to " + email)} /></FieldRow>
          <FieldRow label="Time zone" id="pf-tz" help="Used for due dates and digests."><Input id="pf-tz" value={tz} onChange={(e) => setTz(e.target.value)} /></FieldRow>
        </div>
        <AnimatePresence>{dirty && <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden"><div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={() => { setName(user?.name || ""); setTz(user?.timezone || "Asia/Kolkata (GMT+5:30)"); }}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></div></motion.div>}</AnimatePresence>
      </Card>
      <Card>
        <p className="text-body-m font-medium text-fg">Security</p>
        <Line className="mt-3" title="Password" help={user?.password_changed_at ? `Last changed ${format(new Date(user.password_changed_at), "MMM d")}` : user?.has_password ? "Set" : "Not set — you sign in with Google or a code"}
          action={<Button size="s" onClick={() => setPw(true)}>{user?.has_password ? "Change password" : "Set password"}</Button>} />
        <Line className="mt-3" title="Active sessions" help={current ? `${current.device}${others.length ? ` — and ${others.map((o) => `1 ${o.device}`).join(", ")}` : " — only this device"}` : "…"}
          action={others.length > 0 && <Button size="s" variant="ghost" onClick={async () => { const r = await v2.signOutOthers(); sessions.reload(); toast.success(`Signed out of ${r.signed_out} other session${r.signed_out === 1 ? "" : "s"} (${r.devices.join(", ")})`); }}>Sign out other sessions</Button>} />
      </Card>
      <div className="flex justify-end"><Button onClick={async () => { await logout(); navigate("/login"); }}>Sign out</Button></div>
      <PasswordDialog open={pw} onOpenChange={setPw} />
    </div>
  );
}
const v2Me = async (body) => { const { api } = await import("../../../lib/api"); return (await api.patch("/auth/me", body)).data; };

function PasswordDialog({ open, onOpenChange }) {
  const [a, setA] = useState(""); const [b, setB] = useState(""); const [err, setErr] = useState(null);
  useEffect(() => { if (open) { setA(""); setB(""); setErr(null); } }, [open]);
  const save = async () => {
    if (a.length < 8) return setErr("Use at least 8 characters.");
    if (a !== b) return setErr("Passwords don’t match.");
    const { api } = await import("../../../lib/api");
    await api.post("/auth/password/set", { password: a });
    onOpenChange(false); toast.success("Password updated");
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Change password" size="s" footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" onClick={save}>Save password</Button></>}>
      <FieldRow label="New password" id="np"><Input id="np" type="password" value={a} onChange={(e) => setA(e.target.value)} autoFocus /></FieldRow>
      <FieldRow label="Confirm password" id="np2"><Input id="np2" type="password" value={b} onChange={(e) => setB(e.target.value)} invalid={!!err} /></FieldRow>
      {err && <p className="mt-2 text-[12px] text-danger">{err}</p>}
    </Dialog>
  );
}

/* ───────────────────────── Notifications ───────────────────────── */
function Notifications() {
  const { data, setData } = useResource(() => v2.notificationPrefs(), []);
  const mobile = useIsMobile();
  const set = async (event, channel, value) => {
    setData((d) => ({ ...d, events: d.events.map((e) => (e.key === event ? { ...e, [channel]: value } : e)) }));
    await v2.updateNotificationPrefs({ event, channel, value });
  };
  const cols = [["in_app", "In app"], ["email", "Email"], ["push", "Mobile push"]];
  return (
    <div className="space-y-4">
      <p className="text-[12px] text-fg-tertiary">Bracket is quiet by default: only things that need a decision interrupt you.</p>
      <div className="overflow-hidden rounded-lg border border-line">
        {!mobile && <div className="grid grid-cols-[minmax(0,1fr)_100px_100px_100px] items-center gap-2 border-b border-line-subtle px-4 py-3 eyebrow"><span>Event</span>{cols.map(([, l]) => <span key={l}>{l}</span>)}</div>}
        {(data?.events || []).map((e) => (
          <div key={e.key} className={cn("border-b border-line-subtle px-4 py-3 last:border-0", mobile ? "space-y-3" : "grid grid-cols-[minmax(0,1fr)_100px_100px_100px] items-center gap-2")}>
            <div><p className="text-[12px] text-fg">{e.label}</p><p className="text-[12px] text-fg-tertiary">{e.help}</p></div>
            {cols.map(([k, l]) => (
              <div key={k} className={cn(mobile && "flex items-center justify-between")}>
                {mobile && <span className="text-[12px] text-fg-secondary">{l}</span>}
                <Toggle checked={!!e[k]} label={`${e.label} — ${l}`} onChange={(v) => set(e.key, k, v)} />
              </div>
            ))}
          </div>
        ))}
      </div>
      {data && (
        <Card>
          <Line title="Daily digest" help={`Everything else, once a day at ${data.digest.time} · ${data.digest.days}`}
            action={<Toggle checked={data.digest.enabled} label="Daily digest" onChange={async (v) => { setData((d) => ({ ...d, digest: { ...d.digest, enabled: v } })); await v2.updateNotificationPrefs({ digest: { enabled: v } }); }} />} />
        </Card>
      )}
    </div>
  );
}

/* ───────────────────────── Workspace ───────────────────────── */
function WorkspaceSection() {
  const { projectId, workspace, refresh, role } = useWorkspace();
  const settings = useResource(() => v2.workspaceSettings(projectId), [projectId]);
  const navigate = useNavigate();
  const [name, setName] = useState(workspace?.name || "");
  const [client, setClient] = useState(workspace?.client_name || "");
  const [dialog, setDialog] = useState(null);
  const [typed, setTyped] = useState("");
  useEffect(() => { setName(workspace?.name || ""); setClient(workspace?.client_name || ""); }, [workspace?.name, workspace?.client_name]);
  const saveField = async (body) => { await v2.updateWorkspace(projectId, body); refresh(); fetchProjects(true); toast.success("Saved"); };
  const setS = async (k, v) => { settings.setData((d) => ({ ...d, [k]: v })); await v2.updateWorkspaceSettings(projectId, { [k]: v }); };
  const owner = role === "owner";
  return (
    <div className="space-y-4">
      <p className="-mt-3 text-[12px] text-fg-tertiary">Settings for {workspace?.name}. Each workspace has its own sources, people and memory.</p>
      <Card>
        <FieldRow label="Workspace name" id="ws-name"><Input id="ws-name" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name !== workspace?.name && saveField({ name })} disabled={!owner} /></FieldRow>
        <FieldRow label="Business or client" id="ws-client"><Input id="ws-client" value={client} onChange={(e) => setClient(e.target.value)} onBlur={() => client !== workspace?.client_name && saveField({ client_name: client })} disabled={!owner} /></FieldRow>
        <FieldRow label="What’s the work?" id="ws-work" help="Bracket uses this to decide what matters first.">
          <Input id="ws-work" value={settings.data?.work || ""} onChange={(e) => settings.setData((d) => ({ ...d, work: e.target.value }))} onBlur={(e) => v2.updateWorkspaceSettings(projectId, { work: e.target.value })} disabled={!owner} />
        </FieldRow>
      </Card>
      <Card>
        <p className="text-body-m font-medium text-fg">Memory</p>
        <Line className="mt-3" title="Auto-add high-confidence new memories" help="Additions that don’t change existing memory skip review." action={<Toggle checked={!!settings.data?.auto_add_high} label="Auto-add high-confidence new memories" onChange={(v) => setS("auto_add_high", v)} disabled={!owner} />} />
        <Line className="mt-3" title="Always review changes to scope, dates and money" help="Recommended. Applies even at high confidence." action={<Toggle checked={!!settings.data?.always_review_sensitive} label="Always review changes to scope, dates and money" onChange={(v) => setS("always_review_sensitive", v)} disabled={!owner} />} />
        <Line className="mt-3" title="Export memory & history" help="JSON + CSV with sources and versions" action={<Button size="s" icon={Upload} onClick={async () => { const r = await v2.exportWorkspace(projectId, "json"); toast.success("Export started", { description: `We’ll email ${r.email} a download link when it’s ready.` }); }}>Export</Button>} />
      </Card>
      <Card danger>
        <p className="text-body-m font-medium text-danger">Danger zone</p>
        <Line className="mt-3" title="Archive workspace" help="Stops syncing and makes memory read-only. You can restore it any time." action={<Button size="s" onClick={() => setDialog("archive")} disabled={!owner || workspace?.status === "archived"}>Archive</Button>} />
        <Line className="mt-3" title="Delete workspace" help="Permanently deletes memory, history and drafts after 7 days. Sources aren’t affected." action={<Button size="s" variant="danger" onClick={() => { setTyped(""); setDialog("delete"); }} disabled={!owner}>Delete workspace</Button>} />
        <Line className="mt-3" title="Leave workspace" help="Remove yourself. Owners must transfer ownership first." action={<Button size="s" onClick={() => (owner ? toast("Transfer ownership first", { description: "Make another member an Owner in Members, then leave." }) : setDialog("leave"))}>Leave</Button>} />
      </Card>

      <Dialog open={dialog === "archive"} onOpenChange={(o) => !o && setDialog(null)} title="Archive this workspace?" size="s"
        description="Bracket stops reading Gmail, Slack and Notes for this workspace. Memory, history and drafts stay read-only and searchable. You can restore it any time."
        footer={<><Button variant="ghost" onClick={() => setDialog(null)}>Cancel</Button><Button variant="primary" onClick={async () => { await v2.archive(projectId); setDialog(null); refresh(); fetchProjects(true); navigate(`/w/${projectId}`); }}>Archive workspace</Button></>} />
      <Dialog open={dialog === "leave"} onOpenChange={(o) => !o && setDialog(null)} title="Leave this workspace?" size="s"
        description={`You’ll lose access to ${workspace?.name}. Memories and replies you created stay, attributed to you. Owners can invite you back.`}
        footer={<><Button variant="ghost" onClick={() => setDialog(null)}>Cancel</Button><Button variant="danger" onClick={async () => { await v2.leave(projectId); setDialog(null); await fetchProjects(true); navigate("/app"); toast(`You left ${workspace?.name}`); }}>Leave workspace</Button></>} />
      <Dialog open={dialog === "delete"} onOpenChange={(o) => !o && setDialog(null)} title="Delete this workspace?"
        description={`Memory (${workspace?.counts?.memory ?? 0} items), history and drafts for ${workspace?.name} will be deleted after 7 days. Gmail, Slack and Notes aren’t affected.`}
        footer={<><Button variant="ghost" onClick={() => setDialog(null)}>Cancel</Button><Button variant="danger" disabled={typed !== workspace?.name} onClick={async () => {
          const r = await v2.deleteWorkspace(projectId, typed); setDialog(null); await fetchProjects(true);
          navigate(r.next_workspace ? `/w/${r.next_workspace}` : "/app");
          toast.success(`“${workspace?.name}” will be deleted on ${format(new Date(r.deletion_at), "MMM d")}`, { duration: 15000, action: { label: "Cancel deletion", onClick: async () => { await v2.restoreWorkspace(projectId); fetchProjects(true); toast("Deletion canceled"); } } });
        }}>Delete workspace</Button></>}>
        <FieldRow label="Type the workspace name to confirm" id="del-name"><Input id="del-name" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={workspace?.name} autoFocus /></FieldRow>
        <p className="mt-3 flex items-center gap-2 text-[12px] text-fg-tertiary"><Info size={14} /> Tip: export memory & history first. You can cancel deletion within 7 days.</p>
      </Dialog>
    </div>
  );
}

/* ───────────────────────── Members ───────────────────────── */
function Members() {
  const { projectId, role } = useWorkspace();
  const { data, setData, reload } = useResource(() => v2.members(projectId), [projectId]);
  const [invite, setInvite] = useState(false);
  const [remove, setRemove] = useState(null);
  const owner = role === "owner";
  const members = data?.members || [];
  const active = members.filter((m) => m.status === "active").length;
  const pending = members.filter((m) => m.status === "pending").length;
  const changeRole = async (m, r) => {
    setData((d) => ({ ...d, members: d.members.map((x) => (x.id === m.id ? { ...x, role: r } : x)) }));
    await v2.updateMember(projectId, m.id, { role: r });
    toast.success(`${m.name || m.email} is now ${ROLES[r][0].toLowerCase() === "owner" ? "an Owner" : `a${r === "editor" ? "n" : ""} ${ROLES[r][0]}`}`);
  };
  return (
    <div className="space-y-4">
      <p className="-mt-3 text-[12px] text-fg-tertiary">People who can see and act on this workspace’s memory.</p>
      <div className="flex items-center"><p className="flex-1 text-[12px] text-fg-tertiary">{active} members · {pending} pending</p><Button variant="primary" icon={Plus} onClick={() => setInvite(true)} disabled={!owner}>Invite people</Button></div>
      <Stagger className="overflow-hidden rounded-lg border border-line divide-y divide-line-subtle">
        {members.map((m) => (
          <StaggerItem key={m.id} className="flex items-center gap-3 px-4 py-3">
            {m.name ? <Avatar name={m.name} /> : <span className="flex h-7 w-7 items-center justify-center rounded-full border border-line text-fg-tertiary">—</span>}
            <div className="min-w-0 flex-1"><p className="truncate text-[12px] text-fg">{m.name || m.email}</p><p className="truncate text-[12px] text-fg-tertiary">{m.status === "pending" ? `Invite sent ${format(new Date(m.invited_at), "MMM d")}` : m.email}</p></div>
            {m.status === "pending" ? <Badge tone="info">Pending</Badge> : m.role !== "owner" && <Badge>{m.role === "viewer" ? "Read-only" : "Can accept changes"}</Badge>}
            <Menu>
              <MenuTrigger asChild><Button size="s" iconRight={ChevronDown} disabled={!owner || (m.role === "owner" && m.id === "u1")}>{ROLES[m.role][0]}</Button></MenuTrigger>
              <MenuContent className="w-[260px]">
                {Object.entries(ROLES).map(([k, [l, h]]) => (
                  <MenuItem key={k} onSelect={() => k !== m.role && changeRole(m, k)} className="h-auto py-2">
                    <span className="flex w-full items-start gap-2"><span className="w-4 pt-0.5">{m.role === k ? <Check size={14} /> : null}</span><span><span className="block text-fg">{l}</span><span className="block text-[12px] text-fg-tertiary">{h}</span></span></span>
                  </MenuItem>
                ))}
              </MenuContent>
            </Menu>
            {m.role !== "owner" && owner && (
              <Menu>
                <MenuTrigger asChild><IconButton icon={MoreHorizontal} label={`${m.name || m.email} actions`} /></MenuTrigger>
                <MenuContent>
                  {m.status === "pending" ? (
                    <>
                      <MenuItem icon={Send} onSelect={async () => { await v2.resendInvite(projectId, m.id); toast(`Invite resent to ${m.email}`); }}>Resend invite</MenuItem>
                      <MenuItem icon={Link2} onSelect={() => { navigator.clipboard?.writeText(`${window.location.origin}/invite/${m.id}`); toast("Invite link copied"); }}>Copy invite link</MenuItem>
                      <MenuSeparator />
                      <MenuItem icon={X} danger onSelect={async () => { await v2.removeMember(projectId, m.id); reload(); toast(`Invite to ${m.email} revoked`); }}>Revoke invite</MenuItem>
                    </>
                  ) : <MenuItem icon={X} danger onSelect={async () => setRemove({ m, commitments: (await v2.memberCommitments(projectId, m.id)).items })}>Remove from workspace</MenuItem>}
                </MenuContent>
              </Menu>
            )}
          </StaggerItem>
        ))}
      </Stagger>
      <Card>
        <p className="text-body-m font-medium text-fg">What roles can do</p>
        <div className="mt-3 space-y-2">
          {[["Owner", "Everything, including billing, members and deleting the workspace"], ["Editor", "Accept or dismiss changes, edit memory, send replies"], ["Viewer", "Read memory, conversations and history; ask questions"]].map(([r, d]) => (
            <div key={r} className="flex gap-4 text-[12px]"><span className="w-[70px] shrink-0 text-fg-secondary">{r}</span><span className="text-fg-secondary">{d}</span></div>
          ))}
        </div>
      </Card>
      <InviteDialog open={invite} onOpenChange={setInvite} wid={projectId} onDone={reload} />
      <RemoveDialog value={remove} onClose={() => setRemove(null)} wid={projectId} onDone={reload} members={members} />
    </div>
  );
}

function InviteDialog({ open, onOpenChange, wid, onDone }) {
  const [emails, setEmails] = useState([]);
  const [draft, setDraft] = useState("");
  const [role, setRole] = useState("editor");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setEmails([]); setDraft(""); setRole("editor"); setErr(null); } }, [open]);
  const commit = (v) => { const parts = v.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean); if (parts.length) setEmails((e) => [...new Set([...e, ...parts])]); setDraft(""); };
  const outside = emails.filter((e) => !e.endsWith("@northlight.studio"));
  const send = async () => {
    const all = draft.trim() ? [...emails, draft.trim()] : emails;
    setBusy(true); setErr(null);
    try { const r = await v2.invite(wid, all, role); onOpenChange(false); onDone(); toast.success(`Sent ${r.invited} invite${r.invited === 1 ? "" : "s"}`); }
    catch (e) { setErr(e?.response?.data?.detail || "Couldn’t send invites"); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Invite people to this workspace"
      footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" loading={busy} disabled={!emails.length && !draft.trim()} onClick={send}>Send {emails.length + (draft.trim() ? 1 : 0) || ""} invite{emails.length + (draft.trim() ? 1 : 0) === 1 ? "" : "s"}</Button></>}>
      <label className="mb-2 block text-[12px] font-medium text-fg-secondary" htmlFor="inv">Emails</label>
      <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-md border border-line-control bg-surface px-2 py-1.5 focus-within:border-fg">
        <AnimatePresence initial={false}>
          {emails.map((e) => (
            <motion.span key={e} layout initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} transition={T.fast}
              className="inline-flex h-7 items-center gap-1.5 rounded-md bg-raised px-2 text-[12px] text-fg">
              {e}<button aria-label={`Remove ${e}`} onClick={() => setEmails((x) => x.filter((y) => y !== e))} className="text-fg-tertiary hover:text-fg"><X size={12} /></button>
            </motion.span>
          ))}
        </AnimatePresence>
        <input id="inv" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={emails.length ? "Add another…" : "name@company.com"} autoFocus
          onKeyDown={(e) => { if (["Enter", ",", " ", "Tab"].includes(e.key) && draft.trim()) { e.preventDefault(); commit(draft); } if (e.key === "Backspace" && !draft && emails.length) setEmails((x) => x.slice(0, -1)); }}
          onBlur={() => draft.trim() && commit(draft)} onPaste={(e) => { e.preventDefault(); commit(e.clipboardData.getData("text")); }}
          className="min-w-[140px] flex-1 bg-transparent text-[12px] text-fg placeholder:text-fg-tertiary outline-none" />
      </div>
      <AnimatePresence>
        {outside.length > 0 && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={T.base} className="overflow-hidden">
            <p className="mt-3 flex gap-2 rounded-md border border-warning/70 bg-warning-bg px-3 py-2 text-[12px] text-fg"><AlertTriangle size={14} className="mt-0.5 shrink-0 text-warning" />{outside.join(", ")} {outside.length === 1 ? "is" : "are"} outside Northlight Studio. They’ll see this workspace’s memory, including internal notes.</p>
          </motion.div>
        )}
      </AnimatePresence>
      {err && <p className="mt-2 text-[12px] text-danger">{err}</p>}
      <div className="mt-4 flex items-center justify-between">
        <span className="text-[12px] text-fg-secondary">Role</span>
        <Menu>
          <MenuTrigger asChild><Button size="s" iconRight={ChevronDown}>{ROLES[role][0]}</Button></MenuTrigger>
          <MenuContent>{["editor", "viewer"].map((r) => <MenuItem key={r} checked={role === r} onSelect={() => setRole(r)}>{ROLES[r][0]}</MenuItem>)}</MenuContent>
        </Menu>
      </div>
    </Dialog>
  );
}

function RemoveDialog({ value, onClose, wid, onDone, members }) {
  const [to, setTo] = useState("Maya Rao");
  const m = value?.m;
  const first = (m?.name || "").split(" ")[0];
  return (
    <Dialog open={!!value} onOpenChange={(o) => !o && onClose()} title={`Remove ${m?.name || m?.email}?`}
      description={`${first} loses access to this workspace immediately. Memories, notes and replies ${first ? "she" : "they"} created stay, attributed to ${first ? "her" : "them"}.`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="danger" onClick={async () => { await v2.removeMember(wid, m.id, value.commitments.length ? to : undefined); onClose(); onDone(); toast(`${m.name} removed`); }}>Remove member</Button></>}>
      {value?.commitments?.length > 0 && (
        <>
          <FieldRow label={`Reassign ${first}’s open commitments to`} id="reassign">
            <Menu>
              <MenuTrigger asChild><button id="reassign" className="flex h-10 w-full items-center justify-between rounded-md border border-line-control bg-surface px-3 text-[12px] text-fg">{to}<ChevronDown size={14} /></button></MenuTrigger>
              <MenuContent align="start" className="w-[320px]">{members.filter((x) => x.status === "active" && x.id !== m.id).map((x) => <MenuItem key={x.id} checked={to === x.name} onSelect={() => setTo(x.name)}>{x.name}</MenuItem>)}</MenuContent>
            </Menu>
          </FieldRow>
          <p className="mt-2 text-[12px] text-fg-tertiary">{value.commitments.length} commitment: “{value.commitments[0].title}”</p>
        </>
      )}
    </Dialog>
  );
}

/* ───────────────────────── Billing ───────────────────────── */
function Billing() {
  const { billing, reload } = useBilling();
  const [params, setParams] = useSearchParams();
  const [choose, setChoose] = useState(false);
  const [change, setChange] = useState(false);
  const [cancel, setCancel] = useState(false);
  useEffect(() => {
    if (params.get("choose") || params.get("card") || params.get("extend")) { setChoose(true); setParams({}, { replace: true }); }
    if (params.get("limit")) { toast("You’re using all 10 projects", { description: "Archive a finished workspace or add this one for a one-off fee." }); setParams({}, { replace: true }); }
  }, [params, setParams]);
  if (!billing) return null;
  const b = billing;
  const trial = b.status === "trialing" || b.status === "expired";
  const daysLeft = b.trial_ends_at ? Math.max(0, Math.ceil((new Date(b.trial_ends_at) - Date.now()) / 864e5)) : 0;
  const price = (plan) => money(b.prices?.[plan]?.[b.currency] ?? 0, b.currency);
  return (
    <div className="space-y-4">
      <AnimatePresence initial={false}>
        {trial && (
          <motion.div key="trial" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className={cn("flex items-center gap-3 rounded-lg border px-4 py-3", b.status === "expired" ? "border-warning/70 bg-warning-bg" : "border-info/70 bg-info-bg")}>
            <Clock size={16} className={b.status === "expired" ? "text-warning" : "text-info"} />
            <div className="min-w-0 flex-1"><p className="text-[12px] text-fg">{b.status === "expired" ? `Your free trial ended on ${format(new Date(b.trial_ends_at), "MMM d")}` : `Free trial · ${daysLeft} days left`}</p><p className="text-[12px] text-fg-secondary">{b.status === "expired" ? "Memory is read-only and sources are paused. Nothing is deleted." : `Ends ${format(new Date(b.trial_ends_at), "MMM d")}. Nothing is charged until you choose a plan.`}</p></div>
            <Button variant="primary" onClick={() => setChoose(true)}>Choose a plan</Button>
          </motion.div>
        )}
        {b.status === "canceled" && (
          <motion.div key="canceled" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex items-center gap-3 rounded-lg border border-warning/70 bg-warning-bg px-4 py-3">
            <AlertTriangle size={16} className="text-warning" />
            <div className="min-w-0 flex-1"><p className="text-[12px] text-fg">Subscription canceled · access until {format(new Date(b.ends_on), "MMM d")}</p><p className="text-[12px] text-fg-secondary">After that, memory is read-only and sources pause. Nothing is deleted.</p></div>
            <Button onClick={async () => { await v2.resume(); await reload(); toast.success("Subscription resumed"); }}>Resume subscription</Button>
          </motion.div>
        )}
        {b.status === "past_due" && (
          <motion.div key="due" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-3 rounded-lg border border-danger/70 bg-danger-bg px-4 py-3">
            <AlertTriangle size={16} className="text-danger" />
            <div className="min-w-0 flex-1"><p className="text-[12px] text-fg">We couldn’t charge {b.card?.brand} ···· {b.card?.last4}</p><p className="text-[12px] text-fg-secondary">We’ll retry {b.retry?.of || 3} times over 7 days. If it still fails, syncing pauses on {format(new Date(b.retry.grace_ends_at), "MMM d")} — nothing is deleted.</p></div>
            <Button variant="primary" onClick={() => setChoose(true)}>Update card</Button>
          </motion.div>
        )}
      </AnimatePresence>
      <Card>
        <Line title={<span className="text-body-m font-medium">{trial ? "Trial" : `${b.label} · ${price(b.plan)} / ${b.interval === "month" ? "month" : "project"}`}</span>}
          help={`${b.workspaces.used} of ${b.workspaces.limit} projects used · ${trial ? "Unlimited sources" : b.renews_on ? `Renews ${format(new Date(b.renews_on), "MMM d")}` : "One-off"}${b.pending_change ? ` · switches to ${b.pending_change.plan === "project" ? "Per project" : "Monthly"} on ${format(new Date(b.pending_change.on), "MMM d")}` : ""}`}
          action={<Button size="s" onClick={() => (trial ? setChoose(true) : setChange(true))}>{trial ? "Compare plans" : "Change plan"}</Button>} />
      </Card>
      <Card>
        {b.card ? <Line title={`${b.card.brand} ···· ${b.card.last4}`} help={`Expires ${b.card.exp} · ${b.card.email || ""}`} action={<Button size="s" variant="ghost" onClick={() => setChoose(true)}>Update</Button>} />
          : <Line title="No payment method yet" help="Added when you choose a plan. Handled securely by our payment provider." />}
      </Card>
      <Card>
        <p className="text-body-m font-medium text-fg">Invoices</p>
        {(b.invoices || []).length === 0 ? <p className="mt-3 text-[12px] text-fg-tertiary">No invoices yet.</p> : (
          <div className="mt-2 divide-y divide-line-subtle">
            {b.invoices.map((i) => (
              <div key={i.id} className="flex items-center gap-4 py-3 text-[12px]">
                <span className="w-[100px] text-fg">{format(new Date(i.at), "MMM d, yyyy")}</span>
                <span className="flex-1 text-fg-secondary">{i.label}</span>
                <span className="font-mono text-fg">{money2(i.amount, i.currency)}</span>
                <Badge tone="success" dot>Paid</Badge>
                <Button size="s" variant="ghost" icon={Download} onClick={() => toast("Downloading invoice PDF…")}>PDF</Button>
              </div>
            ))}
          </div>
        )}
      </Card>
      <div className="flex items-center">
        <span className="flex-1 text-[12px] text-fg-secondary">Billing currency</span>
        <Menu>
          <MenuTrigger asChild><Button size="s" iconRight={ChevronDown}>{b.currency === "inr" ? "INR (₹)" : "USD ($)"}</Button></MenuTrigger>
          <MenuContent>{[["usd", "USD ($)"], ["inr", "INR (₹) · incl. GST"]].map(([k, l]) => <MenuItem key={k} checked={b.currency === k} onSelect={async () => { setBilling(await v2.updateBilling({ currency: k })); }}>{l}</MenuItem>)}</MenuContent>
        </Menu>
      </div>
      {b.status === "active" && b.plan === "monthly" && (
        <div className="flex items-center"><span className="flex-1 text-[12px] text-fg-tertiary">Cancel subscription — you keep access until the end of the billing period</span><Button size="s" variant="ghost" onClick={() => setCancel(true)}>Cancel subscription</Button></div>
      )}
      <ChoosePlan open={choose} onOpenChange={setChoose} b={b} />
      <ChangePlan open={change} onOpenChange={setChange} b={b} />
      <CancelPlan open={cancel} onOpenChange={setCancel} b={b} />
    </div>
  );
}

function PlanRadio({ on, title, sub, price, onClick }) {
  return (
    <button role="radio" aria-checked={on} onClick={onClick} className={cn("flex w-full items-start gap-3 rounded-md border p-4 text-left transition-colors duration-fast", on ? "border-fg bg-surface" : "border-line-control hover:border-line-strong")}>
      <span className={cn("mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border", on ? "border-fg bg-fg" : "border-line-control")}>{on && <motion.span layoutId="plan-dot" className="h-1.5 w-1.5 rounded-full bg-app" transition={T.fast} />}</span>
      <span className="min-w-0 flex-1"><span className="block text-body-m text-fg">{title}</span><span className="block text-[12px] text-fg-tertiary">{sub}</span></span>
      <span className="text-body-m text-fg">{price}</span>
    </button>
  );
}

function ChoosePlan({ open, onOpenChange, b }) {
  const [plan, setPlan] = useState("monthly");
  const [card, setCard] = useState("");
  const [exp, setExp] = useState("");
  const [cvc, setCvc] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  useEffect(() => { if (open) { setPlan(b.plan === "project" ? "project" : "monthly"); setErr(null); } }, [open, b.plan]);
  const amount = b.prices?.[plan]?.[b.currency] ?? 0;
  const trialing = b.status === "trialing";
  const pay = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await v2.checkout(plan, b.currency, card || "4242 4242 4242 4242", exp || "08/28");
      setBilling(r.billing); onOpenChange(false);
      toast.success(plan === "monthly" ? `Monthly plan active${trialing ? ` · first charge ${format(new Date(r.billing.first_charge_at), "MMM d")}` : ""}` : "Workspace active for 60 days");
    } catch (e) { setErr(e?.response?.data?.detail || "Payment didn’t go through. Nothing was charged."); } finally { setBusy(false); }
  };
  const fmtCard = (v) => v.replace(/\D/g, "").slice(0, 16).replace(/(\d{4})(?=\d)/g, "$1 ");
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={b.status === "past_due" ? "Update card" : "Choose a plan"}
      footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={pay}>{b.status === "past_due" ? "Save card & retry" : plan === "monthly" ? "Start Monthly plan" : `Pay ${money(amount, b.currency)}`}</Button></>}>
      {b.status !== "past_due" && (
        <div role="radiogroup" className="space-y-3">
          <PlanRadio on={plan === "monthly"} onClick={() => setPlan("monthly")} title="Monthly" sub="Up to 10 active projects · cancel anytime" price={`${money(b.prices?.monthly?.[b.currency] ?? 0, b.currency)} / mo`} />
          <PlanRadio on={plan === "project"} onClick={() => setPlan("project")} title="Per project" sub="This workspace, active for 60 days" price={`${money(b.prices?.project?.[b.currency] ?? 0, b.currency)} once`} />
        </div>
      )}
      <p className="mt-5 text-[12px] font-medium text-fg-secondary">Payment</p>
      <FieldRow label="Card number" id="cc"><Input id="cc" inputMode="numeric" autoComplete="cc-number" value={card} onChange={(e) => setCard(fmtCard(e.target.value))} placeholder="1234 1234 1234 1234" /></FieldRow>
      <div className="grid grid-cols-2 gap-3">
        <FieldRow label="Expiry" id="ccexp"><Input id="ccexp" autoComplete="cc-exp" value={exp} onChange={(e) => setExp(e.target.value.replace(/[^\d/ ]/g, "").slice(0, 7))} placeholder="MM / YY" /></FieldRow>
        <FieldRow label="CVC" id="cccvc"><Input id="cccvc" autoComplete="cc-csc" inputMode="numeric" value={cvc} onChange={(e) => setCvc(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="···" /></FieldRow>
      </div>
      {err && <p className="mt-3 text-[12px] text-danger">{err}</p>}
      {b.status !== "past_due" && (
        <div className="mt-4 space-y-1.5 text-[12px]">
          <div className="flex"><span className="flex-1 text-fg-secondary">{plan === "monthly" ? "Monthly plan" : "Per project"}</span><span className="font-mono text-fg">{money2(amount, b.currency)}</span></div>
          <div className="flex"><span className="flex-1 text-fg-secondary">Tax</span><span className="font-mono text-fg">{b.currency === "inr" ? "incl. GST" : money2(0, b.currency)}</span></div>
          <div className="flex"><span className="flex-1 text-fg-secondary">Due today</span><span className="font-mono text-fg">{money2(trialing && plan === "monthly" ? 0 : amount, b.currency)}</span></div>
          {trialing && plan === "monthly" && <p className="pt-1 text-fg-tertiary">First charge of {money2(amount, b.currency)} on {format(new Date(b.trial_ends_at), "MMM d")}, when your trial ends. Cancel anytime before then.</p>}
        </div>
      )}
      <p className="mt-3 flex items-center gap-2 text-[12px] text-fg-tertiary"><Lock size={14} /> Card details go straight to our payment provider. Bracket never stores them.</p>
    </Dialog>
  );
}

function ChangePlan({ open, onOpenChange, b }) {
  const [plan, setPlan] = useState(b.plan);
  useEffect(() => { if (open) setPlan(b.plan); }, [open, b.plan]);
  const renew = b.renews_on ? format(new Date(b.renews_on), "MMM d") : "your next renewal";
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Change plan" size="s"
      footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" onClick={async () => { const r = await v2.changePlan(plan); setBilling(r.billing); onOpenChange(false); if (plan !== b.plan) toast.success(`Switching to Per project on ${renew}`); }}>{plan === b.plan ? `Keep ${b.plan === "monthly" ? "Monthly" : "Per project"}` : `Switch on ${renew}`}</Button></>}>
      <div role="radiogroup" className="space-y-3">
        <PlanRadio on={plan === "monthly"} onClick={() => setPlan("monthly")} title={`Monthly${b.plan === "monthly" ? " · current" : ""}`} sub="Up to 10 active projects" price={`${money(b.prices?.monthly?.[b.currency] ?? 0, b.currency)} / mo`} />
        <PlanRadio on={plan === "project"} onClick={() => setPlan("project")} title={`Per project${b.plan === "project" ? " · current" : ""}`} sub="One workspace for 60 days — switch at the end of this period" price={`${money(b.prices?.project?.[b.currency] ?? 0, b.currency)} each`} />
      </div>
      <p className="mt-3 text-[12px] text-fg-tertiary">Changes apply at your next renewal on {renew}. No charge today.</p>
    </Dialog>
  );
}

function CancelPlan({ open, onOpenChange, b }) {
  const [reason, setReason] = useState("Project ended");
  const until = b.renews_on ? format(new Date(b.renews_on), "MMM d") : "the end of this period";
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Cancel your subscription?"
      description={`You’ll keep full access until ${until}. After that, memory becomes read-only — nothing is deleted, and you can resubscribe any time.`}
      footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Keep subscription</Button><Button variant="danger" onClick={async () => { const r = await v2.cancel(reason); setBilling(r.billing); onOpenChange(false); }}>Cancel subscription</Button></>}>
      <p className="text-[12px] font-medium text-fg-secondary">What’s the main reason? (optional)</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {["Project ended", "Too expensive", "Missing a source I need", "Not accurate enough", "Other"].map((r) => (
          <button key={r} onClick={() => setReason(r)} className={cn("h-8 rounded-md border px-3 text-[12px] font-medium transition-colors duration-fast", reason === r ? "border-fg bg-selected text-fg" : "border-line-control text-fg-secondary hover:text-fg")}>{r}</button>
        ))}
      </div>
      <AnimatePresence>{reason === "Project ended" && (
        <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="mt-3 flex items-center gap-2 overflow-hidden rounded-md border border-line px-3 py-2 text-[12px] text-fg-secondary"><Info size={14} /> Project ended? Per project ({money(b.prices?.project?.[b.currency] ?? 2, b.currency)}) keeps one project active for 60 days.</motion.p>
      )}</AnimatePresence>
    </Dialog>
  );
}

/* ───────────────────────── Sources (settings) ───────────────────────── */
function SourcesSection() {
  const { projectId, sources } = useWorkspace();
  return (
    <div className="space-y-4">
      <p className="-mt-3 text-[12px] text-fg-tertiary">Connections for this workspace. Open one to choose exactly what Bracket reads.</p>
      <div className="overflow-hidden rounded-lg border border-line divide-y divide-line-subtle">
        {(sources || []).map((s) => (
          <Link key={s.id} to={`/w/${projectId}/sources/${s.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-hover">
            {s.provider === "notes" ? <FileText size={16} className="text-fg-secondary" /> : <SourceMark provider={s.provider} size={16} />}
            <span className="flex-1 text-[12px] text-fg">{s.label} <span className="text-fg-tertiary">· {s.account}</span></span>
            <SourceStatus s={s} short />
          </Link>
        ))}
      </div>
      <Button icon={Plus} onClick={() => (window.location.href = `/w/${projectId}/sources?add=1`)}>Add source</Button>
    </div>
  );
}

/* ───────────────────────── Privacy & data ───────────────────────── */
function Privacy() {
  const [del, setDel] = useState(false);
  const [typed, setTyped] = useState("");
  const navigate = useNavigate();
  const { projects } = useProjects();
  const owned = (projects || []).filter((p) => p.role === "owner" && p.status !== "deletion_scheduled");
  return (
    <div className="space-y-4">
      <p className="-mt-3 text-[12px] text-fg-tertiary">How Bracket handles what it reads.</p>
      <Card>
        <ul className="space-y-3">
          {["Bracket reads only the threads, channels and files you choose.", "Your business data is never used to train general AI models — ours or our providers’.", "Encrypted in transit and at rest.", "Every memory keeps a link to its source."].map((x) => (
            <li key={x} className="flex gap-3 text-[12px] text-fg-secondary"><Check size={16} className="shrink-0 text-success" />{x}</li>
          ))}
        </ul>
      </Card>
      <Card>
        <Line title="Export all my data" help="Every workspace, memory, history and draft. Emailed within 24 hours." action={<Button size="s" onClick={async () => { const r = await v2.exportAccount(); toast.success("Export requested", { description: `We’ll email ${r.email} within 24 hours.` }); }}>Request export</Button>} />
        <Line className="mt-3" title="Original message retention" help="Bracket keeps quoted excerpts, not full mailboxes. 12 months." />
      </Card>
      <Card danger>
        <Line title={<span className="text-danger">Delete my account</span>} help="Deletes your account and every workspace you own after 7 days. Connected tools aren’t affected."
          action={<Button size="s" variant="danger" onClick={() => { setTyped(""); setDel(true); }}>Delete account</Button>} />
      </Card>
      <Dialog open={del} onOpenChange={setDel} title="Delete your account?" description={`This deletes your account and the ${owned.length} workspaces you own after 7 days. Members of shared workspaces lose access.`}
        footer={<><Button variant="ghost" onClick={() => setDel(false)}>Cancel</Button><Button variant="danger" disabled={typed !== "DELETE"} onClick={async () => { await v2.deleteAccount(typed); setDel(false); navigate("/login"); toast("Your account will be deleted in 7 days", { description: "Sign in before then to cancel." }); }}>Delete account</Button></>}>
        <FieldRow label="Type DELETE to confirm" id="del-acc"><Input id="del-acc" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus /></FieldRow>
      </Dialog>
    </div>
  );
}

