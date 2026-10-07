import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  Check,
  Loader2,
  MessageCircleQuestion,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "../lib/api";
import { useDialog } from "./Dialog";
import { PROVIDER_META, ProviderIcon, timeAgo } from "../lib/providersMeta";

const CONN_STATUS = {
  connected:       { label: "CONNECTED",  dot: "#22C55E" },
  syncing:         { label: "SYNCING",    dot: "#989BE0" },
  expired:         { label: "EXPIRED",    dot: "#FFB84C" },
  needs_attention: { label: "ATTENTION",  dot: "#FFB84C" },
  error:           { label: "ERROR",      dot: "#EF4444" },
};

// Traffic-light styling for OAuth token freshness (backend `conn.health`).
const HEALTH_STYLE = {
  green: { dot: "#22C55E", label: "HEALTHY" },
  amber: { dot: "#FFB84C", label: "EXPIRING SOON" },
  red:   { dot: "#EF4444", label: "RECONNECT" },
};

const MEM_STATUS = {
  confirmed: { label: "CONFIRMED", style: { background: "rgba(129, 132, 196,0.12)", color: "#989BE0", border: "1px solid rgba(129, 132, 196,0.3)" } },
  detected:  { label: "DETECTED",  style: { background: "rgba(255,184,76,0.10)", color: "#FFB84C", border: "1px solid rgba(255,184,76,0.25)" } },
  context:   { label: "CONTEXT",   style: { background: "transparent", color: "var(--text-3)", border: "1px solid var(--hairline)" } },
};

const CATEGORIES = [
  { key: "all", label: "All" },
  { key: "requirement", label: "Requirements" },
  { key: "decision", label: "Decisions" },
  { key: "deliverable", label: "Deliverables" },
  { key: "deadline", label: "Deadlines" },
  { key: "scope_change", label: "Scope changes" },
  { key: "question", label: "Open questions" },
];

function SourceRow({ conn, onSync, onDisconnect, syncing }) {
  const st = CONN_STATUS[conn.status] || CONN_STATUS.connected;
  const health = conn.health || null;
  const hs = health ? (HEALTH_STYLE[health.level] || null) : null;
  return (
    <div className="flex items-center gap-3 py-2.5" style={{ borderBottom: "1px solid var(--hairline)" }} data-testid={`source-row-${conn.id}`}>
      <ProviderIcon provider={conn.provider} size={15} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-[13px] font-medium text-[var(--text)] truncate">{conn.source_name}</p>
          {hs && health.level !== "green" && (
            <span
              className="mono-tag px-1.5 py-0.5 rounded text-[9px] inline-flex items-center gap-1"
              style={{
                color: hs.dot,
                background: `${hs.dot}14`,
                border: `1px solid ${hs.dot}55`,
              }}
              title={health.message || hs.label}
              data-testid={`source-health-${conn.id}`}
            >
              <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: hs.dot }} />
              {hs.label}
            </span>
          )}
        </div>
        <p className="text-[10.5px] text-[var(--text-3)] inline-flex items-center gap-1.5">
          <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: st.dot }} />
          {st.label} · Last synced {timeAgo(conn.last_synced_at)}
          {health?.message && health.level !== "green" ? ` · ${health.message}` : ""}
        </p>
      </div>
      <button onClick={() => onSync(conn.id)} disabled={syncing === conn.id} className="flow-header-action" title="Sync now" data-testid={`source-sync-${conn.id}`}>
        {syncing === conn.id ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
      </button>
      <button onClick={() => onDisconnect(conn)} className="flow-header-action" title="Disconnect" data-testid={`source-disconnect-${conn.id}`}>
        <Trash2 size={11} />
      </button>
    </div>
  );
}

function MemoryItem({ m, onAction, acting }) {
  const st = MEM_STATUS[m.status] || MEM_STATUS.detected;
  return (
    <div className="py-2.5" style={{ borderBottom: "1px solid var(--hairline)" }} data-testid={`memory-item-${m.id}`}>
      <div className="flex items-start gap-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="mono-tag text-[9px] text-muted">{(m.category || "").replace("_", " ").toUpperCase()}</span>
            <span className="mono-tag px-1.5 py-0.5 rounded text-[9px]" style={st.style}>{st.label}</span>
          </div>
          <p className="mt-1 text-[13px] font-medium text-[var(--text)]">{m.title}</p>
          {m.detail && <p className="mt-0.5 text-[11.5px] text-[var(--text-3)] leading-snug">{m.detail}</p>}
          <p className="mt-1 text-[10px] text-[var(--text-3)]">
            {PROVIDER_META[m.provider]?.label || m.provider} · {m.source_label} · {timeAgo(m.created_at)}
          </p>
        </div>
      </div>
      {m.status === "detected" && (
        <div className="mt-2 flex gap-1.5 flex-wrap">
          <button onClick={() => onAction(m.id, "confirm")} disabled={!!acting} className="flow-header-action" data-testid={`memory-confirm-${m.id}`}>
            <Check size={10} /> Confirm
          </button>
          <button onClick={() => onAction(m.id, "context")} disabled={!!acting} className="flow-header-action" data-testid={`memory-context-${m.id}`}>
            Keep as context
          </button>
          <button onClick={() => onAction(m.id, "ignore")} disabled={!!acting} className="flow-header-action" data-testid={`memory-ignore-${m.id}`}>
            Ignore
          </button>
        </div>
      )}
    </div>
  );
}

