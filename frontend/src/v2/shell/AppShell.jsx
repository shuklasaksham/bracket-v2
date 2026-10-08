import React, { useEffect, useMemo, useState } from "react";
import { NavLink, Link, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutGrid, Layers, MessagesSquare, History, Plus, MessageCircleQuestion, Folder, PanelLeft, Search, Menu as MenuIcon,
  ChevronDown, ArrowLeft, Settings as SettingsIcon, LogOut, CreditCard, Check, Bell, Unlink, Users, ShieldCheck, User, Plug,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "../../lib/utils";
import { useAuth } from "../../lib/AuthContext";
import { useWorkspace, useProjects } from "../lib/workspace";
import { Avatar, IconButton, Kbd, SourceMark, initialsOf } from "../ui/primitives";
import { Menu, MenuTrigger, MenuContent, MenuItem, MenuSeparator, Popover, PopoverTrigger, PopoverContent, Sheet, Tooltip } from "../ui/overlays";
import { Count, t as T } from "../ui/motion";
import { useIsMobile, useMedia } from "../lib/useMedia";
import { Logo, Mark } from "./Logo";
import NotificationsButton from "./Notifications";
import { useCommand } from "./CommandPalette";
import WorkspaceBanner from "./WorkspaceBanner";
import DemoBar from "./DemoBar";

/* Responsive model (Figma › Breakpoints & layout):
   ≥1280 sidebar (260 / 232 at 1280) — the toggle collapses it to the icon rail
   1024–1279 icon rail — the toggle opens the full sidebar as an overlay drawer
   768–1023 compact header + nav drawer
   <768 mobile header + tab bar */

const sinceShort = (iso) => {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
};
const ago = (iso) => {
  const x = sinceShort(iso);
  return x ? `${x} ago` : "";
};

/* ───────────────────────── Workspace switcher ───────────────────────── */
function SwitcherList({ onPick, onNew, currentId }) {
  const { projects } = useProjects();
  const [q, setQ] = useState("");
  const groups = useMemo(() => {
    const list = (projects || []).filter((p) => p.status !== "deletion_scheduled" && (!q || `${p.name} ${p.client_name} ${p.business}`.toLowerCase().includes(q.toLowerCase())));
    const by = new Map();
    list.forEach((p) => {
      const k = p.business || p.client_name || "Personal";
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(p);
    });
    return [...by.entries()];
  }, [projects, q]);
  const meta = (p) => {
    if (p.status === "archived") return "Archived";
    if (p.attention) return `${p.attention} need${p.attention === 1 ? "s" : ""} attention`;
    return p.sources_label || "";
  };
  return (
    <div>
      <div className="flex items-center gap-2 border-b border-line-subtle px-3 h-10">
        <Search size={14} className="text-fg-tertiary" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a workspace" className="flex-1 bg-transparent text-body-m text-fg placeholder:text-fg-tertiary outline-none" aria-label="Find a workspace" />
      </div>
      <div className="max-h-[360px] overflow-y-auto p-1">
        {projects === null && <p className="px-2 py-3 text-body-s text-fg-tertiary">Loading…</p>}
        {projects && groups.length === 0 && <p className="px-2 py-3 text-body-s text-fg-tertiary">No workspace matches “{q}”.</p>}
        {groups.map(([biz, list]) => (
          <div key={biz} className="pb-1">
            <p className="eyebrow px-2 pt-2 pb-1">{biz}</p>
            {list.map((p) => (
              <button
                key={p.id}
                onClick={() => onPick(p)}
                className={cn("flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-body-m transition-colors duration-fast hover:bg-hover", p.id === currentId ? "bg-hover text-fg" : "text-fg-secondary")}
              >
                <span className="flex-1 truncate">{p.name}</span>
                <span className="text-body-s text-fg-tertiary truncate max-w-[140px]">{meta(p)}</span>
                {p.id === currentId && <Check size={14} className="text-fg" />}
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className="border-t border-line-subtle p-1">
        <button onClick={onNew} className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-body-m text-fg-secondary hover:bg-hover hover:text-fg">
          <Plus size={14} /> New workspace
        </button>
      </div>
    </div>
  );
}

function WorkspaceSwitcher({ variant = "bar" }) {
  const { project } = useWorkspace();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const client = project?.client_name || "";
  const name = project?.name || "Workspace";
  useEffect(() => {
    const onKey = (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "o") { e.preventDefault(); setOpen(true); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const chip = (
    <span className={cn("inline-flex shrink-0 items-center justify-center rounded-md bg-raised border border-line font-semibold text-fg", variant === "bar" ? "h-6 w-6 rounded-[4px] border-0 bg-white/[0.06] text-[12px] font-bold" : "h-7 w-7 text-[11px]")}>
      {project?.initials || initialsOf(client || name)}
    </span>
  );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {variant === "bar" ? (
          <button className="flex min-w-0 items-center gap-2 rounded-md px-2 h-8 hover:bg-hover transition-colors duration-fast" aria-label="Switch workspace (Ctrl O)">
            {chip}
            {client && <span className="hidden lg:inline text-[12px] text-fg-tertiary truncate max-w-[160px]">{client}</span>}
            {client && <span className="hidden lg:inline text-[12px] text-fg-disabled">/</span>}
            <span className="text-[12px] font-medium text-fg truncate max-w-[220px] xl:max-w-[300px]">{name}</span>
            <ChevronDown size={14} className={cn("shrink-0 text-fg-tertiary transition-transform duration-fast", open && "rotate-180")} />
          </button>
        ) : (
          <button className="flex min-w-0 flex-1 items-center gap-2.5 text-left" aria-label="Switch workspace">
            {chip}
            <span className="min-w-0">
              <span className="block truncate text-body-m font-medium text-fg">{name}</span>
              {client && <span className="block truncate text-body-s text-fg-tertiary">{client}</span>}
            </span>
            <ChevronDown size={14} className="shrink-0 text-fg-tertiary" />
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[320px] p-0">
        <SwitcherList currentId={project?.id} onPick={(p) => { setOpen(false); navigate(`/w/${p.id}`); }} onNew={() => { setOpen(false); navigate("/connect?new=1"); }} />
      </PopoverContent>
    </Popover>
  );
}

/* ───────────────────────── User menu ───────────────────────── */
function UserMenu() {
  const { user, logout } = useAuth();
  const { projectId } = useWorkspace();
  const navigate = useNavigate();
  const s = (x) => navigate(`/w/${projectId}/settings/${x}`);
  return (
    <Menu>
      <MenuTrigger asChild>
        <button className="rounded-full focus-visible:outline-offset-2" aria-label="Account menu">
          <Avatar name={user?.name} email={user?.email} src={user?.picture} />
        </button>
      </MenuTrigger>
      <MenuContent className="w-[248px]">
        <div className="px-2 py-2">
          <p className="text-body-m font-medium text-fg truncate">{user?.name || "Your account"}</p>
          <p className="text-body-s text-fg-tertiary truncate">{user?.email}</p>
        </div>
        <MenuSeparator />
        <MenuItem icon={User} onSelect={() => s("profile")}>Profile</MenuItem>
        <MenuItem icon={Bell} onSelect={() => s("notifications")}>Notifications</MenuItem>
        <MenuItem icon={SettingsIcon} onSelect={() => s("workspace")}>Workspace settings</MenuItem>
        <MenuItem icon={Users} onSelect={() => s("members")}>Members</MenuItem>
        <MenuItem icon={CreditCard} onSelect={() => s("billing")}>Billing</MenuItem>
        <MenuItem icon={ShieldCheck} onSelect={() => s("privacy")}>Privacy & data</MenuItem>
        <MenuSeparator />
        <MenuItem icon={LogOut} onSelect={async () => { await logout(); navigate("/login"); }}>Sign out</MenuItem>
      </MenuContent>
    </Menu>
  );
}

/* ───────────────────────── Sidebar ───────────────────────── */
const NAV = [
  { to: "", label: "Overview", icon: LayoutGrid, end: true },
  { to: "memory", label: "Memory", icon: Layers, count: "needs_review", dot: "pending" },
  { to: "conversations", label: "Conversations", icon: MessagesSquare, count: "needs_reply", dot: "needs_reply" },
  { to: "timeline", label: "Timeline", icon: History },
];

function RailTip({ rail, label, children }) {
  // Wrap in a span: Radix Slot would merge its className into NavLink’s function className.
  return rail ? <Tooltip content={label} side="right"><span className="block">{children}</span></Tooltip> : children;
}

function NavRow({ to, end, icon: Icon, label, count, dot, rail, mark, trailing, onClick, active: forceActive }) {
  const location = useLocation();
  const inner = (isActive) => (
    <>
      {isActive && (
        <motion.span layoutId="nav-active" className="absolute inset-0 rounded-md bg-selected" transition={T.base} aria-hidden="true" />
      )}
      <span className="relative flex shrink-0 items-center justify-center" style={{ width: 16, height: 16 }}>
        {mark || <Icon size={16} strokeWidth={1.75} />}
        {rail && dot ? <span className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-warning" aria-hidden="true" /> : null}
      </span>
      {!rail && <span className={cn("relative flex-1 truncate", isActive ? "font-medium text-fg" : "")}>{label}</span>}
      {!rail && trailing != null && trailing !== "" && <span className="relative flex items-center font-mono text-[12px] text-fg-tertiary">{trailing}</span>}
      {!rail && count > 0 && <Count value={count} className="relative text-caption text-fg-tertiary" />}
    </>
  );
  const cls = (isActive) => cn(
    "group relative flex items-center rounded-md text-body-m transition-colors duration-fast outline-offset-[-2px]",
    rail ? "h-10 w-10 justify-center mx-auto" : cn("h-8 px-2", mark ? "gap-3" : "gap-2"),
    isActive ? "text-fg" : "text-fg-secondary hover:bg-hover hover:text-fg",
  );
  if (!to) {
    return (
      <RailTip rail={rail} label={label}>
        <button onClick={onClick} className={cls(forceActive)} aria-label={rail ? label : undefined}>{inner(forceActive)}</button>
      </RailTip>
    );
  }
  return (
    <RailTip rail={rail} label={label}>
      <NavLink to={to} end={end} onClick={onClick} aria-label={rail ? label : undefined} className={({ isActive }) => cls(isActive || (forceActive ?? false))} state={location.state}>
        {({ isActive }) => inner(isActive || (forceActive ?? false))}
      </NavLink>
    </RailTip>
  );
}

function GroupLabel({ rail, children, action }) {
  if (rail) return <div className="mx-auto my-3 h-px w-8 bg-line-subtle" aria-hidden="true" />;
  return (
    <div className="mt-5 mb-0.5 flex h-7 items-center justify-between pl-2 pr-1">
      <p className="eyebrow">{children}</p>
      {action}
    </div>
  );
}

function Sidebar({ rail, onNavigate, width }) {
  const { projectId, counts, sources } = useWorkspace();
  const base = `/w/${projectId}`;
  const list = (sources || []).filter((s) => s.status !== "disconnected" || true);
  const issues = list.filter((s) => s.status === "error" || s.health === "reconnect");
  const healthy = !issues.length;
  return (
    <motion.nav
      aria-label="Workspace"
      initial={false}
      animate={{ width }}
      transition={T.base}
      className="flex h-full shrink-0 flex-col overflow-hidden bg-sidebar border-r border-line-subtle"
      onClick={onNavigate}
    >
      <div className={cn("flex h-[52px] shrink-0 items-center", rail ? "justify-center" : "pl-5")}>
        {rail ? <Link to="/app" aria-label="Bracket home"><Mark size={22} /></Link> : <Logo to="/app" />}
      </div>
      <div className={cn("scroll-pane flex-1 pb-3", rail ? "px-3" : "px-3")}>
        {!rail ? <div className="mt-5 mb-0.5 flex h-7 items-center pl-2"><p className="eyebrow">Workspace</p></div> : <div className="h-3" />}
        <div className="space-y-0.5">
          {NAV.map((n) => (
            <NavRow key={n.label} to={`${base}${n.to ? "/" + n.to : ""}`} end={n.end} icon={n.icon} label={n.label} rail={rail}
              count={n.count ? counts[n.count] : 0} dot={n.dot ? counts[n.dot] > 0 : false} />
          ))}
        </div>

        <GroupLabel rail={rail} action={
          <Tooltip content="Add source"><Link to={`${base}/sources?add=1`} className="flex h-5 w-5 items-center justify-center rounded-md text-fg-tertiary hover:bg-hover hover:text-fg" aria-label="Add source"><Plus size={14} /></Link></Tooltip>
        }>Sources</GroupLabel>
        <div className="space-y-0.5">
          {list.map((s) => {
            const bad = s.status === "error" || s.health === "reconnect";
            return (
              <NavRow key={s.id} to={`${base}/sources/${s.id}`} label={s.label} rail={rail}
                mark={<span className={cn("relative", (s.status === "paused" || s.status === "disconnected") && "opacity-50")}><SourceMark provider={s.provider} size={16} />{bad && rail && <Unlink size={10} className="absolute -right-1.5 -bottom-1 text-danger" />}</span>}
                trailing={bad ? <Unlink size={14} className="text-danger" aria-label="Needs reconnecting" /> : s.status === "paused" ? "paused" : s.status === "disconnected" ? "off" : sinceShort(s.last_sync_at)} />
            );
          })}
          {rail && (
            <Tooltip content="Add source" side="right">
              <Link to={`${base}/sources?add=1`} className="mx-auto flex h-10 w-10 items-center justify-center rounded-md text-fg-secondary hover:bg-hover hover:text-fg" aria-label="Add source">
                <span className="flex h-6 w-6 items-center justify-center rounded-md border border-line"><Plus size={14} /></span>
              </Link>
            </Tooltip>
          )}
          {!rail && list.length === 0 && (
            <Link to={`${base}/sources?add=1`} className="flex h-8 items-center gap-2 rounded-md px-2 text-body-m text-fg-tertiary hover:text-fg hover:bg-hover">
              <Plug size={16} strokeWidth={1.75} /> Connect a source
            </Link>
          )}
        </div>

        <GroupLabel rail={rail}>Tools</GroupLabel>
        <div className="space-y-0.5">
          <NavRow to={`${base}/ask`} icon={MessageCircleQuestion} label="Ask Bracket" rail={rail} />
          <NavRow to={`${base}/files`} icon={Folder} label="Files" rail={rail} count={counts.files} />
        </div>
      </div>
      <div className={cn("shrink-0", rail ? "flex justify-center py-4" : "mx-3 border-t border-line-subtle px-2 pt-3 pb-4")}>
        {rail ? (
          <Tooltip content={healthy ? "All sources up to date" : `${issues[0].label} needs attention`} side="right">
            <Link to={`${base}/sources`} className={cn("h-2 w-2 rounded-full", healthy ? "bg-success" : "bg-danger")} aria-label={healthy ? "All sources up to date" : "A source needs attention"} />
          </Tooltip>
        ) : (
          <Link to={`${base}/sources`} className="flex items-center gap-2 text-body-s text-fg-tertiary hover:text-fg-secondary" aria-live="polite">
            <span className={cn("h-1.5 w-1.5 rounded-full", healthy ? "bg-success" : "bg-danger animate-pulse-soft")} aria-hidden="true" />
            {healthy ? (list.length ? "All sources up to date" : "No sources connected") : `${issues[0].label} needs reconnecting`}
          </Link>
        )}
      </div>
    </motion.nav>
  );
}

/* ───────────────────────── Breadcrumb ───────────────────────── */
const SETTINGS_LABEL = { profile: "Profile", notifications: "Notifications", workspace: "Workspace", members: "Members", billing: "Billing", sources: "Sources", privacy: "Privacy & data" };
function useCrumbs() {
  const location = useLocation();
  const { categories, sources } = useWorkspace();
  const parts = location.pathname.split("/").slice(3);
  const [a, b] = parts;
  if (!a) return [];
  if (a === "memory") {
    const c = (categories || []).find((x) => x.key === b);
    const view = { "needs-review": "Needs review", recent: "Recently changed" }[b];
    return ["Memory", c?.label || view].filter(Boolean);
  }
  if (a === "sources") return ["Sources", (sources || []).find((s) => s.id === b)?.label].filter(Boolean);
  if (a === "settings") return ["Settings", SETTINGS_LABEL[b || "profile"]];
  return [{ review: "Review changes", resolve: "Resolve conflict", conversations: "Conversations", timeline: "Timeline", ask: "Ask Bracket", files: "Files" }[a]].filter(Boolean);
}

/* ───────────────────────── Top bar ───────────────────────── */
function TopBar({ onToggleNav, navLabel, compact }) {
  const cmd = useCommand();
  const crumbs = useCrumbs();
  return (
    <header className={cn("flex shrink-0 items-center gap-2 border-b border-line-subtle bg-app", compact ? "h-14 px-3" : "h-[52px] px-4")}>
      <IconButton icon={compact ? MenuIcon : PanelLeft} label={navLabel} onClick={onToggleNav} size={compact ? "l" : "m"} />
      {compact ? (
        <div className="flex min-w-0 flex-1"><WorkspaceSwitcher variant="compact" /></div>
      ) : (
        <>
          <WorkspaceSwitcher />
          <AnimatePresence mode="popLayout" initial={false}>
            {crumbs.length > 0 && (
              <motion.span key={crumbs.join("/")} initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={T.fast}
                className="hidden lg:flex min-w-0 items-center gap-1.5 text-[12px] text-fg-tertiary">
                {crumbs.map((c, i) => <React.Fragment key={i}><span className="text-fg-disabled">›</span><span className="truncate">{c}</span></React.Fragment>)}
              </motion.span>
            )}
          </AnimatePresence>
          <div className="flex-1" />
        </>
      )}
      {!compact && (
        <button
          onClick={() => cmd.open()}
          className="flex h-7 w-[220px] items-center gap-2 rounded-md border border-line-control bg-surface pl-3 pr-1 text-[12px] text-fg-tertiary hover:text-fg-secondary transition-colors duration-fast"
          aria-label="Search or jump to (Ctrl K)"
        >
          <Search size={14} />
          <span className="flex-1 text-left">Search or jump to…</span>
          <Kbd>⌘K</Kbd>
        </button>
      )}
      {compact && <IconButton icon={Search} label="Search" size="l" onClick={() => cmd.open()} />}
      <NotificationsButton size={compact ? "l" : "m"} />
      <UserMenu />
    </header>
  );
}

/* ───────────────────────── Mobile ───────────────────────── */
const TABS = [
  { to: "", label: "Overview", icon: LayoutGrid, end: true },
  { to: "memory", label: "Memory", icon: Layers, dot: "pending" },
  { to: "ask", label: "Ask", icon: MessageCircleQuestion },
  { to: "conversations", label: "Conversations", icon: MessagesSquare, dot: "needs_reply" },
  { to: "timeline", label: "Timeline", icon: History },
];
function MobileHeader({ onOpenSheet }) {
  const { project } = useWorkspace();
  const cmd = useCommand();
  return (
    <header className="flex h-14 shrink-0 items-center gap-1 border-b border-line-subtle bg-app pl-4 pr-2">
      <button onClick={onOpenSheet} className="flex min-w-0 flex-1 items-center gap-2.5 text-left h-11" aria-label="Workspace and account">
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-raised border border-line text-[11px] font-semibold">
          {project?.initials || initialsOf(project?.client_name || project?.name || "")}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-body-m font-medium text-fg">{project?.name || "Workspace"}</span>
          {project?.client_name && <span className="block truncate text-body-s text-fg-tertiary">{project.client_name}</span>}
        </span>
        <ChevronDown size={16} className="shrink-0 text-fg-tertiary" />
      </button>
      <IconButton icon={Search} label="Search" size="l" onClick={() => cmd.open()} />
      <NotificationsButton size="l" />
    </header>
  );
}
function TabBar() {
  const { projectId, counts } = useWorkspace();
  const base = `/w/${projectId}`;
  return (
    <nav aria-label="Primary" className="shrink-0 border-t border-line-subtle bg-app safe-bottom">
      <div className="grid grid-cols-5">
        {TABS.map((t) => (
          <NavLink
            key={t.label}
            to={`${base}${t.to ? "/" + t.to : ""}`}
            end={t.end}
            className={({ isActive }) => cn("relative flex h-14 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors duration-fast", isActive ? "text-fg" : "text-fg-tertiary")}
          >
            {({ isActive }) => (
              <>
                <span className="relative">
                  <motion.span animate={{ scale: isActive ? 1.06 : 1 }} transition={T.fast} className="block"><t.icon size={22} strokeWidth={1.6} /></motion.span>
                  {t.dot && counts[t.dot] > 0 && <span className="absolute -right-1 -top-0.5 h-1.5 w-1.5 rounded-full bg-warning" />}
                </span>
                {t.label}
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
function WorkspaceSheet({ open, onOpenChange }) {
  const { project, projectId } = useWorkspace();
  const { projects } = useProjects();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const go = (to) => { onOpenChange(false); navigate(to); };
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Workspaces">
      <div className="-mx-1 space-y-0.5">
        {(projects || []).filter((p) => p.status === "active" || p.id === project?.id).map((p) => (
          <button key={p.id} onClick={() => go(`/w/${p.id}`)} className="flex min-h-[48px] w-full items-center gap-3 rounded-md px-2 text-left hover:bg-hover">
            <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-raised border border-line text-[11px] font-semibold">{p.initials || initialsOf(p.name)}</span>
            <span className="flex-1 min-w-0">
              <span className="block truncate text-body-m text-fg">{p.name}</span>
              <span className="block truncate text-body-s text-fg-tertiary">{p.attention ? `${p.attention} need${p.attention === 1 ? "s" : ""} attention` : p.client_name}</span>
            </span>
            {p.id === project?.id && <Check size={16} />}
          </button>
        ))}
        <button onClick={() => go("/connect?new=1")} className="flex h-12 w-full items-center gap-3 rounded-md px-2 text-body-m text-fg-secondary hover:bg-hover hover:text-fg">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-line"><Plus size={16} /></span> New workspace
        </button>
      </div>
      <div className="my-3 h-px bg-line-subtle" />
      <p className="eyebrow px-1 pb-1">This workspace</p>
      {[
        { label: "Sources", to: `/w/${projectId}/sources`, icon: Plug },
        { label: "Files", to: `/w/${projectId}/files`, icon: Folder },
        { label: "Members", to: `/w/${projectId}/settings/members`, icon: Users },
        { label: "Workspace settings", to: `/w/${projectId}/settings/workspace`, icon: SettingsIcon },
      ].map((r) => (
        <button key={r.label} onClick={() => go(r.to)} className="flex h-12 w-full items-center gap-3 rounded-md px-2 text-body-m text-fg-secondary hover:bg-hover hover:text-fg">
          <r.icon size={18} strokeWidth={1.75} /> {r.label}
        </button>
      ))}
      <div className="my-3 h-px bg-line-subtle" />
      <p className="eyebrow px-1 pb-1">Account</p>
      {[
        { label: "Profile", to: `/w/${projectId}/settings/profile`, icon: User },
        { label: "Notifications", to: `/w/${projectId}/settings/notifications`, icon: Bell },
        { label: "Billing", to: `/w/${projectId}/settings/billing`, icon: CreditCard },
        { label: "Privacy & data", to: `/w/${projectId}/settings/privacy`, icon: ShieldCheck },
      ].map((r) => (
        <button key={r.label} onClick={() => go(r.to)} className="flex h-12 w-full items-center gap-3 rounded-md px-2 text-body-m text-fg-secondary hover:bg-hover hover:text-fg">
          <r.icon size={18} strokeWidth={1.75} /> {r.label}
        </button>
      ))}
      <div className="my-3 h-px bg-line-subtle" />
      <div className="flex items-center gap-3 px-2 pb-2">
        <Avatar name={user?.name} email={user?.email} src={user?.picture} />
        <div className="flex-1 min-w-0">
          <p className="truncate text-body-m text-fg">{user?.name}</p>
          <p className="truncate text-body-s text-fg-tertiary">{user?.email}</p>
        </div>
        <IconButton icon={LogOut} label="Sign out" size="l" onClick={async () => { await logout(); navigate("/login"); }} />
      </div>
    </Sheet>
  );
}

/* Pushed screens on mobile (Figma › Mobile sub-header): back, centred title,
   optional ⋯ — the tab bar and workspace header are hidden. */
const PUSH = [/\/review(\/|$)/, /\/resolve\//, /\/conversations\/[^/]+/, /\/sources\/[^/]+/, /\/files\/[^/]+/, /\/settings/, /\/timeline\/[^/]+/, /[?&]item=/, /[?&]person=/, /^\/w\/[^/]+\/(?!review|resolve|memory|conversations|ask|timeline|sources|files|settings)[^/]+/];
export const isPushRoute = (loc) => PUSH.some((r) => r.test(loc.pathname + loc.search));

export function MobileSubHeader({ title, onBack, actions }) {
  const navigate = useNavigate();
  return (
    <header className="flex h-14 shrink-0 items-center gap-1 border-b border-line-subtle bg-app px-1">
      <IconButton icon={ArrowLeft} label="Back" size="l" onClick={onBack || (() => navigate(-1))} />
      <h1 className="min-w-0 flex-1 truncate text-center text-body-m font-medium text-fg">{title}</h1>
      <div className="flex w-11 justify-end">{actions}</div>
    </header>
  );
}

/* ───────────────────────── Shell ───────────────────────── */
export default function AppShell({ children }) {
  const mobile = useIsMobile();
  const wide = useMedia("(min-width: 1280px)");
  const desktop = useMedia("(min-width: 1024px)");
  const xl = useMedia("(min-width: 1440px)");
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem("bk.nav.collapsed") === "1"; } catch { return false; }
  });
  const [drawer, setDrawer] = useState(false);
  const [sheet, setSheet] = useState(false);
  const location = useLocation();
  useEffect(() => { setDrawer(false); }, [location.pathname]);
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") { e.preventDefault(); toggle(); }
      if (e.key === "Escape") setDrawer(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const toggle = () => {
    if (!wide) { setDrawer((d) => !d); return; }
    setCollapsed((c) => {
      try { localStorage.setItem("bk.nav.collapsed", c ? "0" : "1"); } catch { /* storage unavailable */ }
      return !c;
    });
  };

  if (mobile) {
    const push = isPushRoute(location);
    return (
      <div className="bk flex h-[100dvh] flex-col bg-app">
        <DemoBar />
        {!push && <MobileHeader onOpenSheet={() => setSheet(true)} />}
        {!push && <WorkspaceBanner />}
        <main className="flex-1 min-h-0 overflow-hidden">{children}</main>
        {!push && <TabBar />}
        <WorkspaceSheet open={sheet} onOpenChange={setSheet} />
      </div>
    );
  }

  const rail = desktop && (!wide || collapsed);
  const fullWidth = xl ? 260 : 232;
  return (
    <div className="bk flex h-[100dvh] flex-col bg-app">
      <DemoBar />
      <div className="flex flex-1 min-h-0">
        {desktop && <Sidebar rail={rail} width={rail ? 64 : fullWidth} />}
        <AnimatePresence>
          {drawer && (
            <motion.div className="fixed inset-0 z-40 flex" role="dialog" aria-modal="true" aria-label="Navigation" initial="closed" animate="open" exit="closed">
              <motion.div variants={{ open: { x: 0 }, closed: { x: "-100%" } }} transition={T.base} className="h-full shadow-overlay">
                <Sidebar width={fullWidth} onNavigate={(e) => { if (e.target.closest("a")) setDrawer(false); }} />
              </motion.div>
              <motion.button variants={{ open: { opacity: 1 }, closed: { opacity: 0 } }} transition={T.base} className="flex-1 bg-overlay" aria-label="Close navigation" onClick={() => setDrawer(false)} />
            </motion.div>
          )}
        </AnimatePresence>
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar onToggleNav={toggle} compact={!desktop} navLabel={!wide ? (drawer ? "Close navigation" : "Open navigation") : collapsed ? "Expand sidebar" : "Collapse sidebar"} />
          <WorkspaceBanner />
          <main className="flex-1 min-h-0 overflow-hidden">{children}</main>
        </div>
      </div>
    </div>
  );
}

export { sinceShort, ago };
