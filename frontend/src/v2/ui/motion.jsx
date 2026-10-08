import React, { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

/* Motion tokens — Figma › Foundations › Motion & accessibility.
   Fast 120ms ease-out (hover, press, toggles) · Base 200ms (panels, drawers,
   popovers) · Sheet 280ms (sheets, full-screen push). Reduced motion swaps
   movement for opacity (MotionConfig reducedMotion="user" in App.js). */
export const EASE = [0.2, 0.8, 0.2, 1];
export const EASE_OUT = [0, 0, 0.2, 1];
export const DUR = { fast: 0.12, base: 0.2, sheet: 0.28 };

export const t = {
  fast: { duration: DUR.fast, ease: EASE_OUT },
  base: { duration: DUR.base, ease: EASE },
  sheet: { duration: DUR.sheet, ease: EASE },
};

export const variants = {
  fade: { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } },
  rise: { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -4 } },
  pop: { initial: { opacity: 0, scale: 0.98 }, animate: { opacity: 1, scale: 1 }, exit: { opacity: 0, scale: 0.98 } },
  panelRight: { initial: { opacity: 0, x: 24 }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0, x: 24 } },
  push: { initial: { opacity: 0, x: 32 }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0, x: -16 } },
};

/* Page — route-level content transition (fade + 6px rise, 200ms). */
export function Page({ children, className, as = "div", ...rest }) {
  const M = motion[as];
  return (
    <M className={className} initial="initial" animate="animate" variants={variants.rise} transition={t.base} {...rest}>
      {children}
    </M>
  );
}

/* Stagger — list whose rows rise in sequence on first render. */
export function Stagger({ children, className, as = "div", step = 0.03, delay = 0, ...rest }) {
  const M = motion[as];
  return (
    <M
      className={className}
      initial="initial"
      animate="animate"
      variants={{ animate: { transition: { staggerChildren: step, delayChildren: delay } } }}
      {...rest}
    >
      {children}
    </M>
  );
}
export function StaggerItem({ children, className, as = "div", ...rest }) {
  const M = motion[as];
  return (
    <M className={className} variants={variants.rise} transition={t.base} {...rest}>
      {children}
    </M>
  );
}

/* Collapse — row that animates its height out when removed (accept, dismiss, snooze). */
export function Collapse({ children, className, ...rest }) {
  return (
    <motion.div
      layout
      className={className}
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0, transition: t.base }}
      transition={t.base}
      style={{ overflow: "hidden" }}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

/* Swap — cross-fade between keyed states (e.g. button label → "Copied"). */
export function Swap({ k, children, className }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.span key={k} className={className} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={t.fast}>
        {children}
      </motion.span>
    </AnimatePresence>
  );
}

/* Delayed — skeletons appear only after 300ms so fast loads never flash. */
export function useDelayed(ms = 300) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setReady(true), ms);
    return () => clearTimeout(id);
  }, [ms]);
  return ready;
}
export function Delayed({ children, ms = 300 }) {
  const ready = useDelayed(ms);
  return ready ? <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={t.base}>{children}</motion.div> : null;
}

/* Count — number that rolls when it changes (counts in nav, badges). */
export function Count({ value, className }) {
  const reduce = useReducedMotion();
  return (
    <span className={className} style={{ display: "inline-flex", overflow: "hidden" }}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={value}
          initial={reduce ? { opacity: 0 } : { y: "60%", opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={reduce ? { opacity: 0 } : { y: "-60%", opacity: 0 }}
          transition={t.base}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

export { AnimatePresence, motion };