function AskBracket({ projectId }) {
  const [q, setQ] = useState("");
  const [asking, setAsking] = useState(false);
  const [result, setResult] = useState(null);
  const ask = async () => {
    if (q.trim().length < 3) return;
    setAsking(true);
    setResult(null);
    try {
      const { data } = await api.post(`/projects/${projectId}/ask`, { question: q.trim() });
      setResult(data);
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setAsking(false);
    }
  };
  return (
    <div data-testid="ask-bracket">
      <div className="flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && ask()}
          placeholder='Ask about this project — "Did the client approve the homepage?"'
          className="dashboard-search-input flex-1"
          style={{ height: 36 }}
          data-testid="ask-bracket-input"
        />
        <button onClick={ask} disabled={asking || q.trim().length < 3} className="clay-signal px-3.5 py-2 t-tag press inline-flex items-center gap-1.5 disabled:opacity-40" data-testid="ask-bracket-submit">
          {asking ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
        </button>
      </div>
      {result && (
        <div className="mt-3 p-3.5 rounded-lg" style={{ background: "rgba(129, 132, 196,0.06)", border: "1px solid rgba(129, 132, 196,0.2)" }} data-testid="ask-bracket-answer">
          <p className="text-[12.5px] text-[var(--text)] leading-relaxed">{result.answer}</p>
          {(result.sources || []).length > 0 && (
            <div className="mt-2.5 flex flex-col gap-1">
              <p className="mono-tag text-[9px] text-muted">SOURCES</p>
              {result.sources.map((s, i) => (
                <p key={i} className="text-[10.5px] text-[var(--text-3)]">
                  <span className="text-signal">{PROVIDER_META[s.provider]?.label || s.provider}</span> · {s.label}{s.detail ? ` — ${s.detail}` : ""}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export const ConnectedWorkPanel = ({ projectId }) => {
  const { confirm: confirmDialog } = useDialog();
  const [connections, setConnections] = useState([]);
  const [memory, setMemory] = useState([]);
  const [events, setEvents] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [syncing, setSyncing] = useState(null);
  const [acting, setActing] = useState(null);
  const [catFilter, setCatFilter] = useState("all");
  const [showAllMemory, setShowAllMemory] = useState(false);

  const load = async () => {
    try {
      const [c, m, a] = await Promise.all([
        api.get(`/projects/${projectId}/connections`),
        api.get(`/projects/${projectId}/memory`),
        api.get(`/projects/${projectId}/activity`),
      ]);
      setConnections(c.data.connections || []);
      setMemory(m.data.items || []);
      setEvents(a.data.events || []);
    } catch { /* silent */ }
    setLoaded(true);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [projectId]);

  const syncNow = async (cid) => {
    setSyncing(cid);
    try {
      const { data } = await api.post(`/connect/connections/${cid}/sync`);
      toast.success(data.changed ? `Synced — ${data.new_items || 0} new items detected.` : "Synced — no meaningful changes.");
      await load();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setSyncing(null);
    }
  };

  const disconnect = async (conn) => {
    const ok = await confirmDialog({
      title: `Disconnect ${conn.source_name}?`,
      message: "Bracket will stop syncing this source. Extracted memory stays on the project.",
      confirmLabel: "Disconnect",
      cancelLabel: "Keep connected",
    });
    if (!ok) return;
    try {
      await api.delete(`/connect/connections/${conn.id}`);
      toast.success("Disconnected.");
      await load();
    } catch (e) {
      toast.error(formatApiError(e));
    }
  };

  const memAction = async (mid, action) => {
    setActing(mid);
    try {
      await api.post(`/connect/memory/${mid}/action`, { action });
      setMemory((cur) => cur
        .map((m) => (m.id === mid ? { ...m, status: action === "confirm" ? "confirmed" : action === "context" ? "context" : "ignored" } : m))
        .filter((m) => m.status !== "ignored"));
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setActing(null);
    }
  };

  const filteredMemory = useMemo(() => {
    const rows = catFilter === "all" ? memory : memory.filter((m) => m.category === catFilter);
    return showAllMemory ? rows : rows.slice(0, 8);
  }, [memory, catFilter, showAllMemory]);

  if (!loaded) return null;

  const hasConnections = connections.length > 0;

  return (
    <section className="mt-2" data-testid="connected-work-panel">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Connected sources */}
        <div className="card-linear card-linear--solid p-5" data-testid="connected-sources-card">
          <div className="flex items-center justify-between gap-3">
            <p className="mono-label">{"< connected sources >"}</p>
            <Link to={`/app/connect?project=${projectId}`} className="flow-header-action" data-testid="connect-another-source">
              <Plus size={11} /> Connect {hasConnections ? "another" : "a"} source
            </Link>
          </div>
          {hasConnections ? (
            <div className="mt-3">
              {connections.map((c) => (
                <SourceRow key={c.id} conn={c} onSync={syncNow} onDisconnect={disconnect} syncing={syncing} />
              ))}
            </div>
          ) : (
            <p className="mt-3 text-[12px] text-[var(--text-3)] leading-relaxed">
              Bring this project's Gmail conversation, Figma file, GitHub repo or Notion page into Bracket —
              it will keep understanding the work as it evolves.
            </p>
          )}
        </div>

        {/* Live activity */}
        <div className="card-linear card-linear--solid p-5" data-testid="live-activity-card">
          <p className="mono-label inline-flex items-center gap-1.5">{"< live project activity >"}</p>
          {events.length ? (
            <div className="mt-3 flex flex-col">
              {events.slice(0, 8).map((e) => (
                <div key={e.id} className="flex items-start gap-2.5 py-2" style={{ borderBottom: "1px solid var(--hairline)" }} data-testid={`activity-${e.id}`}>
                  <ProviderIcon provider={e.provider} size={12} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] text-[var(--text-2)] leading-snug">{e.summary}</p>
                    <p className="text-[10px] text-[var(--text-3)] mt-0.5">{timeAgo(e.created_at)} · {e.source_label}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-[12px] text-[var(--text-3)] inline-flex items-center gap-2">
              <Activity size={12} /> Activity from connected sources will appear here.
            </p>
          )}
        </div>
      </div>

      {/* Project memory */}
      {hasConnections && (
        <div className="mt-4 card-linear card-linear--solid p-5" data-testid="project-memory-card">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="mono-label inline-flex items-center gap-1.5"><Sparkles size={11} /> {"< project memory >"}</p>
            <div className="flex gap-1 flex-wrap">
              {CATEGORIES.map((c) => (
                <button
                  key={c.key}
                  onClick={() => setCatFilter(c.key)}
                  className="mono-tag px-2 py-1 rounded text-[9.5px]"
                  style={catFilter === c.key
                    ? { background: "rgba(129, 132, 196,0.14)", color: "#989BE0", border: "1px solid rgba(129, 132, 196,0.35)" }
                    : { background: "transparent", color: "var(--text-3)", border: "1px solid var(--hairline)" }}
                  data-testid={`memory-filter-${c.key}`}
                >
                  {c.label.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          {filteredMemory.length ? (
            <div className="mt-2">
              {filteredMemory.map((m) => (
                <MemoryItem key={m.id} m={m} onAction={memAction} acting={acting} />
              ))}
              {memory.length > 8 && (
                <button onClick={() => setShowAllMemory((s) => !s)} className="mt-3 mono-tag text-muted hover:text-[var(--text)] text-[10px]" data-testid="memory-show-all">
                  {showAllMemory ? "SHOW LESS" : `SHOW ALL (${catFilter === "all" ? memory.length : memory.filter((m) => m.category === catFilter).length})`}
                </button>
              )}
            </div>
          ) : (
            <p className="mt-3 text-[12px] text-[var(--text-3)]">Nothing in this category yet.</p>
          )}

          <div className="mt-4 pt-4" style={{ borderTop: "1px solid var(--hairline)" }}>
            <p className="mono-tag text-muted text-[10px] mb-2 inline-flex items-center gap-1.5">
              <MessageCircleQuestion size={11} /> ASK BRACKET
            </p>
            <AskBracket projectId={projectId} />
          </div>
        </div>
      )}
    </section>
  );
};

export default ConnectedWorkPanel;
