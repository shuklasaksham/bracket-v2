import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "./api";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get("/auth/me");
      setUser(data);
      return data;
    } catch {
      setUser(null);
      return null;
    }
    // `api` is a module-level singleton (axios instance); `setUser` is a
    // useState setter with stable identity per React docs. Neither belongs
    // in deps. The empty array is deliberate.
  }, []);

  useEffect(() => {
    // If we're in the middle of an Emergent Google callback, AuthCallback
    // handles things — don't race a /me check that's guaranteed to 401.
    if (typeof window !== "undefined" && window.location.hash?.includes("session_id=")) {
      setLoading(false);
      return;
    }
    refresh().finally(() => setLoading(false));
    // `refresh` is memoized with [] above (stable); `setLoading` is a
    // useState setter (stable). Only `refresh` needs to be acknowledged.
  }, [refresh]);

  const logout = useCallback(async () => {
    try {
      await api.post("/auth/logout");
    } catch {
      // Best-effort: even if the network is down, we still want to clear
      // local user state and let them out. Logging here would spam on
      // every offline logout.
    }
    setUser(null);
    // Same rationale as `refresh` above — module-level `api`, stable
    // `setUser` from useState; empty deps is correct.
  }, []);

  return (
    <AuthCtx.Provider value={{ user, setUser, loading, refresh, logout }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
