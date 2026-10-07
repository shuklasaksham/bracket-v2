import React, { useEffect, useMemo, useState } from "react";
import { NavLink, Link, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  LayoutGrid, Layers, MessagesSquare, History, Plus, MessageCircleQuestion, Folder, PanelLeft, Search,
  ChevronDown, Settings as SettingsIcon, LogOut, CreditCard, Check, Plug, Archive, Bell,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { useAuth } from "../../lib/AuthContext";
import { useWorkspace, useProjects } from "../lib/workspace";
import { shortTime } from "../lib/data";
import { Avatar, IconButton, Kbd, SourceMark, SyncStatus, initialsOf } from "../ui/primitives";
import { Menu, MenuTrigger, MenuContent, MenuItem, MenuLabel, MenuSeparator, Sheet, Tooltip } from "../ui/overlays";
import { useIsMobile, useIsRail, useIsCompact } from "../lib/useMedia";
import { Logo, Mark } from "./Logo";
import NotificationsButton from "./Notifications";
import { useCommand } from "./CommandPalette";
import { useAskPanel } from "./AskPanel";
import DemoBar from "./DemoBar";

const NAV = [
  { to: "", label: "Overview", icon: LayoutGrid, end: true },
  { to: "memory", label: "Memory", icon: Layers, countKey: "pending" },
  { to: "conversations", label: "Conversations", icon: MessagesSquare },
  { to: "timeline", label: "Timeline", icon: History },
];

/* ───────────────────────── Workspace switcher ───────────────────────── */
function WorkspaceSwitcher({ compact }) {
  const { project } = useWorkspace();
  const { projects } = useProjects();
  const navigate = useNavigate();
  const active = (projects || []).filter((p) => !p.archived);
  const client = project?.client_name || "";
  const name = project?.name || "Workspace";
  return (
    <Menu>
      <MenuTrigger asChild>
        <button className="flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 hover:bg-hover transition-colors duration-fast" aria-label="Switch workspace">
          <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-raised border border-line text-[10px] font-semibold text-fg">
            {initialsOf(client || name)}
          </span>
          {!compact && client && <span className="hidden md:inline text-body-m text-fg-tertiary truncate max-w-[160px]">{client}</span>}
          {!compact && client && <span className="hidden md:inline text-fg-disabled">/</span>}
          <span className="text-body-m text-fg truncate max-w-[220px] md:max-w-[300px]">{name}</span>
          <ChevronDown size={14} className="shrink-0 text-fg-tertiary" />
        </button>
      </MenuTrigger>
      <MenuContent align="start" className="w-[300px]">
        <MenuLabel>Workspaces</MenuLabel>
        <div className="max-h-[320px] overflow-y-auto">
          {active.map((p) => (
            <MenuItem key={p.id} onSelect={() => navigate(`/w/${p.id}`)} checked={p.id === project?.id}>
              {p.name || "Untitled"}
              {p.is_demo ? <span className="ml-2 text-body-s text-fg-tertiary">Demo</span> : null}
            </MenuItem>
          ))}
        </div>
        <MenuSeparator />
        <MenuItem icon={Plus} onSelect={() => navigate("/connect?new=1")}>New workspace</MenuItem>
        <MenuItem icon={Archive} onSelect={() => navigate("/settings/workspaces")}>All workspaces</MenuItem>
      </MenuContent>
    </Menu>
  );
}

/* ───────────────────────── User menu ───────────────────────── */
function UserMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <Menu>
      <MenuTrigger asChild>
        <button className="rounded-full focus-visible:outline-offset-2" aria-label="Account menu">
          <Avatar name={user?.name} email={user?.email} src={user?.picture} />
        </button>
      </MenuTrigger>
      <MenuContent className="w-[240px]">
        <div className="px-2 py-2">
          <p className="text-title-s text-fg truncate">{user?.name || "Your account"}</p>
          <p className="text-body-s text-fg-tertiary truncate">{user?.email}</p>
        </div>
        <MenuSeparator />
        <MenuItem icon={SettingsIcon} onSelect={() => navigate("/settings")}>Settings</MenuItem>
        <MenuItem icon={CreditCard} onSelect={() => navigate("/settings/billing")}>Billing</MenuItem>
        <MenuItem icon={Plug} onSelect={() => navigate("/connect")}>Connect a tool</MenuItem>
        <MenuSeparator />
        <MenuItem icon={LogOut} onSelect={async () => { await logout(); navigate("/login"); }}>Sign out</MenuItem>
      </MenuContent>
    </Menu>
  );
}

