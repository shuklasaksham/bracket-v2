import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";

/**
 * Hidden admin guard. Renders children ONLY when the signed-in user has
 * `is_admin === true` (computed server-side via ADMIN_EMAILS).
 *
 * For any other case (no session, or signed-in-but-not-admin) we silently
 * redirect to /admin/login so the existence of the admin area is never
 * exposed to non-admins.
 */
export default function ProtectedAdminRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-ink text-chalk">
        <p className="mono-label">LOADING…</p>
      </div>
    );
  }
  if (!user || !user.is_admin) {
    return <Navigate to="/admin/login" replace />;
  }
  return children;
}
