import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Lock, X } from "lucide-react";
import { cn } from "../../lib/utils";
import { Button, IconButton } from "../ui/primitives";
import { AnimatePresence, motion, EASE } from "../ui/motion";
import { useIsMobile } from "../lib/useMedia";
import { useSandbox, TOUR, SANDBOX_WID } from "./sandbox";

/* Guided tour coachmark — Figma › Tour step (196:1892) + "Tour spotlight".
   Finds its target by [data-tour="…"], rings it, and places the card beside
   it (right / left / below, whichever fits). On phones the card sits above
   the tab bar. If the target isn't on screen (e.g. the review was already
   accepted) the card still shows, without a ring. */
const W = 340;
const GAP = 16;

function useTargetRect(selector, enabled) {
  const [rect, setRect] = useState(null);
  useEffect(() => {
    if (!enabled) { setRect(null); return undefined; }
    let raf = 0;
    const read = () => {
      const el = document.querySelector(`[data-tour="${selector}"]`);
      if (!el) { setRect(null); return; }
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) { setRect(null); return; }
      setRect((prev) => (prev && Math.abs(prev.top - r.top) < 1 && Math.abs(prev.left - r.left) < 1 && Math.abs(prev.width - r.width) < 1 && Math.abs(prev.height - r.height) < 1 ? prev : { top: r.top, left: r.left, width: r.width, height: r.height, right: r.right, bottom: r.bottom }));
    };
    const tick = () => { read(); raf = window.setTimeout(tick, 250); }; // layout settles as data loads
    tick();
    window.addEventListener("resize", read);
    window.addEventListener("scroll", read, true);
    return () => { window.clearTimeout(raf); window.removeEventListener("resize", read); window.removeEventListener("scroll", read, true); };
  }, [selector, enabled]);
  return rect;
}

function place(rect, h, pref) {
  const vw = window.innerWidth, vh = window.innerHeight;
  const clampY = (y) => Math.min(Math.max(8, y), vh - h - 8);
  const clampX = (x) => Math.min(Math.max(8, x), vw - W - 8);
  if (!rect) return { left: clampX((vw - W) / 2), top: clampY(vh - h - 32) };
  const opts = {
    right: rect.right + GAP + W <= vw - 8 && { left: rect.right + GAP, top: clampY(rect.top) },
    left: rect.left - GAP - W >= 8 && { left: rect.left - GAP - W, top: clampY(rect.top) },
    bottom: rect.bottom + 12 + h <= vh - 8 && { left: clampX(rect.right - W), top: rect.bottom + 12 },
  };
  return opts[pref] || opts.right || opts.left || opts.bottom || { left: clampX(rect.left), top: clampY(rect.bottom + 12) };
}

export default function Tour() {
  const { tour, nextStep, skipTour } = useSandbox();
  const location = useLocation();
  const mobile = useIsMobile();
  const step = TOUR.find((s) => s.step === tour && s.target);
  const path = step && (step.match || step.path)(SANDBOX_WID).split("?")[0];
  const here = !!step && location.pathname === path;
  const rect = useTargetRect(step?.target, here);
  const card = useRef(null);
  const nextBtn = useRef(null);
  const [h, setH] = useState(260);

  useLayoutEffect(() => { if (card.current) setH(card.current.offsetHeight); });
  useEffect(() => { if (here) window.setTimeout(() => nextBtn.current?.focus({ preventScroll: true }), 350); }, [here, tour]);
  useEffect(() => {
    if (!here) return undefined;
    const onKey = (e) => { if (e.key === "Escape") skipTour(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [here, skipTour]);

  const pos = mobile ? null : place(rect, h, step?.place);
  return (
    <AnimatePresence>
      {here && (
        <>
          {rect && (
            <motion.div
              key="ring"
              aria-hidden="true"
              className="pointer-events-none fixed z-[60] rounded-[10px] ring-2 ring-line-focus"
              style={{ boxShadow: "0 0 0 9999px rgba(8,9,10,0.32)" }}
              initial={{ opacity: 0, top: rect.top - 4, left: rect.left - 4, width: rect.width + 8, height: rect.height + 8 }}
              animate={{ opacity: 1, top: rect.top - 4, left: rect.left - 4, width: rect.width + 8, height: rect.height + 8 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.28, ease: EASE }}
            />
          )}
          <motion.div
            key={`card-${tour}`}
            ref={card}
            role="dialog"
            aria-modal="false"
            aria-label={`Sandbox tour, step ${tour} of 5`}
            className={cn(
              "fixed z-[61] rounded-[10px] border border-line-strong bg-raised p-4 pb-3.5 shadow-overlay",
              mobile && "inset-x-4 bottom-[94px]",
            )}
            style={mobile ? undefined : { width: W, left: pos.left, top: pos.top }}
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, transition: { duration: 0.12 } }}
            transition={{ duration: 0.28, ease: EASE }}
          >
            <div className="flex items-center gap-2">
              <p className="eyebrow flex-1">Step {tour} of 5</p>
              <IconButton icon={X} label="Close tour" size="s" onClick={skipTour} />
            </div>
            <p className="mt-2 text-title-m text-fg">{step.title}</p>
            <p className="mt-2 text-body-m text-fg-secondary">{step.body}</p>
            <div className="mt-2 flex gap-2 rounded-md border border-line-subtle bg-surface p-2.5">
              <Lock size={14} className="mt-0.5 shrink-0 text-fg-tertiary" />
              <p className="text-body-s text-fg-secondary">{step.value}</p>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <span className="flex flex-1 gap-1" aria-hidden="true">
                {[1, 2, 3, 4, 5].map((i) => (
                  <motion.span key={i} className={cn("h-1.5 rounded-full", i <= tour ? "bg-fg" : "bg-line-strong")} animate={{ width: i === tour ? 14 : 6 }} transition={{ duration: 0.2 }} />
                ))}
              </span>
              <Button size="s" variant="ghost" onClick={skipTour}>Skip tour</Button>
              <Button ref={nextBtn} size="s" variant="primary" onClick={nextStep}>{step.next || "Next"}</Button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
