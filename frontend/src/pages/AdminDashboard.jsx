import React, { useEffect, useMemo, useState } from "react";
import {
  Loader2,
  Search,
  ChevronRight,
  ChevronDown,
  KeyRound,
  X as XIcon,
  Check,
  BarChart3,
  Users,
  Trash2,
  UserX,
} from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "../lib/api";
import AdminAnalytics from "./AdminAnalytics";
import AdminProjectDetailModal from "./AdminProjectDetailModal";
import { useDialog } from "../components/Dialog";

const STATUS_TAG = {
  draft:       "bg-[var(--surface-3)] text-[var(--text-3)]",
  in_progress: "bg-[var(--accent)]/12 text-[var(--accent)]",
  locked:      "bg-[color:rgb(34_197_94/0.12)] text-[color:rgb(74_222_128)]",
  completed:   "bg-[color:rgb(34_197_94/0.12)] text-[color:rgb(74_222_128)]",
};

export default function AdminDashboard() {
  const { confirm: confirmDialog } = useDialog();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState(null);
  const [openProjects, setOpenProjects] = useState({});
  const [loadingProjects, setLoadingProjects] = useState({});
  const [resetTarget, setResetTarget] = useState(null); // user obj
  const [resetPw, setResetPw] = useState("");
  const [resetting, setResetting] = useState(false);
  const [tab, setTab] = useState("analytics"); // "analytics" | "users"
  const [detailProjectId, setDetailProjectId] = useState(null);
  const [filterKind, setFilterKind] = useState("all");        // all | guest | registered
  const [filterProjects, setFilterProjects] = useState("any"); // any | none | one | few | many
  const [selected, setSelected] = useState(new Set());        // user_ids checked in the list
  const [confirmDelete, setConfirmDelete] = useState(null);   // { count, dry } | null
  const [deleting, setDeleting] = useState(false);
  const [purging, setPurging] = useState(false);
  const [testPlanOn, setTestPlanOn] = useState(false);
  const [togglingTp, setTogglingTp] = useState(false);
  const [phLaunchOn, setPhLaunchOn] = useState(false);
  const [togglingPh, setTogglingPh] = useState(false);

  useEffect(() => {
    api.get("/admin/test-plan").then(({ data }) => setTestPlanOn(!!data.enabled)).catch(() => {});
    api.get("/admin/ph-launch").then(({ data }) => setPhLaunchOn(!!data.enabled)).catch(() => {});
  }, []);

  const toggleTestPlan = async () => {
    setTogglingTp(true);
    try {
      const { data } = await api.post("/admin/test-plan", { enabled: !testPlanOn });
      setTestPlanOn(!!data.enabled);
      toast.success(`Free ₹0 test plan ${data.enabled ? "enabled for all users" : "disabled"}.`);
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setTogglingTp(false);
    }
  };

  const togglePhLaunch = async () => {
    setTogglingPh(true);
    try {
      const { data } = await api.post("/admin/ph-launch", { enabled: !phLaunchOn });
      setPhLaunchOn(!!data.enabled);
      toast.success(`Product Hunt launch offer ${data.enabled ? "enabled for all users" : "disabled"}.`);
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setTogglingPh(false);
    }
  };

  const load = async () => {
    setLoading(true);
    try {
      const projMap = { any: [0, null], none: [0, 0], one: [1, 1], few: [2, 4], many: [5, null] };
      const [mn, mx] = projMap[filterProjects] || [0, null];
      const params = new URLSearchParams({ kind: filterKind, min_projects: String(mn) });
      if (mx !== null) params.set("max_projects", String(mx));
      const { data } = await api.get(`/admin/users?${params}`);
      setUsers(data.users || []);
    } catch (e) {
      setError(formatApiError(e));
    } finally {
      setLoading(false);
    }
  };
  // Reload when the tab becomes users OR when a filter changes on the users tab.
  useEffect(() => {
    if (tab === "users") load();
  }, [tab, filterKind, filterProjects]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return users;
    return users.filter(
      (u) =>
        (u.email || "").toLowerCase().includes(s) ||
        (u.name || "").toLowerCase().includes(s) ||
        (u.designation || "").toLowerCase().includes(s),
    );
  }, [users, q]);

  const toggle = async (u) => {
    if (openId === u.user_id) {
      setOpenId(null);
      return;
    }
    setOpenId(u.user_id);
    if (!openProjects[u.user_id]) {
      setLoadingProjects((m) => ({ ...m, [u.user_id]: true }));
      try {
        const { data } = await api.get(`/admin/users/${u.user_id}/projects`);
        setOpenProjects((m) => ({ ...m, [u.user_id]: data.projects || [] }));
      } catch (e) {
        toast.error(formatApiError(e));
      } finally {
        setLoadingProjects((m) => ({ ...m, [u.user_id]: false }));
      }
    }
  };

  const doReset = async (e) => {
    e?.preventDefault?.();
    if (!resetTarget) return;
    if (resetPw.length < 8) {
      toast.error("Min 8 characters.");
      return;
    }
    setResetting(true);
    try {
      await api.post(`/admin/users/${resetTarget.user_id}/reset-password`, {
        new_password: resetPw,
      });
      toast.success(`Password reset for ${resetTarget.email}`);
      setResetTarget(null);
      setResetPw("");
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setResetting(false);
    }
  };

  // ─── Bulk selection + deletion ─────────────────────────────────────
  const toggleOne = (uid) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid); else next.add(uid);
      return next;
    });
  };
  const clearSelection = () => setSelected(new Set());
  const allSelected = filtered.length > 0 && filtered.every((u) => selected.has(u.user_id) || u.is_admin);
  const toggleAll = () => {
    if (allSelected) {
      clearSelection();
    } else {
      // Select every non-admin visible row
      setSelected(new Set(filtered.filter((u) => !u.is_admin).map((u) => u.user_id)));
    }
  };
  // Reset selection whenever filters change
  useEffect(() => { clearSelection(); }, [filterKind, filterProjects]);

  const askDelete = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    try {
      const { data } = await api.post("/admin/users/delete", { user_ids: ids, confirm: false });
      setConfirmDelete({ count: data.matched_users, cascade: data.cascade, ids });
    } catch (e) {
      toast.error(formatApiError(e));
    }
  };
  const doDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      const { data } = await api.post("/admin/users/delete", { user_ids: confirmDelete.ids, confirm: true });
      toast.success(`Deleted ${data.deleted?.users || 0} users, ${data.deleted?.projects || 0} projects.`);
      setConfirmDelete(null);
      clearSelection();
      await load();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setDeleting(false);
    }
  };

  const doPurgeGuests = async () => {
    const ok = await confirmDialog({
      title: "Purge all guest users?",
      message: "Delete ALL guest users + their projects across the workspace. This cannot be undone.",
      confirmLabel: "Purge guests",
      cancelLabel: "Cancel",
      tone: "danger",
    });
    if (!ok) return;
    setPurging(true);
    try {
      const { data } = await api.post("/admin/purge-guests");
      const n = data.deleted?.users || 0;
      toast.success(n === 0 ? "No guest users found." : `Purged ${n} guests + ${data.deleted?.projects || 0} projects.`);
      await load();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setPurging(false);
    }
  };

  return (
    <div className="relative min-h-full overflow-clip" data-testid="admin-dashboard-page">
      {/* Cinematic dashboard backdrop — unified with /app. */}
      <div aria-hidden="true" className="hero-ambient hero-ambient--dashboard" />
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10"
        style={{ background: "var(--bg)" }}
      />
      <main className="relative max-w-[1100px] mx-auto px-6 sm:px-8 md:px-10 py-10 md:py-14 page-enter">
        {/* Page intro — matches /app dashboard */}
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <span className="section-label"><span className="dot" />Admin console</span>
            <h1 className="t-hero mt-4">
              Bracket, at a glance.
            </h1>
            <p className="mt-2 text-[14px] text-[var(--text-2)]">
              Everyone using Bracket · every project · every decision.
            </p>
          </div>
          <div className="self-start sm:self-auto flex flex-col sm:flex-row items-start sm:items-center gap-2.5">
          <button
            type="button"
            onClick={togglePhLaunch}
            disabled={togglingPh}
            className="inline-flex items-center gap-2.5 px-4 py-2.5 rounded-full border text-[12.5px] transition-colors disabled:opacity-60"
            style={{ borderColor: phLaunchOn ? "rgba(255,111,60,0.5)" : "var(--hairline)", background: phLaunchOn ? "rgba(255,111,60,0.08)" : "rgba(255,255,255,0.03)" }}
            data-testid="admin-ph-launch-toggle"
            title="Product Hunt launch: when ON, every signed-in user can claim their first project free for 14 days (no card)."
          >
            <span className="text-[var(--text-2)]">🚀 Product Hunt offer</span>
            <span className="inline-flex items-center h-5 w-9 rounded-full transition-colors" style={{ background: phLaunchOn ? "#ff6f3c" : "#3a3a3a" }}>
              <span className="h-4 w-4 rounded-full bg-white transition-transform" style={{ transform: phLaunchOn ? "translateX(18px)" : "translateX(2px)" }} />
            </span>
            <span className="mono-label text-[10px]" style={{ color: phLaunchOn ? "#ff6f3c" : "var(--text-3)" }}>{phLaunchOn ? "ON" : "OFF"}</span>
          </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="mt-8 flex items-center gap-1 border-b border-[var(--hairline)]" data-testid="admin-tabs">
          <button
            type="button"
            onClick={() => setTab("analytics")}
            className={`inline-flex items-center gap-2 px-4 py-2.5 text-[13px] transition-colors ${
              tab === "analytics"
                ? "text-[var(--text)] border-b-2 border-[var(--accent)] -mb-px"
                : "text-[var(--text-3)] hover:text-[var(--text)]"
            }`}
            data-testid="admin-tab-analytics"
          >
            <BarChart3 size={14} /> Analytics
          </button>
          <button
            type="button"
            onClick={() => setTab("users")}
            className={`inline-flex items-center gap-2 px-4 py-2.5 text-[13px] transition-colors ${
              tab === "users"
                ? "text-[var(--text)] border-b-2 border-[var(--accent)] -mb-px"
                : "text-[var(--text-3)] hover:text-[var(--text)]"
            }`}
            data-testid="admin-tab-users"
          >
            <Users size={14} /> Users
          </button>
        </div>

        {tab === "analytics" && <div className="mt-6"><AdminAnalytics /></div>}

        {tab === "users" && (
        <>
        <div className="mt-6 flex items-baseline gap-3">
          <h2 className="font-display text-2xl sm:text-3xl leading-none">
            All users <span className="text-[var(--accent)]">— {users.length}</span>
          </h2>
          <span className="text-[12px] text-[var(--text-3)]">
            · {users.reduce((acc, u) => acc + (u.project_count || 0), 0)} projects total
          </span>
        </div>

        {/* Search */}
        <div className="mt-6 flex items-center gap-2 border-b border-[var(--hairline)] focus-within:border-[var(--accent)] max-w-md transition-colors">
          <Search size={14} className="text-[var(--text-3)]" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search email · name · designation"
            className="flex-1 bg-transparent outline-none py-2 text-[13px] placeholder-[var(--text-3)]"
            data-testid="admin-search-input"
          />
          {q && (
            <button onClick={() => setQ("")} className="text-[var(--text-3)] hover:text-[var(--text)]" data-testid="admin-search-clear">
              <XIcon size={14} />
            </button>
          )}
        </div>

        {/* Filter chips */}
        <div className="mt-4 flex flex-wrap items-center gap-2" data-testid="admin-user-filters">
          <span className="text-[10px] uppercase tracking-wider text-[var(--text-3)] mr-1">Type</span>
          {[
            { k: "all",        label: "All" },
            { k: "guest",      label: "Guests" },
            { k: "registered", label: "Registered" },
          ].map((c) => (
            <button
              key={c.k}
              type="button"
              onClick={() => setFilterKind(c.k)}
              className={`px-3 py-1.5 rounded-full text-[12px] border transition-colors ${
                filterKind === c.k
                  ? "border-[var(--accent)] bg-[var(--accent)]/12 text-[var(--accent)]"
                  : "border-[var(--hairline)] text-[var(--text-2)] hover:text-[var(--text)]"
              }`}
              data-testid={`admin-filter-kind-${c.k}`}
            >
              {c.label}
            </button>
          ))}
          <span className="mx-2 text-[var(--text-3)]">·</span>
          <span className="text-[10px] uppercase tracking-wider text-[var(--text-3)] mr-1">Projects</span>
          {[
            { k: "any",  label: "Any" },
            { k: "none", label: "0" },
            { k: "one",  label: "1" },
            { k: "few",  label: "2–4" },
            { k: "many", label: "5+" },
          ].map((c) => (
            <button
              key={c.k}
              type="button"
              onClick={() => setFilterProjects(c.k)}
              className={`px-3 py-1.5 rounded-full text-[12px] border transition-colors ${
                filterProjects === c.k
                  ? "border-[var(--accent)] bg-[var(--accent)]/12 text-[var(--accent)]"
                  : "border-[var(--hairline)] text-[var(--text-2)] hover:text-[var(--text)]"
              }`}
              data-testid={`admin-filter-projects-${c.k}`}
            >
              {c.label}
            </button>
          ))}
        </div>

        {loading && (
          <div className="mt-8 flex items-center gap-2 text-[13px] text-[var(--text-3)]">
            <Loader2 size={14} className="animate-spin" /> Loading users…
          </div>
        )}

        {error && !loading && (
          <p className="mt-8 text-[13px] text-[var(--danger)]" data-testid="admin-error">{error}</p>
        )}

        {/* Bulk-action toolbar — always visible on the users tab so admins can
            purge guests in one click, or multi-select rows for deletion. */}
        {!loading && !error && (
          <div
            className="mt-6 flex flex-wrap items-center gap-3 px-4 py-3 rounded-lg border border-[var(--hairline)] bg-[var(--surface-2)]/60"
            data-testid="admin-bulk-toolbar"
          >
            <label className="inline-flex items-center gap-2 text-[12px] text-[var(--text-2)] select-none cursor-pointer">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                className="admin-checkbox"
                data-testid="admin-select-all"
              />
              Select all visible ({filtered.filter((u) => !u.is_admin).length})
            </label>
            <span className="text-[var(--text-3)] text-[11px]">·</span>
            <span className="text-[12px] text-[var(--text-2)]" data-testid="admin-selected-count">
              {selected.size} selected
            </span>
            {selected.size > 0 && (
              <button
                type="button"
                onClick={clearSelection}
                className="text-[11px] text-[var(--text-3)] underline hover:text-[var(--text)]"
                data-testid="admin-clear-selection"
              >
                Clear
              </button>
            )}
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={doPurgeGuests}
                disabled={purging}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[var(--hairline)] text-[12px] text-[var(--text-2)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50 transition-colors"
                data-testid="admin-purge-guests"
                title="Delete all guest users + their data"
              >
                {purging ? <Loader2 size={12} className="animate-spin" /> : <UserX size={12} />}
                Purge all guests
              </button>
              <button
                type="button"
                onClick={askDelete}
                disabled={selected.size === 0}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[var(--danger)]/40 text-[12px] text-[var(--danger)] hover:bg-[var(--danger)]/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                data-testid="admin-delete-selected"
              >
                <Trash2 size={12} /> Delete selected
              </button>
            </div>
          </div>
        )}

        {!loading && !error && (
          <ul className="card-brut mt-6 overflow-hidden divide-y divide-[var(--hairline)]" data-testid="admin-user-list">
            {filtered.map((u) => {
              const isOpen = openId === u.user_id;
              const projects = openProjects[u.user_id];
              return (
                <li key={u.user_id} data-testid={`admin-user-row-${u.user_id}`}>
                  <div
                    className="px-4 sm:px-5 py-3 flex flex-col sm:flex-row sm:items-center gap-3 hover:bg-[var(--surface-2)] cursor-pointer transition-colors"
                    onClick={() => toggle(u)}
                  >
                    {!u.is_admin && (
                      <label
                        onClick={(e) => e.stopPropagation()}
                        className="shrink-0 inline-flex items-center cursor-pointer"
                        title="Select for bulk actions"
                      >
                        <input
                          type="checkbox"
                          checked={selected.has(u.user_id)}
                          onChange={() => toggleOne(u.user_id)}
                          className="admin-checkbox"
                          data-testid={`admin-user-checkbox-${u.user_id}`}
                        />
                      </label>
                    )}
                    <button
                      className="shrink-0 text-[var(--text-3)]"
                      aria-label={isOpen ? "Collapse" : "Expand"}
                      data-testid={`admin-user-toggle-${u.user_id}`}
                    >
                      {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] truncate">
                        {u.email}
                        {u.is_admin && (
                          <span className="ml-2 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--accent)]/15 text-[var(--accent)]">Admin</span>
                        )}
                        {u.is_guest && !u.is_admin && (
                          <span className="ml-2 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--surface-3,#1a1a20)] text-[var(--text-3)]">Guest</span>
                        )}
                      </p>
                      <p className="text-[12px] text-[var(--text-3)] mt-0.5 truncate">
                        {u.name || "—"}
                        {u.designation ? ` · ${u.designation}` : ""}
                        {u.created_at ? ` · joined ${u.created_at.slice(0, 10)}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[12px] text-[var(--text-3)]">
                        {u.project_count} project{u.project_count === 1 ? "" : "s"}
                      </span>
                      <button
                        onClick={(e) => { e.stopPropagation(); setResetTarget(u); }}
                        className="px-3 py-1.5 border border-[var(--hairline)] rounded text-[11px] text-[var(--text-2)] hover:border-[var(--accent)] hover:text-[var(--accent)] inline-flex items-center gap-1.5 transition-colors"
                        data-testid={`admin-reset-pw-${u.user_id}`}
                      >
                        <KeyRound size={11} /> Reset PW
                      </button>
                    </div>
                  </div>

                  {isOpen && (
                    <div className="px-5 sm:px-12 pb-4 pt-1 bg-[var(--surface-2)]/60" data-testid={`admin-user-projects-${u.user_id}`}>
                      {loadingProjects[u.user_id] ? (
                        <p className="text-[12px] text-[var(--text-3)] py-3">Loading projects…</p>
                      ) : !projects || projects.length === 0 ? (
                        <p className="text-[12px] text-[var(--text-3)] py-3">No projects.</p>
                      ) : (
                        <ul className="divide-y divide-[var(--hairline)]">
                          {projects.map((p) => (
                            <li key={p.id} className="py-2.5 flex items-center justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <p className="text-[13px] truncate">{p.name}</p>
                                <p className="text-[11px] text-[var(--text-3)] mt-0.5">
                                  Step {p.step}/5 · updated {(p.updated_at || "").slice(0, 10)}
                                  {p.share_status && p.share_status !== "none" ? ` · client ${p.share_status}` : ""}
                                </p>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${STATUS_TAG[p.status] || "bg-[var(--surface-3)] text-[var(--text-3)]"}`}>
                                  {p.status || "—"}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => setDetailProjectId(p.id)}
                                  className="px-2.5 py-1 border border-[var(--hairline)] rounded text-[11px] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors"
                                  data-testid={`admin-project-view-${p.id}`}
                                >
                                  View
                                </button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
            {filtered.length === 0 && (
              <li className="px-5 py-8 text-[12px] text-[var(--text-3)]">No users match &quot;{q}&quot;.</li>
            )}
          </ul>
        )}
        </>
        )}
      </main>

      {/* Reset password modal */}
      {resetTarget && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center px-5 z-[60]"
          onClick={() => !resetting && setResetTarget(null)}
          data-testid="admin-reset-modal"
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={doReset}
            className="card-brut w-full max-w-md p-6 sm:p-8"
          >
            <div className="flex items-center justify-between">
              <span className="section-label"><span className="dot" />Reset password</span>
              <button type="button" onClick={() => setResetTarget(null)} className="text-[var(--text-3)] hover:text-[var(--text)]" data-testid="admin-reset-close">
                <XIcon size={16} />
              </button>
            </div>
            <p className="text-[14px] mt-4 break-all">{resetTarget.email}</p>
            <p className="text-[12px] text-[var(--text-3)] mt-1">
              Setting a new password will sign the user out of all sessions.
            </p>

            <label className="block mt-5">
              <span className="text-[11px] uppercase tracking-wider text-[var(--text-3)]">New password (min 8)</span>
              <input
                type="text"
                autoFocus
                value={resetPw}
                onChange={(e) => setResetPw(e.target.value)}
                minLength={8}
                maxLength={128}
                className="mt-2 w-full bg-transparent border-b-2 border-[var(--hairline)] focus:border-[var(--accent)] outline-none py-2 text-[14px] transition-colors"
                data-testid="admin-reset-pw-input"
              />
            </label>

            <div className="mt-6 flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setResetTarget(null)}
                disabled={resetting}
                className="btn-ghost"
                data-testid="admin-reset-cancel"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={resetting || resetPw.length < 8}
                className="btn-brut disabled:opacity-40 inline-flex items-center gap-2"
                data-testid="admin-reset-confirm"
              >
                {resetting ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                {resetting ? "Resetting…" : "Reset password"}
              </button>
            </div>
          </form>
        </div>
      )}

      {detailProjectId && (
        <AdminProjectDetailModal
          projectId={detailProjectId}
          onClose={() => setDetailProjectId(null)}
        />
      )}

      {/* Bulk delete confirmation */}
      {confirmDelete && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center px-5 z-[60]"
          onClick={() => !deleting && setConfirmDelete(null)}
          data-testid="admin-delete-modal"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="card-brut w-full max-w-md p-6 sm:p-8"
          >
            <div className="flex items-center justify-between">
              <span className="section-label" style={{ color: "var(--danger)" }}>
                <span className="dot" style={{ background: "var(--danger)" }} />
                Delete users
              </span>
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="text-[var(--text-3)] hover:text-[var(--text)]"
                data-testid="admin-delete-close"
              >
                <XIcon size={16} />
              </button>
            </div>
            <p className="text-[14px] mt-4">
              Delete <strong>{confirmDelete.count}</strong> user{confirmDelete.count === 1 ? "" : "s"}?
            </p>
            <ul className="mt-3 text-[12.5px] text-[var(--text-2)] space-y-1">
              <li>· {confirmDelete.cascade?.projects || 0} projects will be removed</li>
              <li>· {confirmDelete.cascade?.user_sessions || 0} sessions revoked</li>
              <li>· {confirmDelete.cascade?.email_otps || 0} pending OTP codes cleared</li>
            </ul>
            <p className="mt-3 text-[11.5px] text-[var(--danger)]">This cannot be undone.</p>

            <div className="mt-6 flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                disabled={deleting}
                className="btn-ghost"
                data-testid="admin-delete-cancel"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={doDelete}
                disabled={deleting}
                className="btn-brut inline-flex items-center gap-2"
                style={{ background: "var(--danger)", color: "#fff", borderColor: "var(--danger)" }}
                data-testid="admin-delete-confirm"
              >
                {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                {deleting ? "Deleting…" : "Delete forever"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
