import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, isPending } from "./data";

/* WorkspaceProvider — one Bracket "workspace" == one backend project.
   Loads the project + memory + connections + history once and shares them
   with every workspace screen (Overview, Review, Memory, Conversations, Ask,
   Timeline, Sources). Screens call `refresh(...)` after mutations. */

const Ctx = createContext(null);

export function WorkspaceProvider({ projectId, children }) {
  const [project, setProject] = useState(null);
  const [memory, setMemory] = useState(null); // { grouped, counts, total }
  const [connections, setConnections] = useState(null);
  const [notes, setNotes] = useState(null);
  const [history, setHistory] = useState(null);
  const [lastSeen, setLastSeen] = useState(undefined);
  const [error, setError] = useState(null);
  const seenFor = useRef(null);

  const loadProject = useCallback(async () => {
    const { data } = await api.get(`/projects/${projectId}`);
    setProject(data);
    return data;
  }, [projectId]);
  const loadMemory = useCallback(async () => {
    const { data } = await api.get(`/projects/${projectId}/memory`);
    setMemory(data);
    return data;
  }, [projectId]);
  const loadConnections = useCallback(async () => {
    const [c, n] = await Promise.all([
      api.get(`/projects/${projectId}/connections`),
      api.get(`/projects/${projectId}/notes`).catch(() => ({ data: { notes: [] } })),
    ]);
    setConnections(c.data.connections || []);
    setNotes(n.data.notes || []);
    return c.data.connections;
  }, [projectId]);
  const loadHistory = useCallback(async () => {
    const { data } = await api.get(`/projects/${projectId}/history?limit=120`);
    setHistory(data.entries || []);
    return data.entries;
  }, [projectId]);

  const refresh = useCallback(
    async (...parts) => {
      const all = parts.length === 0;
      const jobs = [];
      if (all || parts.includes("project")) jobs.push(loadProject());
      if (all || parts.includes("memory")) jobs.push(loadMemory());
      if (all || parts.includes("connections")) jobs.push(loadConnections());
      if (all || parts.includes("history")) jobs.push(loadHistory());
      try {
        await Promise.all(jobs);
        setError(null);
      } catch (e) {
        setError(e);
      }
    },
    [loadProject, loadMemory, loadConnections, loadHistory],
  );

  useEffect(() => {
    setProject(null); setMemory(null); setConnections(null); setNotes(null); setHistory(null); setError(null);
    refresh();
    // Record the visit; keep the PREVIOUS timestamp for "Since your last visit".
    if (seenFor.current !== projectId) {
      seenFor.current = projectId;
      api.post(`/projects/${projectId}/seen`).then(({ data }) => setLastSeen(data?.previous || null)).catch(() => setLastSeen(null));
    }
  }, [projectId, refresh]);

  // Background freshness: poll lightweight data every 60s while visible.
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") refresh("memory", "connections", "history");
    }, 60000);
    return () => clearInterval(t);
  }, [refresh]);

  const items = useMemo(() => {
    if (!memory?.grouped) return [];
    return Object.values(memory.grouped).flat();
  }, [memory]);
  const pending = useMemo(() => items.filter(isPending), [items]);

  const value = {
    projectId, project, memory, items, pending, connections, notes, history, lastSeen, error,
    refresh, setProject, setMemory,
    loading: !project && !error,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWorkspace must be used inside <WorkspaceProvider>");
  return ctx;
}

/* Projects list (workspace switcher, settings). Shared module-level cache so
   the switcher doesn't refetch on every navigation. */
let _projectsCache = null;
const _subs = new Set();
export async function fetchProjects(force = false) {
  if (_projectsCache && !force) return _projectsCache;
  const { data } = await api.get("/projects");
  _projectsCache = Array.isArray(data) ? data : [];
  _subs.forEach((fn) => fn(_projectsCache));
  return _projectsCache;
}
export function useProjects() {
  const [list, setList] = useState(_projectsCache);
  useEffect(() => {
    _subs.add(setList);
    fetchProjects().then(setList).catch(() => setList([]));
    return () => _subs.delete(setList);
  }, []);
  return { projects: list, reload: () => fetchProjects(true) };
}
