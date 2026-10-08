import React, { useEffect } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../lib/AuthContext";
import { api } from "../lib/data";
import { Mark } from "./Logo";

export function FullScreenLoader({ label = "Loading" }) {
  return (
    <div className="bk flex min-h-[100dvh] items-center justify-center bg-app" role="status" aria-label={label}>
      <Mark size={28} className="animate-pulse opacity-80" />
    </div>
  );
}

/* Signed-in only. Sends people to /login?next=… */
export function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullScreenLoader />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return children;
}

/* v2: every account starts on a 14-day trial, so there is no paywall before
   the app. An expired trial is handled inside the app (read-only + banner). */
export function RequirePlan({ children }) {
  return children;
}

export const Tool = ({ children }) => (
  <RequireAuth>
    <RequirePlan>{children}</RequirePlan>
  </RequireAuth>
);

/* /app — jump into the most recent real workspace, or first-run setup. */
export function AppEntry() {
  const navigate = useNavigate();
  useEffect(() => {
    let off = false;
    api.get("/projects")
      .then(({ data }) => {
        if (off) return;
        const list = (Array.isArray(data) ? data : []).filter((p) => p && p.id && !p.archived);
        const target = list.find((p) => !p.is_demo) || list[0];
        navigate(target ? `/w/${target.id}` : "/welcome", { replace: true });
      })
      .catch(() => !off && navigate("/welcome", { replace: true }));
    return () => { off = true; };
  }, [navigate]);
  return <FullScreenLoader />;
}

/* Back-compat: /project/:id → /w/:id */
export function LegacyProjectRedirect({ match }) {
  const id = window.location.pathname.split("/")[2];
  return <Navigate to={`/w/${id}`} replace />;
}

/* /settings[/:section] — settings live inside a workspace in v2; send people to
   the most recent workspace's settings. */
export function SettingsRedirect() {
  const navigate = useNavigate();
  const section = window.location.pathname.split("/")[2] || "profile";
  useEffect(() => {
    let off = false;
    api.get("/projects")
      .then(({ data }) => {
        if (off) return;
        const list = (Array.isArray(data) ? data : []).filter((p) => p && p.id && !p.archived);
        const map = { workspaces: "workspace", account: "profile" };
        navigate(list[0] ? `/w/${list[0].id}/settings/${map[section] || section}` : "/welcome", { replace: true });
      })
      .catch(() => !off && navigate("/welcome", { replace: true }));
    return () => { off = true; };
  }, [navigate, section]);
  return <FullScreenLoader />;
}
