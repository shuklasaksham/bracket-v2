import React, { useEffect } from "react";
import AppSidebar from "./AppSidebar";
import MobileTabBar from "./MobileTabBar";
import { useAuth } from "../lib/AuthContext";
import { enablePushNotifications } from "../lib/push";

/**
 * AppShell — layout for authenticated routes (/app, /settings, /project/*).
 * Desktop: collapsible left sidebar. Mobile (≤768px): sidebar is hidden and
 * an app-style bottom tab bar takes over (CSS-driven swap).
 */
export default function AppShell({ children }) {
  const { user } = useAuth();
  useEffect(() => {
    if (user) enablePushNotifications();
  }, [user]);
  return (
    <div className="app-shell" data-testid="app-shell">
      <AppSidebar />
      <main className="app-shell-main">{children}</main>
      <MobileTabBar />
    </div>
  );
}
