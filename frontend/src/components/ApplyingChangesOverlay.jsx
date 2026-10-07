import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2 } from "lucide-react";

const STAGES = [
  "Reading your client's concerns…",
  "Mapping changes to the affected steps…",
  "Regenerating the impacted steps…",
  "Rebuilding your sign-off document…",
  "Drafting the \u201cwhat changed\u201d note for your client…",
];

// Blocking, non-dismissable overlay shown while the apply-changes pipeline
// runs in the background. No close button, no Escape, no backdrop click —
// it disappears only when `open` flips false (i.e. the pipeline finished).
export default function ApplyingChangesOverlay({ open }) {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    if (!open) return;
    setStage(0);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = setInterval(() => setStage((s) => (s + 1) % STAGES.length), 9000);
    return () => {
      document.body.style.overflow = prev;
      clearInterval(t);
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="review-modal-overlay"
      role="alertdialog"
      aria-modal="true"
      aria-label="Applying your client's changes"
      style={{ zIndex: 200 }}
      data-testid="applying-changes-overlay"
    >
      <div className="review-modal-panel card-linear card-linear--solid" style={{ maxWidth: 460, textAlign: "center", padding: "40px 32px", background: "rgba(10, 11, 13, 0.97)" }}>
        <div className="mx-auto w-12 h-12 rounded-full flex items-center justify-center" style={{ background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.35)" }}>
          <Loader2 size={22} className="animate-spin text-signal" />
        </div>
        <p className="mono-tag text-signal text-[10.5px] mt-5">APPLYING THE CHANGES</p>
        <h2 className="mt-2 font-display text-[20px] sm:text-[22px] font-semibold tracking-[-0.02em] text-[var(--text)]">
          Bracket is updating your project.
        </h2>
        <p className="mt-3 text-sm text-[var(--text-2)] leading-relaxed" data-testid="applying-changes-stage">
          {STAGES[stage]}
        </p>
        <p className="mt-4 text-[11px] text-[var(--text-3)] leading-snug">
          Takes about a minute. Please keep this page open — the updated document
          will be sent to your client with a note on what changed.
        </p>
      </div>
    </div>,
    document.body
  );
}
