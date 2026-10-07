import React from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { LayoutGrid, Plus, Settings as SettingsIcon, ShieldCheck } from "lucide-react";
import { useAuth } from "../lib/AuthContext";

/**
 * MobileTabBar — app-style bottom navigation shown ONLY on phones (≤768px,
 * via CSS). Replaces the sidebar rail so the full viewport width belongs to
 * content. Center "New" action focuses the dashboard paste box.
 */
export default function MobileTabBar() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const path = location.pathname;

  const isDashActive = path === "/app" || path.startsWith("/project/");
  const isSettingsActive = path === "/settings";
  const isAdminActive = path.startsWith("/admin");

  const onNew = () => {
    navigate("/app");
    setTimeout(() => {
      const el = document.querySelector('[data-testid="dashboard-hero-paste-input"]');
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.focus({ preventScroll: true });
      }
    }, 350);
  };

  return (
    <nav className="mobile-tabbar" aria-label="Primary" data-testid="mobile-tabbar">
      <Link
        to="/app"
        className={`mobile-tab ${isDashActive ? "is-active" : ""}`}
        data-testid="mobile-tab-dashboard"
      >
        <LayoutGrid size={20} strokeWidth={1.75} />
        <span>Projects</span>
      </Link>
      <button
        type="button"
        onClick={onNew}
        className="mobile-tab mobile-tab--new"
        data-testid="mobile-tab-new"
        aria-label="New project"
      >
        <span className="mobile-tab-new-circle">
          <Plus size={22} strokeWidth={2} />
        </span>
        <span>New</span>
      </button>
      {user?.is_admin && (
        <Link
          to="/admin"
          className={`mobile-tab ${isAdminActive ? "is-active" : ""}`}
          data-testid="mobile-tab-admin"
        >
          <ShieldCheck size={20} strokeWidth={1.75} />
          <span>Admin</span>
        </Link>
      )}
      <Link
        to="/settings"
        className={`mobile-tab ${isSettingsActive ? "is-active" : ""}`}
        data-testid="mobile-tab-settings"
      >
        <SettingsIcon size={20} strokeWidth={1.75} />
        <span>Settings</span>
      </Link>
    </nav>
  );
}
