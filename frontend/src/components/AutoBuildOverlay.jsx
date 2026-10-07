import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2 } from "lucide-react";

const STAGES = [
  "Reading your brief…",
  "Framing the real situation…",
  "Compressing the context…",
  "Weighing the call…",
  "Stress-testing the decision…",
];

// Subtle, non-blocking overlay shown while Bracket runs the Step-1
// auto-build. Fires immediately when the user's first paste is submitted
// so they don't see the Step 1 workbench UI at all — after the pipeline
// completes, they're routed directly to Step 5 (rich brief) or Step 2
// (thin brief, follow-up questions surfaced).
export default function AutoBuildOverlay({ open }) {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    if (!open) return undefined;
    setStage(0);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = setInterval(() => setStage((s) => (s + 1) % STAGES.length), 6000);
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
      aria-label="Bracket is reading your brief"
      style={{ zIndex: 200 }}
      data-testid="auto-build-overlay"
    >
      <div
        className="review-modal-panel card-linear card-linear--solid"
        style={{
          maxWidth: 440,
          textAlign: "center",
          padding: "40px 32px",
          background: "rgba(10, 11, 13, 0.97)",
        }}
      >
        <div
          className="mx-auto w-12 h-12 rounded-full flex items-center justify-center"
          style={{ background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.35)" }}
        >
          <Loader2 size={22} className="animate-spin text-signal" />
        </div>
        <p className="mono-tag text-signal text-[10.5px] mt-5">BRACKET IS THINKING</p>
        <h2 className="mt-2 font-display text-[20px] sm:text-[22px] font-semibold tracking-[-0.02em] text-[var(--text)]">
          Reading your brief…
        </h2>
        <p
          className="mt-3 text-sm text-[var(--text-2)] leading-relaxed"
          data-testid="auto-build-overlay-stage"
        >
          {STAGES[stage]}
        </p>
        <p className="mt-4 text-[11px] text-[var(--text-3)] leading-snug">
          Takes about 20 seconds. If your brief is complete, Bracket will drop
          you straight at the final document. If not, it&apos;ll ask a few
          sharp questions on the way.
        </p>
      </div>
    </div>,
    document.body,
  );
}
