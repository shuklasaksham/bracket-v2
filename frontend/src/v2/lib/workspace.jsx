import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { v2 } from "./api2";
import { useBilling, useOnline } from "./account";

/* WorkspaceProvider — shared, lightweight state for the current workspace:
   the workspace record (role, status, counts), its sources (for the sidebar)
   and memory categories. Each screen loads its own detail data; after a
   mutation it calls `refresh()` so counts in the shell stay correct. */

const Ctx = createContext(null);

export function WorkspaceProvider({ projectId, children }) {
  const [workspace, setWorkspace] = useState(null);
  const [sources, setSources] = useState(null);
  const [connectors, setConnectors] = useState([]);
  const [categories, setCategories] = useState(null);
  const [lastSeen, setLastSeen] = useState(undefined);
  const [error, setError] = useState(null);
  const seenFor = useRef(null);

  const refresh = useCallback(async () => {
    try {
      const [w, s, c] = await Promise.all([v2.workspace(projectId), v2.sources(projectId), v2.categories(projectId)]);
      setWorkspace(w);
      setSources(s.sources || []);
      setConnectors(s.connectors || []);
      setCategories(c.categories || []);
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, [projectId]);

  useEffect(() => {
    setWorkspace(null); setSources(null); setCategories(null); setError(null);
    refresh();
    if (seenFor.current !== projectId) {
      seenFor.current = projectId;
      v2.seen(projectId).then((d) => setLastSeen(d?.previous || null)).catch(() => setLastSeen(null));
    }
  }, [projectId, refresh]);

  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") refresh(); }, 30000);
    const onFocus = () => refresh();
    window.addEventListener("bk:refresh", onFocus);
    return () => { clearInterval(t); window.removeEventListener("bk:refresh", onFocus); };
  }, [refresh]);

  const online = useOnline();
  const { billing } = useBilling();
  const readOnly = !online ? "offline" : billing?.status === "expired" ? "trial_ended" : workspace?.read_only || null;
  const value = useMemo(() => ({
    projectId, workspace, project: workspace, sources, connectors, categories, lastSeen, error, refresh, setWorkspace,
    counts: workspace?.counts || {}, readOnly, canEdit: !readOnly, role: workspace?.role,
    loading: !workspace && !error,
      online,
  }), [projectId, workspace, sources, connectors, categories, lastSeen, error, refresh, readOnly, online]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWorkspace must be used inside <WorkspaceProvider>");
  return ctx;
}
export function useOptionalWorkspace() {
  return useContext(Ctx);
}

/* Ask every mounted workspace screen + shell to refetch (after mutations). */
export const refreshAll = () => window.dispatchEvent(new Event("bk:refresh"));

/* Workspace list (switcher, settings). Module-level cache. */
let _cache = null;
const _subs = new Set();
export async function fetchProjects(force = false) {
  if (_cache && !force) return _cache;
  const data = await v2.workspaces();
  _cache = data;
  _subs.forEach((fn) => fn(_cache));
  return _cache;
}
export function useProjects() {
  const [data, setData] = useState(_cache);
  useEffect(() => {
    _subs.add(setData);
    fetchProjects().then(setData).catch(() => setData({ workspaces: [], limit: null }));
    return () => _subs.delete(setData);
  }, []);
  return { projects: data?.workspaces || null, limit: data?.limit || null, reload: () => fetchProjects(true) };
}