/* ───────────────────────── Sidebar ───────────────────────── */
function SidebarItem({ to, end, icon: Icon, label, count, rail, dot }) {
  const link = (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          "group flex items-center gap-2.5 rounded-md text-body-m transition-colors duration-fast",
          rail ? "h-9 w-9 justify-center mx-auto" : "h-8 px-2",
          isActive ? "bg-selected text-fg" : "text-fg-secondary hover:bg-hover hover:text-fg",
        )
      }
    >
      <span className="relative">
        <Icon size={16} strokeWidth={1.75} />
        {rail && (dot || count > 0) && <span className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-warning" aria-hidden="true" />}
      </span>
      {!rail && <span className="flex-1 truncate">{label}</span>}
      {!rail && count > 0 && <span className="num text-body-s text-fg-tertiary">{count}</span>}
    </NavLink>
  );
  return rail ? <Tooltip content={label} side="right">{link}</Tooltip> : link;
}

function Sidebar({ rail, onNavigate }) {
  const { projectId, pending, connections, notes } = useWorkspace();
  const ask = useAskPanel();
  const base = `/w/${projectId}`;
  const conns = (connections || []).filter((c) => c.provider !== "meeting");
  const unhealthy = conns.filter((c) => c.health && c.health.level && c.health.level !== "green");
  return (
    <nav aria-label="Workspace" className={cn("flex h-full flex-col bg-sidebar border-r border-line-subtle", rail ? "w-16" : "w-nav")} onClick={onNavigate}>
      <div className={cn("flex h-14 items-center shrink-0", rail ? "justify-center" : "px-4")}>
        {rail ? <Link to="/app" aria-label="Bracket home"><Mark size={22} /></Link> : <Logo to="/app" />}
      </div>
      <div className="scroll-pane flex-1 px-2 pb-3">
        {!rail && <p className="eyebrow px-2 pt-3 pb-1.5">Workspace</p>}
        <div className={cn("space-y-0.5", rail && "pt-2")}>
          {NAV.map((n) => (
            <SidebarItem key={n.label} to={`${base}${n.to ? "/" + n.to : ""}`} end={n.end} icon={n.icon} label={n.label} rail={rail} count={n.countKey === "pending" ? pending.length : 0} />
          ))}
        </div>

        {!rail ? (
          <div className="flex items-center justify-between px-2 pt-5 pb-1.5">
            <p className="eyebrow">Sources</p>
            <Link to={`${base}/sources?add=1`} className="text-fg-tertiary hover:text-fg rounded p-0.5" aria-label="Add source">
              <Plus size={14} />
            </Link>
          </div>
        ) : <div className="my-3 mx-3 h-px bg-line-subtle" />}
        <div className="space-y-0.5">
          {conns.map((c) => (
            rail ? (
              <Tooltip key={c.id} content={c.source_name} side="right">
                <NavLink to={`${base}/sources?c=${c.id}`} className="flex h-9 w-9 mx-auto items-center justify-center rounded-md hover:bg-hover">
                  <SourceMark provider={c.provider} size={15} />
                </NavLink>
              </Tooltip>
            ) : (
              <NavLink key={c.id} to={`${base}/sources?c=${c.id}`} className="flex h-8 items-center gap-2.5 rounded-md px-2 text-body-m text-fg-secondary hover:bg-hover hover:text-fg">
                <SourceMark provider={c.provider} size={15} />
                <span className="flex-1 truncate">{c.source_name}</span>
                <span className="text-body-s text-fg-tertiary num">{shortTime(c.last_activity_at || c.last_synced_at)}</span>
              </NavLink>
            )
          ))}
          {conns.length === 0 && !rail && (
            <Link to={`${base}/sources?add=1`} className="flex h-8 items-center gap-2 rounded-md px-2 text-body-s text-fg-tertiary hover:text-fg hover:bg-hover">
              <Plus size={14} /> Connect a source
            </Link>
          )}
        </div>

        {!rail ? <p className="eyebrow px-2 pt-5 pb-1.5">Tools</p> : <div className="my-3 mx-3 h-px bg-line-subtle" />}
        <div className="space-y-0.5">
          {rail ? (
            <Tooltip content="Ask Bracket ⌘J" side="right">
              <button onClick={() => ask.open()} className="flex h-9 w-9 mx-auto items-center justify-center rounded-md text-fg-secondary hover:bg-hover hover:text-fg" aria-label="Ask Bracket">
                <MessageCircleQuestion size={16} strokeWidth={1.75} />
              </button>
            </Tooltip>
          ) : (
            <SidebarItem to={`${base}/ask`} icon={MessageCircleQuestion} label="Ask Bracket" />
          )}
          <SidebarItem to={`${base}/sources`} icon={Folder} label="Sources & files" rail={rail} count={(notes || []).length} />
        </div>
      </div>
      <div className={cn("shrink-0 border-t border-line-subtle", rail ? "py-3 flex justify-center" : "px-4 py-3")}>
        {rail ? (
          <span className={cn("h-2 w-2 rounded-full", unhealthy.length ? "bg-warning" : "bg-success")} aria-label={unhealthy.length ? "A source needs attention" : "All sources up to date"} />
        ) : unhealthy.length ? (
          <Link to={`${base}/sources`}><SyncStatus state="warning" label={`${unhealthy.length} source${unhealthy.length > 1 ? "s need" : " needs"} attention`} /></Link>
        ) : (
          <SyncStatus state="synced" label={conns.length ? "All sources up to date" : "No sources connected"} />
        )}
      </div>
    </nav>
  );
}

