import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Loader2, Send, X, MessageSquare, AlertTriangle, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "../lib/api";

/**
 * ClientReviewModal — a single frosted-glass popup that shows every action
 * and detail associated with a client's review of a locked project.
 *
 * Handles both `rejected` (client raised concerns) and `awaiting_reply`
 * (owner replied, waiting on client) states. Also shows the accepted
 * state read-only when passed one.
 *
 * Props:
 *   open        boolean   — controls visibility
 *   onClose     ()=>void  — dismiss handler
 *   project     object    — the current project doc
 *   setProject  fn        — updates the project (used after posting a reply)
 */
export default function ClientReviewModal({ open, onClose, project, setProject }) {
  const navigate = useNavigate();
  const replyRef = useRef(null);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [applying, setApplying] = useState(false);

  // Lock body scroll while open — same recipe as the sign-off popup.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !project) return null;

  const review = project.share_review || {};
  const status = project.share_status;
  const replies = project.owner_replies || [];
  const suggestions = review?.ai_suggestions?.suggestions || [];
  const isReject = review?.type === "reject";
  const isAccept = review?.type === "accept";
  const awaitingReply = status === "awaiting_reply";

  // ONE decision, two paths:
  // - Apply the changes → backend regenerates the affected steps + document
  //   automatically, re-locks, and emails the client a "here's what changed"
  //   note. The owner just lands on the sign-off page.
  // - Keep as is & respond → pre-fill the reply composer with the AI drafts
  //   defending the current call.
  const applyChanges = async () => {
    setApplying(true);
    try {
      await api.post(`/projects/${project.id}/review/apply-changes`);
      // Optimistically flag the project so the blocking "applying changes"
      // overlay appears immediately — the poll keeps it in sync after.
      setProject?.((cur) => (cur ? { ...cur, applying_changes: true } : cur));
      onClose?.();
      navigate(`/project/${project.id}/document`);
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setApplying(false);
    }
  };

  const keepAsIs = () => {
    const draft = suggestions
      .map((s) => (s.what_to_say || "").trim())
      .filter(Boolean)
      .join("\n\n");
    if (draft) setReplyText(draft);
    setTimeout(() => replyRef.current?.focus(), 50);
  };

  const send = async () => {
    if (replyText.trim().length < 4) {
      toast.error("Write a reply first — even one line is fine.");
      return;
    }
    setSending(true);
    try {
      const { data } = await api.post(`/projects/${project.id}/reply`, { text: replyText.trim() });
      setProject(data);
      setReplyText("");
      toast.success("Reply sent. Your client can re-review the same link.");
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setSending(false);
    }
  };

  return createPortal(
    <div
      className="review-modal-overlay"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
      data-testid="client-review-modal"
    >
      <div className="review-modal-panel card-linear card-linear--solid">
        <button
          type="button"
          className="bracket-dialog-close"
          onClick={onClose}
          aria-label="Close"
          data-testid="client-review-modal-close"
        >
          ×
        </button>

        {/* Reject / awaiting_reply share the same body — the client raised
            concerns, and everything (concerns, suggestions, replies, composer)
            lives inside this popup. 2-column layout on desktop so the
            content fits without vertical scroll. */}
        {isReject && (
          <div className="review-reject-form review-reject-form--modal" data-testid="client-review-modal-body">
            <div className="mb-4">
              <p className="mono-tag text-[10.5px] inline-flex items-center gap-2" style={{ color: "var(--danger)" }}>
                <AlertTriangle size={12} /> CLIENT RAISED CONCERNS
              </p>
              <h2 className="mt-2 font-display text-[20px] sm:text-[22px] font-semibold tracking-[-0.02em] text-[var(--text)]">
                {status === "awaiting_reply"
                  ? "You replied. Awaiting the client."
                  : "Here's what your client flagged."}
              </h2>
              <p className="mt-1 text-xs text-[var(--text-2)]">
                Signed by <span className="text-[var(--text)]">{review.signature_name || "your client"}</span>
                {review.role ? `, ${review.role}` : ""}
                {review.submitted_at ? ` · ${new Date(review.submitted_at).toLocaleString()}` : ""}
              </p>

              {/* ONE decision: apply everything the client asked for, or
                  keep the call and respond. */}
              {suggestions.length > 0 && (
                <div className="mt-4 flex flex-wrap items-center gap-2" data-testid="crm-decision-actions">
                  <button
                    type="button"
                    onClick={applyChanges}
                    disabled={applying}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-[12px] font-semibold transition-all press disabled:opacity-60"
                    style={{ background: "#8184C4", color: "#fff", border: "1px solid #989BE0", boxShadow: "0 8px 24px rgba(129, 132, 196,0.35)" }}
                    data-testid="crm-apply-changes"
                  >
                    {applying ? (
                      <><Loader2 size={12} className="animate-spin" /> Applying the changes &amp; regenerating your document…</>
                    ) : (
                      <><Wand2 size={12} /> Apply the changes</>
                    )}
                  </button>
                  {!awaitingReply && (
                    <button
                      type="button"
                      onClick={keepAsIs}
                      disabled={applying}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-[12px] font-medium transition-colors border border-[var(--hairline)] text-[var(--text-2)] hover:text-[var(--text)] hover:border-[var(--text-3)]"
                      data-testid="crm-keep-as-is"
                    >
                      <MessageSquare size={12} /> Keep as is &amp; respond
                    </button>
                  )}
                </div>
              )}
              {suggestions.length > 0 && (
                <p className="mt-2 text-[11px] text-[var(--text-3)] leading-snug">
                  <span className="text-[var(--text-2)]">Apply the changes</span> updates the document automatically and re-sends it to your client — with a note on what changed. Takes about a minute.
                  {!awaitingReply && (
                    <> <span className="text-[var(--text-2)]">Keep as is</span> drafts a reply defending your call.</>
                  )}
                </p>
              )}
            </div>

            <div className="crm-cols">
              <div className="crm-col">
                {/* Concerns block */}
                <section className="card-linear p-4">
                  <p className="mono-tag text-[10.5px]" style={{ color: "var(--danger)" }}>CONCERNS RAISED</p>
                  <p className="mt-2 text-sm whitespace-pre-wrap text-[var(--text)]" data-testid="crm-concerns-text">
                    {review.concerns || "—"}
                  </p>
                </section>

                {/* Existing owner replies thread */}
                {replies.length > 0 && (
                  <section className="mt-3 card-linear p-4" data-testid="crm-replies-thread">
                    <p className="mono-tag text-muted text-[10.5px]">YOUR REPLIES</p>
                    <ul className="mt-2 space-y-3">
                      {replies.map((r, i) => (
                        <li key={i} className="border-l-2 border-signal pl-3">
                          <p className="text-xs text-muted">
                            {r.from_name} · {new Date(r.sent_at).toLocaleString()}
                          </p>
                          <p className="mt-1 text-sm text-[var(--text)] whitespace-pre-wrap">
                            {r.text}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {/* Composer — hidden once we're already awaiting reply. */}
                {!awaitingReply && (
                  <section className="mt-3" data-testid="crm-reply-form">
                    <p className="mono-tag text-muted text-[10.5px] inline-flex items-center gap-2">
                      <MessageSquare size={11} /> REPLY TO THE CLIENT
                    </p>
                    <textarea
                      ref={replyRef}
                      rows={3}
                      className="review-accept-input mt-2"
                      style={{ height: "auto", padding: "12px 14px", resize: "vertical" }}
                      placeholder="Acknowledge the concern. Pick a suggestion (or counter). Tell them what's next."
                      value={replyText}
                      onChange={(ev) => setReplyText(ev.target.value)}
                      maxLength={4000}
                      data-testid="crm-reply-text"
                    />
                    <div className="mt-2 flex flex-col sm:flex-row-reverse gap-2">
                      <button
                        type="button"
                        onClick={send}
                        disabled={sending || replyText.trim().length < 4}
                        className="btn-primary justify-center"
                        data-testid="crm-reply-submit"
                      >
                        {sending ? (
                          <><Loader2 size={14} className="animate-spin" /> Sending…</>
                        ) : (
                          <>Send reply <ArrowRight size={14} /></>
                        )}
                      </button>
                    </div>
                  </section>
                )}

                {awaitingReply && (
                  <section className="mt-3 card-linear p-4" data-testid="crm-awaiting-state">
                    <p className="mono-tag text-signal text-[10.5px]">REPLY SENT · AWAITING CLIENT</p>
                    <p className="mt-2 text-sm text-[var(--text-2)]">
                      Your client can now reopen the same link and respond.
                    </p>
                  </section>
                )}
              </div>

              {/* Bracket suggestions — right column so the whole modal fits without vertical scroll */}
              {suggestions.length > 0 && (
                <div className="crm-col">
                  <section className="card-linear p-4">
                    <p className="mono-tag text-signal text-[10.5px]">BRACKET SUGGESTS</p>
                    {review.ai_suggestions?.summary && (
                      <p className="mt-2 text-xs italic text-[var(--text-2)]">
                        {review.ai_suggestions.summary}
                      </p>
                    )}
                    <ul className="mt-3 space-y-3">
                      {suggestions.map((s, i) => (
                        <li key={i} className="border-l-2 border-signal pl-3" data-testid={`crm-suggestion-${i}`}>
                          <p className="font-display text-sm text-[var(--text)]">
                            {i + 1}. {s.title || s.suggestion}
                          </p>
                          {s.what_to_say && (
                            <p className="text-[11.5px] mt-1 text-[var(--text-2)]">
                              <span className="mono-tag text-signal">SAY →</span> {s.what_to_say}
                            </p>
                          )}
                          {s.what_to_change && (
                            <p className="text-[11.5px] mt-1 text-[var(--text-2)]">
                              <span className="mono-tag text-signal">CHANGE →</span> {s.what_to_change}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                    {review.ai_suggestions?.watch_for && (
                      <p className="mono-tag text-danger mt-3 text-[10.5px]">
                        WATCH FOR · {review.ai_suggestions.watch_for}
                      </p>
                    )}
                  </section>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Accepted view — read-only summary, still lives inside a popup so
            the layout stays consistent. */}
        {isAccept && (
          <div className="review-reject-form" data-testid="client-review-modal-body">
            <div className="mb-5">
              <p className="mono-tag text-signal text-[10.5px]">CLIENT ACCEPTED</p>
              <h2 className="mt-2 font-display text-[22px] sm:text-[26px] font-semibold tracking-[-0.02em] text-[var(--text)]">
                Signed off. You’re clear to ship.
              </h2>
              <p className="mt-2 text-sm text-[var(--text-2)]">
                Accepted by <span className="text-[var(--text)]">{review.signature_name || "your client"}</span>
                {review.role ? `, ${review.role}` : ""}
                {review.submitted_at ? ` · ${new Date(review.submitted_at).toLocaleString()}` : ""}
              </p>
            </div>
            <section className="card-linear p-4 sm:p-5">
              <p className="mono-tag text-signal text-[10.5px]">SECTIONS SIGNED</p>
              <p className="mt-2 text-sm text-[var(--text)]">
                {review.accepted_count} / {review.total_items} items confirmed.
              </p>
            </section>
            <div className="mt-5 flex flex-col sm:flex-row-reverse gap-2">
              <button
                type="button"
                onClick={onClose}
                className="btn-primary justify-center"
                data-testid="crm-close-accept"
              >
                Got it <X size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
