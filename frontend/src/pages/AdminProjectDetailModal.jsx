import React, { useEffect, useMemo, useState } from "react";
import { Loader2, X as XIcon, ExternalLink } from "lucide-react";
import { api, formatApiError } from "../lib/api";
import { LabeledBlock, isEmpty } from "./adminDetailBits";

export default function AdminProjectDetailModal({ projectId, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("meta");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const { data: d } = await api.get(`/admin/projects/${projectId}`);
        if (!cancelled) setData(d);
      } catch (e) {
        if (!cancelled) setError(formatApiError(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const p = data?.project;
  const owner = data?.owner;

  const tabs = useMemo(() => {
    const t = [{ key: "meta", label: "META" }];
    if (!p) return t;
    if (!isEmpty(p.situation_input) || !isEmpty(p.framing)) t.push({ key: "s1", label: "1 · SITUATION" });
    if (!isEmpty(p.context_input) || !isEmpty(p.context)) t.push({ key: "s2", label: "2 · CONTEXT" });
    if (!isEmpty(p.decision_input) || !isEmpty(p.decision)) t.push({ key: "s3", label: "3 · DECISION" });
    if (!isEmpty(p.artifacts)) t.push({ key: "s4", label: "4 · ARTIFACTS" });
    if (!isEmpty(p.share_review) || !isEmpty(p.owner_replies)) t.push({ key: "s5", label: "5 · CLIENT REVIEW" });
    if (!isEmpty(p.feedback)) t.push({ key: "fb", label: "FEEDBACK" });
    return t;
  }, [p]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
      data-testid="admin-project-detail-modal"
    >
      <div
        className="card-brut w-full max-w-[1320px] max-h-[calc(100dvh-32px)] flex flex-col"
        onClick={(e) => e.stopPropagation()}
        style={{ color: "var(--text)" }}
      >
        <header className="flex items-center justify-between gap-3 px-5 sm:px-7 py-4 border-b border-[var(--hairline)] shrink-0">
          <div className="min-w-0 flex-1">
            <span className="section-label"><span className="dot" />Project detail</span>
            <h2 className="font-display text-lg sm:text-xl truncate mt-1.5" style={{ letterSpacing: "-0.02em" }}>
              {p?.name || (loading ? "…" : "Untitled")}
            </h2>
            {p && (
              <p className="text-[12px] mt-0.5 truncate" style={{ color: "var(--text-3)" }}>
                <span style={{ color: p.status === "locked" ? "var(--accent)" : "var(--text-2)" }}>
                  {(p.status || "").toUpperCase()}
                </span>
                {" · STEP "}{p.step ?? 0}{"/5"}
                {p.locked_at && ` · LOCKED ${p.locked_at.slice(0, 10)}`}
                {owner?.email && ` · OWNER ${owner.email}`}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {p?.status === "locked" && (
              <a
                href={`/project/${p.id}`}
                target="_blank"
                rel="noreferrer"
                className="btn-ghost hidden sm:inline-flex items-center gap-1 text-[11px]"
                data-testid="admin-project-open-link"
              >
                <ExternalLink size={11} /> Open
              </a>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded hover:bg-[var(--surface-2)]"
              style={{ color: "var(--text-3)" }}
              aria-label="Close"
              data-testid="admin-project-detail-close"
            >
              <XIcon size={18} />
            </button>
          </div>
        </header>

        {/* Section tabs — one section at a time so each fits without scroll. */}
        {p && !loading && tabs.length > 1 && (
          <nav className="flex items-center gap-1 px-5 sm:px-7 pt-3 flex-wrap shrink-0" data-testid="admin-project-detail-tabs">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className="px-3 py-1.5 rounded text-[10.5px] tracking-wider transition-colors"
                style={
                  tab === t.key
                    ? { background: "var(--surface-2)", color: "var(--text)", border: "1px solid var(--hairline)" }
                    : { color: "var(--text-3)", border: "1px solid transparent" }
                }
                data-testid={`admin-project-detail-tab-${t.key}`}
              >
                {t.label}
              </button>
            ))}
          </nav>
        )}

        <div className="px-5 sm:px-7 py-4 flex-1 min-h-0 overflow-y-auto" data-testid="admin-project-detail-body">
          {loading && (
            <div className="flex items-center gap-2 mono-tag text-chalk/60">
              <Loader2 size={13} className="animate-spin" /> Loading project…
            </div>
          )}
          {error && !loading && (
            <p className="mono-tag text-danger" data-testid="admin-project-detail-error">
              {error}
            </p>
          )}

          {p && !loading && (
            <>
              {tab === "meta" && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <LabeledBlock label="Project ID" value={p.id} />
                  <LabeledBlock label="Engine" value={p.engine} />
                  <LabeledBlock label="Share status" value={p.share_status} />
                  <LabeledBlock label="Created" value={p.created_at} />
                  <LabeledBlock label="Updated" value={p.updated_at} />
                  <LabeledBlock label="Locked at" value={p.locked_at} />
                  <LabeledBlock label="Owner user id" value={p.owner_user_id} />
                  <LabeledBlock label="Owner email" value={owner?.email || p.creator_email} />
                  <LabeledBlock label="Owner name" value={owner?.name || p.creator_name} />
                </div>
              )}
              {tab === "s1" && (
                <div className="grid grid-cols-1 lg:grid-cols-[0.9fr_1.1fr] gap-x-8 gap-y-4">
                  <LabeledBlock label="INPUT" value={p.situation_input} />
                  <LabeledBlock label="AI OUTPUT" value={p.framing} />
                </div>
              )}
              {tab === "s2" && (
                <div className="grid grid-cols-1 lg:grid-cols-[0.9fr_1.1fr] gap-x-8 gap-y-4">
                  <LabeledBlock label="INPUT" value={p.context_input} />
                  <LabeledBlock label="AI OUTPUT" value={p.context} />
                </div>
              )}
              {tab === "s3" && (
                <div className="grid grid-cols-1 lg:grid-cols-[0.9fr_1.1fr] gap-x-8 gap-y-4">
                  <LabeledBlock label="INPUT" value={p.decision_input} />
                  <LabeledBlock label="AI OUTPUT" value={p.decision} />
                </div>
              )}
              {tab === "s4" && (
                <div className="admin-detail-cols">
                  <LabeledBlock label="AI OUTPUT" value={p.artifacts} />
                </div>
              )}
              {tab === "s5" && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <LabeledBlock label="Share review" value={p.share_review} />
                  <LabeledBlock label="Owner replies" value={p.owner_replies} />
                </div>
              )}
              {tab === "fb" && (
                <div className="admin-detail-cols">
                  <LabeledBlock label="Feedback" value={p.feedback} />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