/* ───────────────────────── Top bar (≥768) ───────────────────────── */
function TopBar({ onToggleNav, navHidden, compact }) {
  const cmd = useCommand();
  const location = useLocation();
  const crumb = useMemo(() => {
    const seg = location.pathname.split("/")[3];
    return { memory: "Memory", conversations: "Conversations", timeline: "Timeline", ask: "Ask Bracket", sources: "Sources & files", review: "Review changes" }[seg];
  }, [location.pathname]);
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line-subtle bg-app px-3 md:px-4">
      <IconButton icon={PanelLeft} label={navHidden ? "Show sidebar" : "Hide sidebar"} onClick={onToggleNav} />
      <WorkspaceSwitcher compact={compact} />
      {crumb && !compact && (
        <span className="hidden lg:flex items-center gap-2 text-body-m text-fg-tertiary truncate">
          <span className="text-fg-disabled">/</span>{crumb}
        </span>
      )}
      <div className="flex-1" />
      <button
        onClick={() => cmd.open()}
        className="hidden md:flex h-8 w-[220px] items-center gap-2 rounded-md border border-line-control/50 bg-surface px-2.5 text-body-m text-fg-tertiary hover:border-line-control transition-colors duration-fast"
        aria-label="Search or jump to (Command K)"
      >
        <Search size={14} />
        <span className="flex-1 text-left">Search or jump to…</span>
        <Kbd>⌘K</Kbd>
      </button>
      <IconButton icon={Search} label="Search" className="md:hidden" onClick={() => cmd.open()} />
      <NotificationsButton />
      <UserMenu />
    </header>
  );
}

