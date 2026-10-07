import React, { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  ArrowRight,
  Check,
  Loader2,
  ShieldCheck,
  AlertTriangle,
  Pen,
} from "lucide-react";
import BracketMark from "../components/BracketMark";
import { api, formatApiError } from "../lib/api";

// Inline-style severity palette (Tailwind text classes get overridden by
// `.mono-tag`'s hardcoded color, so use inline styles for guaranteed contrast).
const SEVERITY_STYLE = {
  HIGH:   { backgroundColor: "#EF4444", color: "#FFFFFF", border: "1px solid #EF4444" },
  MEDIUM: { backgroundColor: "#F97316", color: "#FFFFFF", border: "1px solid #F97316" },
  LOW:    { backgroundColor: "transparent", color: "var(--text-3)", border: "1px solid var(--hairline)" },
};

export default function ClientReview() {
  const { token } = useParams();
  const [doc, setDoc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mode, setMode] = useState("read"); // read | accept | reject

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get(`/share/${token}`);
        setDoc(data);
      } catch (e) {
        setError(formatApiError(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  // Lock body scroll whenever the sign-off modal is open, so users can't
  // accidentally scroll the underlying document behind the popup.
  useEffect(() => {
    if (mode === "read") return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [mode]);

  if (loading) {
    return (
      <div className="dashboard-root relative min-h-screen flex items-center justify-center" data-testid="client-review-loading">
        <div aria-hidden="true" className="hero-ambient hero-ambient--dashboard" />
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10"
          style={{ background: "linear-gradient(180deg, #08090A 0%, #06070A 55%, #050506 100%)" }}
        />
        <p className="mono-label relative">LOADING DOCUMENT…</p>
      </div>
    );
  }
  if (error || !doc) {
    return (
      <div className="dashboard-root relative min-h-screen flex items-center justify-center" data-testid="client-review-error-page">
        <div aria-hidden="true" className="hero-ambient hero-ambient--dashboard" />
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10"
          style={{ background: "linear-gradient(180deg, #08090A 0%, #06070A 55%, #050506 100%)" }}
        />
        <div className="card-linear card-linear--solid p-6 max-w-md text-center relative" data-testid="review-error">
          <p className="mono-tag text-danger">LINK INVALID</p>
          <p className="mt-2 text-sm text-[var(--text-2)]">{error || "This review link is no longer valid."}</p>
          <Link to="/" className="btn-ghost mt-4">Go to Bracket</Link>
        </div>
      </div>
    );
  }

  const alreadyReviewed = doc.share_status === "accepted" || doc.share_status === "rejected";
  const ownerReplied = doc.share_status === "awaiting_reply";
  const ownerReplies = doc.owner_replies || [];

  return (
    <div className="dashboard-root relative min-h-screen" data-testid="client-review-page">
      {/* Cinematic dark backdrop — same recipe as the logged-in dashboard,
          but slightly stronger so the ambient breathes around the paper doc. */}
      <div aria-hidden="true" className="hero-ambient" />
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10"
        style={{ background: "linear-gradient(180deg, #08090A 0%, #06070A 55%, #050506 100%)" }}
      />

      <ReviewHeader doc={doc} />

      <main className="relative max-w-[960px] mx-auto px-5 sm:px-6 md:px-10 pt-8 md:pt-12 pb-40 md:pb-44">
        {ownerReplied && (
          <div className="mb-6">
            <OwnerReplyDisplay replies={ownerReplies} />
          </div>
        )}
        <article className="review-doc-card" data-testid="review-doc">
          <DocumentBody doc={doc} />
        </article>
      </main>

      {/* Sticky bottom action bar — the sidebar's job, now in a floating bar. */}
      {!alreadyReviewed && mode === "read" && (
        <ReviewActionBar
          ownerReplied={ownerReplied}
          onAccept={() => setMode("accept")}
          onReject={() => setMode("reject")}
        />
      )}
      {alreadyReviewed && (
        <div className="review-status-wrap">
          <ReviewedState doc={doc} />
        </div>
      )}

      {/* Full-screen popup for the sign-off form. */}
      {mode !== "read" && !alreadyReviewed && (
        <div
          className="review-modal-overlay"
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setMode("read");
          }}
        >
          <div
            className={`review-modal-panel card-linear card-linear--solid ${mode === "accept" ? "review-modal-panel--wide" : ""}`}
            data-testid={`review-${mode}-modal`}
          >
            <button
              type="button"
              className="bracket-dialog-close"
              onClick={() => setMode("read")}
              aria-label="Close"
              data-testid="review-modal-close"
            >
              ×
            </button>
            {mode === "accept" ? (
              <AcceptForm
                doc={doc}
                token={token}
                onDone={(updated) => { setDoc(updated); setMode("read"); }}
                onCancel={() => setMode("read")}
              />
            ) : (
              <RejectFlow
                doc={doc}
                token={token}
                onDone={(updated) => { setDoc(updated); setMode("read"); }}
                onCancel={() => setMode("read")}
              />
            )}
          </div>
        </div>
      )}

      <footer className="review-footer">
        <div className="max-w-[960px] mx-auto px-5 sm:px-6 md:px-10 py-5 flex items-center justify-between">
          <p className="mono-tag text-muted">{"< document via bracket >"}</p>
          <Link to="/" className="mono-tag link-u">BRACKET.DESIGN →</Link>
        </div>
      </footer>
    </div>
  );
}

function ReviewActionBar({ onAccept, onReject, ownerReplied = false }) {
  return (
    <div className="review-action-bar" data-testid="review-choose-action">
      <div className="review-action-bar-inner">
        <div className="flex items-center gap-2 min-w-0">
          <ShieldCheck size={14} className="text-signal shrink-0" />
          <p className="mono-tag text-muted text-[11px] truncate">
            {ownerReplied ? "THEY REPLIED — YOUR MOVE" : "REVIEW · YOUR MOVE"}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onReject}
            className="btn-ghost"
            data-testid="review-reject-cta"
          >
            Request changes
          </button>
          <button
            type="button"
            onClick={onAccept}
            className="btn-primary"
            data-testid="review-accept-cta"
          >
            Accept &amp; sign <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

function ReviewHeader({ doc }) {
  return (
    <header className="review-header">
      <div className="review-header-bg" aria-hidden="true" />
      <div className="max-w-[1200px] mx-auto px-5 sm:px-6 md:px-10 h-16 flex items-center justify-between gap-3 relative">
        <Link to="/" className="shrink-0 flex items-center gap-3" aria-label="Bracket">
          <BracketMark size={26} />
        </Link>
        <p className="mono-tag text-muted truncate hidden sm:block text-[10.5px]">
          REVIEW · {doc.name?.toUpperCase()}
        </p>
        <p className="mono-tag text-signal text-[10.5px]">
          {(doc.share_status || "PENDING").toUpperCase()}
        </p>
      </div>
    </header>
  );
}

function DocumentBody({ doc }) {
  return (
    <div className="px-6 md:px-12 py-8 md:py-14">
      <p className="mono-label">{"< sign-off document >"}</p>
      <h1 className="font-display text-3xl sm:text-5xl md:text-6xl uppercase mt-3 leading-[0.95]">{doc.name}</h1>
      <p className="mono-tag text-muted mt-3">
        PREPARED BY {(doc.creator_name || "the project owner").toUpperCase()}
        {doc.locked_at ? ` · ${doc.locked_at.slice(0, 10)}` : ""}
      </p>
      <Divider />

      <Section num="01" label="THE STANCE">
        <h2 className="font-display text-2xl sm:text-3xl uppercase">{doc.decision?.recommendation?.title}</h2>
        <p className="mt-3 text-base leading-relaxed">{doc.decision?.recommendation?.rationale}</p>
      </Section>

      {doc.framing?.reframed_problem && (
        <Section num="02" label="THE PROBLEM, REFRAMED">
          <p className="text-base leading-relaxed">{doc.framing.reframed_problem}</p>
        </Section>
      )}

      <Section num="03" label="SCOPE">
        <h3 className="font-display text-xl mt-1">{doc.artifacts?.scope_doc?.title}</h3>
        <SimpleList title="IN SCOPE" items={doc.artifacts?.scope_doc?.in_scope} accent="signal" />
        <SimpleList title="OUT OF SCOPE" items={doc.artifacts?.scope_doc?.out_of_scope} accent="muted" strike />
        <SimpleList title="DELIVERABLES" items={doc.artifacts?.scope_doc?.deliverables} accent="ink" />
        {doc.artifacts?.scope_doc?.timeline_note && (
          <div className="mt-5 border-l-2 border-ink pl-4">
            <p className="mono-tag text-muted">TIMELINE NOTE</p>
            <p className="text-sm mt-1">{doc.artifacts.scope_doc.timeline_note}</p>
          </div>
        )}
      </Section>

      {doc.artifacts?.client_message && (
        <Section num="04" label="MESSAGE TO YOU">
          <div className="border-l-2 border-signal pl-5 whitespace-pre-wrap text-base leading-relaxed">
            {doc.artifacts.client_message}
          </div>
        </Section>
      )}

      {doc.artifacts?.assumptions?.length > 0 && (
        <Section num="05" label="ASSUMPTIONS">
          <ul className="space-y-3">
            {doc.artifacts.assumptions.map((a, i) => (
              <li key={i} className="flex gap-3 text-sm sm:text-base">
                <span className="font-mono text-signal mt-1">{String(i + 1).padStart(2, "0")}</span>
                <span>{a}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {doc.artifacts?.risk_flags?.length > 0 && (
        <Section num="06" label="RISK FLAGS">
          <ul className="space-y-4">
            {doc.artifacts.risk_flags.map((r, i) => (
              <li key={i} className="flex gap-4 items-start">
                <span
                  className="mono-tag px-2 py-1 shrink-0 rounded"
                  style={SEVERITY_STYLE[r.severity] || SEVERITY_STYLE.LOW}
                >
                  {r.severity}
                </span>
                <div>
                  <p className="font-semibold text-sm sm:text-base">{r.flag}</p>
                  <p className="text-sm text-muted mt-1">{r.why}</p>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function Divider() { return <div className="my-8 h-px bg-ink/30" />; }

function Section({ num, label, children }) {
  return (
    <section className="mt-10 first:mt-0">
      <div className="flex items-center gap-3 mb-4">
        <span className="mono-tag bg-ink text-chalk px-2 py-1">{num}</span>
        <p className="mono-tag text-muted">{label}</p>
      </div>
      {children}
    </section>
  );
}

function SimpleList({ title, items, accent = "ink", strike = false }) {
  if (!items?.length) return null;
  return (
    <div className="mt-5">
      <p className={`mono-tag ${accent === "signal" ? "text-signal" : accent === "muted" ? "text-muted" : "text-ink"}`}>
        {title}
      </p>
      <ul className="mt-2 space-y-2">
        {items.map((it, i) => (
          <li key={i} className={`flex gap-3 text-sm sm:text-base ${strike ? "line-through text-muted" : ""}`}>
            <span className={`font-mono ${accent === "signal" ? "text-signal" : accent === "muted" ? "text-muted" : "text-ink"}`}>
              {strike ? "×" : "•"}
            </span>
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function OwnerReplyDisplay({ replies }) {
  return (
    <div className="card-brut p-5 sm:p-6 mb-4" data-testid="review-owner-replies">
      <p className="mono-label text-signal">{"< reply from the creator >"}</p>
      <div className="mt-3 space-y-3">
        {replies.map((r, i) => (
          <div key={i} className="border-l-2 border-signal pl-3">
            <p className="text-xs text-muted">
              {r.from_name} · {new Date(r.sent_at).toLocaleString()}
            </p>
            <p className="text-sm mt-1 whitespace-pre-wrap">{r.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// Build the list of items that need to be checked off
function buildAcceptanceItems(doc) {
  const items = [];
  if (doc.artifacts?.client_message) {
    items.push({ key: "client_message", label: "The message to me", group: "Message" });
  }
  (doc.artifacts?.scope_doc?.in_scope || []).forEach((s, i) =>
    items.push({ key: `in_scope_${i}`, label: s, group: "In scope" })
  );
  (doc.artifacts?.scope_doc?.deliverables || []).forEach((s, i) =>
    items.push({ key: `deliverable_${i}`, label: s, group: "Deliverables" })
  );
  (doc.artifacts?.assumptions || []).forEach((s, i) =>
    items.push({ key: `assumption_${i}`, label: s, group: "Assumptions" })
  );
  return items;
}

function AcceptForm({ doc, token, onDone, onCancel }) {
  const items = useMemo(() => buildAcceptanceItems(doc), [doc]);
  const [acceptances, setAcceptances] = useState(() =>
    items.reduce((a, it) => ({ ...a, [it.key]: false }), {})
  );
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");

  const allChecked = items.every((it) => acceptances[it.key]);
  const checkedCount = Object.values(acceptances).filter(Boolean).length;

  const toggle = (key) =>
    setAcceptances((cur) => ({ ...cur, [key]: !cur[key] }));
  const toggleAll = () => {
    const v = !allChecked;
    setAcceptances(items.reduce((a, it) => ({ ...a, [it.key]: v }), {}));
  };

  const submit = async () => {
    if (!allChecked) return setErr("Tick each item before signing — it's the whole point.");
    if (!name.trim()) return setErr("Add your name as signature.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return setErr("Enter a valid email — we'll send you the signed PDF here.");
    }
    setSubmitting(true);
    setErr("");
    try {
      const { data } = await api.post(`/share/${token}/accept`, {
        acceptances,
        signature_name: name.trim(),
        role: role.trim(),
        client_email: email.trim(),
      });
      onDone(data);
    } catch (e) {
      setErr(formatApiError(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="review-accept-form" data-testid="review-accept-form">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="mono-tag text-signal text-[10.5px]">SIGN OFF</p>
          <h2 className="mt-1 font-display text-[20px] sm:text-[24px] font-semibold tracking-[-0.02em] text-[var(--text)]">
            Confirm everything looks right.
          </h2>
          <p className="mt-1 text-xs text-[var(--text-2)]">
            Tick each item you agree with, sign your name, and we&apos;ll send the project owner your acceptance.
          </p>
        </div>
        <div className="flex items-center gap-4 shrink-0">
          <p className="mono-tag text-muted text-[10.5px]">
            {checkedCount} / {items.length} · ACCEPTANCE ITEMS
          </p>
          <button
            onClick={toggleAll}
            type="button"
            className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-[12px] font-semibold tracking-[0.02em] transition-all press"
            style={
              allChecked
                ? { border: "1px solid var(--hairline)", background: "transparent", color: "var(--text-2)" }
                : { background: "#2E2E2E", color: "#FFFFFF", border: "1px solid #FFFFFF", boxShadow: "0 8px 24px rgba(255,255,255,0.40)" }
            }
            data-testid="review-toggle-all"
          >
            {allChecked ? "Uncheck all" : (<><Check size={13} strokeWidth={2.5} /> Accept all</>)}
          </button>
        </div>
      </div>

      {/* All checklist items — multi-column flow, no inner scroll on desktop. */}
      <div className="review-accept-items">
        {items.map((it) => (
          <label
            key={it.key}
            className={`review-accept-item ${acceptances[it.key] ? "is-checked" : ""}`}
            data-testid={`review-item-${it.key}`}
          >
            <input
              type="checkbox"
              checked={!!acceptances[it.key]}
              onChange={() => toggle(it.key)}
              className="review-accept-checkbox"
            />
            <p className="min-w-0 text-[13px] leading-snug break-words text-[var(--text)]">
              <span className="mono-tag text-muted text-[9.5px] mr-1.5">{it.group} ·</span>
              {it.label}
            </p>
          </label>
        ))}
      </div>

      {/* Signature strip — one horizontal row on desktop. */}
      <div className="review-accept-footer">
        <label className="block min-w-0">
          <span className="mono-tag text-muted flex items-center gap-2 text-[10.5px]">
            <Pen size={12} /> YOUR SIGNATURE
          </span>
          <input
            className="review-accept-input mt-2"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Type your full name"
            data-testid="review-signature-name"
          />
          <span
            className="block mt-1.5 font-display text-[17px] italic text-[var(--text)] min-h-[22px] leading-tight truncate"
            data-testid="review-signature-preview"
          >
            {name || "—"}
          </span>
        </label>
        <label className="block min-w-0">
          <span className="mono-tag text-muted flex items-center gap-2 text-[10.5px]">ROLE (OPTIONAL)</span>
          <input
            className="review-accept-input mt-2"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="e.g. CEO, Marketing Lead"
            data-testid="review-signature-role"
          />
        </label>
        <label className="block min-w-0">
          <span className="mono-tag text-muted flex items-center gap-2 text-[10.5px]">
            <Pen size={12} /> YOUR EMAIL (REQUIRED)
          </span>
          <input
            type="email"
            className="review-accept-input mt-2"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            data-testid="review-signature-email"
            required
            autoComplete="email"
          />
          <span className="mt-1.5 block text-[10.5px] text-[var(--text-3)] leading-snug">
            We&apos;ll email you the signed PDF for your records.
          </span>
        </label>
        <div className="flex flex-col sm:flex-row-reverse gap-2">
          <button
            type="button"
            onClick={submit}
            disabled={submitting || !allChecked || !name.trim() || !email.trim()}
            className="btn-primary justify-center"
            data-testid="review-accept-submit"
          >
            {submitting ? "Signing…" : "Sign & send"} <ArrowRight size={14} />
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="btn-ghost justify-center"
            data-testid="review-accept-cancel"
          >
            Back to document
          </button>
        </div>
      </div>

      {err && (
        <p className="mt-3 text-sm text-danger" data-testid="review-accept-error">
          {err}
        </p>
      )}
    </div>
  );
}

function RejectFlow({ doc, token, onDone, onCancel }) {
  const [phase, setPhase] = useState("write"); // write | suggestions | submitted
  const [concerns, setConcerns] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [email, setEmail] = useState("");
  const [suggestions, setSuggestions] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const getSuggestions = async () => {
    if (concerns.trim().length < 10) return setErr("Give them something useful to work with — a sentence or two minimum.");
    setLoading(true);
    setErr("");
    try {
      const { data } = await api.post(`/share/${token}/reject/preview`, { concerns: concerns.trim() });
      setSuggestions(data.ai_suggestions);
      setPhase("suggestions");
    } catch (e) {
      setErr(formatApiError(e));
    } finally {
      setLoading(false);
    }
  };

  const confirm = async () => {
    if (!name.trim()) return setErr("Add your name as signature.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return setErr("Enter a valid email — we'll email you a copy of your concerns.");
    }
    setLoading(true);
    setErr("");
    try {
      const { data } = await api.post(`/share/${token}/reject/confirm`, {
        concerns: concerns.trim(),
        signature_name: name.trim(),
        role: role.trim(),
        client_email: email.trim(),
        ai_suggestions: suggestions || {},
      });
      onDone(data);
    } catch (e) {
      setErr(formatApiError(e));
    } finally {
      setLoading(false);
    }
  };

  if (phase === "write") {
    return (
      <div className="review-reject-form" data-testid="review-reject-write">
        <div className="mb-6">
          <p className="mono-tag text-danger text-[10.5px] inline-flex items-center gap-2">
            <AlertTriangle size={12} /> RAISE CONCERNS
          </p>
          <h2 className="mt-1 font-display text-[22px] sm:text-[26px] font-semibold tracking-[-0.02em] text-[var(--text)]">
            What&apos;s not working?
          </h2>
          <p className="mt-2 text-sm text-[var(--text-2)]">
            Tell them what isn&apos;t working. Bracket will help shape your concern into specific suggestions
            before it&apos;s sent.
          </p>
        </div>
        <textarea
          rows={7}
          maxLength={4000}
          className="review-accept-input"
          style={{ height: "auto", padding: "12px 14px", resize: "vertical" }}
          placeholder="What's the worry? Specifics help — scope, timing, deliverables, anything."
          value={concerns}
          onChange={(e) => setConcerns(e.target.value)}
          data-testid="review-concerns"
        />
        {err && <p className="mt-2 text-sm text-danger" data-testid="review-reject-error">{err}</p>}
        <div className="mt-5 flex flex-col sm:flex-row-reverse gap-2">
          <button
            type="button"
            onClick={getSuggestions}
            disabled={loading}
            className="btn-primary flex-1 justify-center"
            data-testid="review-get-suggestions"
          >
            {loading ? (
              <>
                <Loader2 size={14} className="animate-spin" /> Thinking…
              </>
            ) : (
              <>
                See Bracket suggestions <ArrowRight size={14} />
              </>
            )}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="btn-ghost sm:w-auto justify-center"
            data-testid="review-reject-cancel"
          >
            Back to document
          </button>
        </div>
      </div>
    );
  }

  // phase === suggestions
  return (
    <div className="review-reject-form" data-testid="review-reject-suggestions">
      <div className="mb-4">
        <p className="mono-tag text-signal text-[10.5px]">BEFORE YOU SEND</p>
        <h2 className="mt-1 font-display text-[22px] sm:text-[26px] font-semibold tracking-[-0.02em] text-[var(--text)]">
          Sharper phrasing, faster reply.
        </h2>
      </div>

      <div className="review-suggest-cols">
        {/* Left — Bracket's suggestions */}
        <div className="min-w-0">
          {suggestions?.summary && (
            <p className="text-sm italic text-[var(--text-2)]">{suggestions.summary}</p>
          )}
          <ul className="mt-4 space-y-3.5">
            {(suggestions?.suggestions || []).map((s, i) => (
              <li key={i} className="border-l-2 border-signal pl-4">
                <p className="font-display text-[15px] text-[var(--text)]">{i + 1}. {s.title}</p>
                <p className="text-xs mt-1 text-[var(--text-2)]">
                  <span className="mono-tag text-signal">SAY →</span> {s.what_to_say}
                </p>
                <p className="text-xs mt-1 text-[var(--text-2)]">
                  <span className="mono-tag text-signal">CHANGE →</span> {s.what_to_change}
                </p>
              </li>
            ))}
          </ul>
          {suggestions?.watch_for && (
            <p className="mono-tag text-danger mt-4 text-[10.5px]">WATCH FOR · {suggestions.watch_for}</p>
          )}
        </div>

        {/* Right — signature + send */}
        <div className="review-accept-signature">
          <label className="block">
            <span className="mono-tag text-muted flex items-center gap-2 text-[10.5px]">
              <Pen size={12} /> YOUR SIGNATURE
            </span>
            <input
              className="review-accept-input mt-2"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your full name"
              data-testid="review-signature-name"
            />
          </label>
          <label className="block mt-3">
            <span className="mono-tag text-muted text-[10.5px]">ROLE (OPTIONAL)</span>
            <input
              className="review-accept-input mt-2"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="e.g. CEO, Marketing Lead"
              data-testid="review-signature-role"
            />
          </label>
          <label className="block mt-3">
            <span className="mono-tag text-muted flex items-center gap-2 text-[10.5px]">
              <Pen size={12} /> YOUR EMAIL (REQUIRED)
            </span>
            <input
              type="email"
              className="review-accept-input mt-2"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              data-testid="review-signature-email"
              required
              autoComplete="email"
            />
            <span className="mt-1.5 block text-[10.5px] text-[var(--text-3)] leading-snug">
              We&apos;ll email you a copy of the concerns you sent.
            </span>
          </label>

          {err && <p className="mt-3 text-sm text-danger" data-testid="review-reject-confirm-error">{err}</p>}

          <div className="mt-4 flex flex-col sm:flex-row-reverse gap-2">
            <button
              type="button"
              onClick={confirm}
              disabled={loading || !name.trim() || !email.trim()}
              className="btn-primary flex-1 justify-center"
              data-testid="review-reject-confirm"
            >
              {loading ? "Sending…" : "Send concerns"} <ArrowRight size={14} />
            </button>
            <button
              type="button"
              onClick={() => setPhase("write")}
              className="btn-ghost sm:w-auto justify-center"
              data-testid="review-reject-back"
            >
              Edit my concerns
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReviewedState({ doc }) {
  const isAccept = doc.share_status === "accepted";
  return (
    <div
      className="card-linear card-linear--solid p-5 sm:p-6"
      data-testid="review-done-state"
    >
      <div className="flex items-center gap-2">
        {isAccept ? (
          <Check size={16} style={{ color: "var(--accent)" }} />
        ) : (
          <AlertTriangle size={16} style={{ color: "var(--danger)" }} />
        )}
        <p
          className="mono-tag text-[10.5px]"
          style={{ color: isAccept ? "var(--accent)" : "var(--danger)" }}
        >
          {isAccept ? "DOCUMENT ACCEPTED" : "CONCERNS DELIVERED"}
        </p>
      </div>
      <h3 className="font-display font-semibold tracking-[-0.02em] text-[22px] sm:text-[26px] mt-3 text-[var(--text)]">
        Thanks.
      </h3>
      <p className="mt-3 text-sm text-[var(--text-2)]">
        {isAccept
          ? "The project owner has been notified you accepted the sign-off. They'll be in touch with next steps."
          : "Your concerns have been delivered. They'll reply with how they want to proceed."}
      </p>
      <p className="mono-tag text-muted mt-5 text-[10.5px]">
        SIGNED · {doc.share_review?.signature_name}
      </p>
    </div>
  );
}
