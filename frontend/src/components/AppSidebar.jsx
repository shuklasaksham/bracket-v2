import React, { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutGrid,
  LogOut,
  PanelLeftClose,
  PanelLeft,
  Plug,
  Activity as ActivityIcon,
  ShieldCheck,
  Settings as SettingsIcon,
  HelpCircle,
} from "lucide-react";
import Avatar from "./Avatar";
import { useAuth } from "../lib/AuthContext";
import { api } from "../lib/api";

const BRACKET_LOGO =
  "https://customer-assets-lqy194kg.emergentagent.net/job_design-decided/artifacts/jl2k3bid_new-logo-1.png";

const STORAGE_KEY = "bracket.sidebar.collapsed";

function NavItem({ to, icon: Icon, label, collapsed, active, end, dataTestId, onClick, badge }) {
  const showBadge = typeof badge === "number" && badge > 0;
  const content = (
    <>
      <span className="nav-icon" aria-hidden="true">
        <Icon size={16} strokeWidth={1.75} />
        {showBadge && collapsed && (
          <span className="nav-badge nav-badge--dot" aria-hidden="true" />
        )}
      </span>
      {!collapsed && <span className="nav-label">{label}</span>}
      {showBadge && !collapsed && (
        <span className="nav-badge" data-testid={`${dataTestId}-badge`}>
          {badge > 9 ? "9+" : badge}
        </span>
      )}
      {active && <span className="nav-active-bar" aria-hidden="true" />}
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`nav-item ${active ? "is-active" : ""}`}
        title={collapsed ? label : undefined}
        data-testid={dataTestId}
      >
        {content}
      </button>
    );
  }
  return (
    <Link
      to={to}
      end={end ? "true" : undefined}
      className={`nav-item ${active ? "is-active" : ""}`}
      title={collapsed ? label : undefined}
      data-testid={dataTestId}
    >
      {content}
    </Link>
  );
}