/* ───────────────────────── Mobile ───────────────────────── */
const TABS = [
  { to: "", label: "Overview", icon: LayoutGrid, end: true },
  { to: "memory", label: "Memory", icon: Layers },
  { to: "ask", label: "Ask", icon: MessageCircleQuestion },
  { to: "conversations", label: "Conversations", icon: MessagesSquare },
  { to: "timeline", label: "Timeline", icon: History },
];
function MobileHeader({ onOpenSheet }) {
  const { project } = useWorkspace();
  const cmd = useCommand();
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line-subtle bg-app px-3">
      <button onClick={onOpenSheet} className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-label="Workspace and account">
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-raised border border-line text-[10px] font-semibold">
          {initialsOf(project?.client_name || project?.name || "")}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-title-s text-fg">{project?.name || "Workspace"}</span>
          {project?.client_name && <span className="block truncate text-body-s text-fg-tertiary">{project.client_name}</span>}
        </span>
        <ChevronDown size={14} className="shrink-0 text-fg-tertiary" />
      </button>
      <IconButton icon={Search} label="Search" size="l" onClick={() => cmd.open()} />
      <NotificationsButton size="l" />
    </header>
  );
}
function TabBar() {
  const { projectId, pending } = useWorkspace();
  const base = `/w/${projectId}`;
  return (
    <nav aria-label="Primary" className="shrink-0 border-t border-line-subtle bg-app safe-bottom pt-1.5">
      <div className="grid grid-cols-5">
        {TABS.map((t) => (
          <NavLink
            key={t.label}
            to={`${base}${t.to ? "/" + t.to : ""}`}
            end={t.end}
            className={({ isActive }) => cn("flex flex-col items-center gap-1 py-1 text-[11px] font-medium", isActive ? "text-fg" : "text-fg-tertiary")}
          >
            <span className="relative">
              <t.icon size={20} strokeWidth={1.75} />
              {t.label === "Memory" && pending.length > 0 && <span className="absolute -right-1 -top-0.5 h-1.5 w-1.5 rounded-full bg-warning" />}
            </span>
            {t.label}
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
        {(projects || []).filter((p) => !p.archived).map((p) => (
          <button key={p.id} onClick={() => go(`/w/${p.id}`)} className="flex w-full items-center gap-3 rounded-md px-2 py-2.5 text-left hover:bg-hover">
            <span className="flex-1 min-w-0">
              <span className="block truncate text-body-m text-fg">{p.name}</span>
            </span>
            {p.id === project?.id && <Check size={16} />}
          </button>
        ))}
      </div>
      <div className="my-3 h-px bg-line-subtle" />
      {[
        { label: "Sources & files", to: `/w/${projectId}/sources`, icon: Folder },
        { label: "Settings", to: "/settings", icon: SettingsIcon },
        { label: "Notifications", to: "/settings/notifications", icon: Bell },
        { label: "New workspace", to: "/connect?new=1", icon: Plus },
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

/* ───────────────────────── Shell ───────────────────────── */
export default function AppShell({ children }) {
  const mobile = useIsMobile();
  const rail = useIsRail();
  const [navHidden, setNavHidden] = useState(() => {
    try { return localStorage.getItem("bk.nav.hidden") === "1"; } catch { return false; }
  });
  const [drawer, setDrawer] = useState(false); // tablet nav drawer
  const [sheet, setSheet] = useState(false);
  const location = useLocation();
  useEffect(() => { setDrawer(false); }, [location.pathname]);
  const tablet = useIsCompact() && !mobile;

  const toggle = () => {
    if (tablet) { setDrawer((d) => !d); return; }
    setNavHidden((h) => {
      try { localStorage.setItem("bk.nav.hidden", h ? "0" : "1"); } catch { /* ignore */ }
      return !h;
    });
  };

  if (mobile) {
    return (
      <div className="bk flex h-[100dvh] flex-col bg-app">
        <DemoBar />
        <MobileHeader onOpenSheet={() => setSheet(true)} />
        <main className="scroll-pane flex-1 min-h-0">{children}</main>
        <TabBar />
        <WorkspaceSheet open={sheet} onOpenChange={setSheet} />
      </div>
    );
  }
  return (
    <div className="bk flex h-[100dvh] flex-col bg-app">
      <DemoBar />
      <div className="flex flex-1 min-h-0">
        {!tablet && !navHidden && <Sidebar rail={rail} />}
        {tablet && drawer && (
          <div className="fixed inset-0 z-40 flex" role="dialog" aria-modal="true" aria-label="Navigation">
            <div className="animate-slide-in-right [animation-direction:reverse] shadow-overlay"><Sidebar onNavigate={(e) => { if (e.target.closest("a")) setDrawer(false); }} /></div>
            <button className="flex-1 bg-overlay" aria-label="Close navigation" onClick={() => setDrawer(false)} />
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar onToggleNav={toggle} navHidden={tablet ? !drawer : navHidden} compact={tablet} />
          <main className="flex-1 min-h-0 overflow-hidden">{children}</main>
        </div>
      </div>
    </div>
  );
}