export default function AppSidebar() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const [collapsed, setCollapsed] = useState(() => {
    try {
      if (typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches) return true;
      return localStorage.getItem(STORAGE_KEY) === "1";
    } catch { return false; }
  });
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const onChange = (e) => {
      setIsMobile(e.matches);
      if (e.matches) setCollapsed(true);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  useEffect(() => {
    try { if (!isMobile) localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0"); } catch { /* ignore */ }
    document.documentElement.style.setProperty(
      "--sidebar-w",
      isMobile ? "52px" : (collapsed ? "76px" : "280px")
    );
  }, [collapsed, isMobile]);

  const path = location.pathname;

  // Activity unread badge — "new changes since you last opened Activity".
  // Compares the rolling 7d digest total against the count last seen on the
  // Activity page (persisted in localStorage, updated via 'activity-seen').
  const ACT_SEEN_KEY = "bracket.activity.seenTotal";
  const [activityUnread, setActivityUnread] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const compute = async () => {
      try {
        const { data } = await api.get("/connect/digest?window=7d");
        if (cancelled) return;
        const total = data?.total || 0;
        const seen = Number(localStorage.getItem(ACT_SEEN_KEY) || "0");
        setActivityUnread(Math.max(0, total - seen));
      } catch { /* ignore */ }
    };
    compute();
    const id = setInterval(compute, 45000);
    const onSeen = () => setActivityUnread(0);
    window.addEventListener("activity-seen", onSeen);
    return () => { cancelled = true; clearInterval(id); window.removeEventListener("activity-seen", onSeen); };
  }, []);
  const isProjectsActive =
    path === "/app" || path === "/app/new" || path.startsWith("/project/");
  const isSettingsActive = path === "/settings";
  const isAdminActive = path.startsWith("/admin");

  const isAdmin = !!user?.is_admin;

  const onLogout = async () => {
    await logout();
    navigate("/", { replace: true });
  };

  return (
    <aside
      className={`app-sidebar ${collapsed ? "is-collapsed" : ""}`}
      data-testid="app-sidebar"
      data-collapsed={collapsed ? "1" : "0"}
    >
      {/* Brand + collapse toggle */}
      <div className="sidebar-brand">
        <Link to="/app" className="brand-mark" data-testid="sidebar-brand" aria-label="Bracket">
          <img src={BRACKET_LOGO} alt="" width={28} height={28} style={{ display: "block" }} />
          <span className="brand-text">bracket.</span>
        </Link>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="collapse-btn"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand" : "Collapse"}
          data-testid="sidebar-collapse-toggle"
        >
          {collapsed ? <PanelLeft size={14} /> : <PanelLeftClose size={14} />}
        </button>
      </div>

      {/* Workspace section label */}
      {!collapsed && (
        <div className="sidebar-section-label">Workspace</div>
      )}

      {/* Primary nav */}
      <nav className="sidebar-nav" aria-label="Primary">
        <NavItem
          to="/app"
          icon={LayoutGrid}
          label="Dashboard"
          collapsed={collapsed}
          active={isProjectsActive}
          dataTestId="sidebar-nav-dashboard"
        />
        <NavItem
          to="/app/activity"
          icon={ActivityIcon}
          label="Activity"
          collapsed={collapsed}
          active={path.startsWith("/app/activity")}
          dataTestId="sidebar-nav-activity"
          badge={activityUnread}
        />
        <NavItem
          to="/app/connect"
          icon={Plug}
          label="Connect Work"
          collapsed={collapsed}
          active={path.startsWith("/app/connect")}
          dataTestId="sidebar-nav-connect"
        />
      </nav>

      {/* Account section */}
      {!collapsed && (
        <div className="sidebar-section-label mt-5">Account</div>
      )}
      <nav className="sidebar-nav" aria-label="Account">
        <NavItem
          to="/settings"
          icon={SettingsIcon}
          label="Settings"
          collapsed={collapsed}
          active={isSettingsActive}
          dataTestId="sidebar-nav-settings"
        />
        <NavItem
          to="/pricing"
          icon={HelpCircle}
          label="Pricing"
          collapsed={collapsed}
          active={path === "/pricing"}
          dataTestId="sidebar-nav-pricing"
        />
        {isAdmin && (
          <NavItem
            to="/admin"
            icon={ShieldCheck}
            label="Admin"
            collapsed={collapsed}
            active={isAdminActive}
            dataTestId="sidebar-nav-admin"
          />
        )}
      </nav>

      {/* New project CTA removed per design — quick-create lives on the dashboard itself */}

      <div className="sidebar-spacer" />

      {/* Legal links — kept quiet in the sidebar footer */}
      {!collapsed && (
        <div className="sidebar-legal" data-testid="sidebar-legal">
          <Link to="/privacy" className="sidebar-legal-link" data-testid="sidebar-privacy-link">Privacy</Link>
          <span className="sidebar-legal-sep">·</span>
          <Link to="/terms" className="sidebar-legal-link" data-testid="sidebar-terms-link">Terms</Link>
        </div>
      )}

      {/* User card at bottom */}
      {user && (
        <div className={`sidebar-user ${collapsed ? "is-collapsed" : ""}`} data-testid="sidebar-user">
          <Link
            to="/settings"
            className="user-info"
            title={collapsed ? (user.name || user.email) : undefined}
          >
            <Avatar id={user.avatar || "mono-1"} size={28} initial={user.name || user.email} />
            {!collapsed && (
              <div className="user-meta">
                <div className="user-name">{user.name || "—"}</div>
                <div className="user-email">{user.email}</div>
              </div>
            )}
          </Link>
          <button
            type="button"
            onClick={onLogout}
            className="user-logout"
            aria-label="Sign out"
            title="Sign out"
            data-testid="sidebar-logout"
          >
            <LogOut size={14} strokeWidth={1.75} />
          </button>
        </div>
      )}
    </aside>
  );
}
