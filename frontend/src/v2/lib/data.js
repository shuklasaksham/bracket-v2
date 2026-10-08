import { useCallback, useEffect, useRef, useState } from "react";
import { formatDistanceToNowStrict, format, isToday, isYesterday, parseISO } from "date-fns";
import {
  Target, Package, Check, ListChecks, CalendarClock, AlertTriangle, Compass, DollarSign, HelpCircle, Clock,
} from "lucide-react";
import { api, formatApiError } from "../../lib/api";

export { api, formatApiError };

/* ───────────────────────── useResource ─────────────────────────
   Minimal fetch hook: { data, error, loading, reload, setData }.
   Keeps the last good data while reloading (no skeleton flash). */
export function useResource(fetcher, deps = [], { enabled = true } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: enabled });
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const seq = useRef(0); // latest request wins — a slow earlier response never overwrites a newer one
  const run = useCallback(async () => {
    if (!enabled) return null;
    const mine = ++seq.current;
    setState((s) => ({ ...s, loading: true }));
    try {
      const data = await fetcher();
      if (alive.current && mine === seq.current) setState({ data, error: null, loading: false });
      return data;
    } catch (e) {
      if (alive.current && mine === seq.current) setState((s) => ({ ...s, error: e, loading: false }));
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);
  useEffect(() => { run(); }, [run]);
  const setData = useCallback((updater) => setState((s) => ({ ...s, data: typeof updater === "function" ? updater(s.data) : updater })), []);
  return { ...state, reload: run, setData };
}

/* ───────────────────────── Memory categories ───────────────────────── */
export const CATEGORIES = [
  { key: "scope", label: "Scope", icon: Target },
  { key: "decision", label: "Decisions", icon: Check },
  { key: "deliverable", label: "Deliverables", icon: Package },
  { key: "requirement", label: "Requirements", icon: ListChecks },
  { key: "deadline", label: "Deadlines", icon: CalendarClock },
  { key: "timeline", label: "Timeline", icon: Clock },
  { key: "risk", label: "Risks", icon: AlertTriangle },
  { key: "assumption", label: "Assumptions", icon: Compass },
  { key: "commercial", label: "Commercials", icon: DollarSign },
  { key: "question", label: "Open questions", icon: HelpCircle },
];
export const CATEGORY = Object.fromEntries(CATEGORIES.map((c) => [c.key, c]));
export const catLabel = (k) => CATEGORY[k]?.label || (k ? k[0].toUpperCase() + k.slice(1) : "Memory");
export const catSingular = (k) =>
  ({ scope: "Scope", decision: "Decision", deliverable: "Deliverable", requirement: "Requirement", deadline: "Deadline", timeline: "Timeline", risk: "Risk", assumption: "Assumption", commercial: "Commercial", question: "Open question" }[k] || catLabel(k));

export const STATUS = {
  confirmed: { label: "Confirmed", tone: "success" },
  detected: { label: "Proposed", tone: "warning" },
  review: { label: "To review", tone: "warning" },
  context: { label: "Context", tone: "neutral" },
  not_a_change: { label: "Not a change", tone: "neutral" },
  ignored: { label: "Dismissed", tone: "neutral" },
};
export const isPending = (m) => m && (m.status === "detected" || m.status === "review");

/* ───────────────────────── Time ───────────────────────── */
export function toDate(v) {
  if (!v) return null;
  try { return typeof v === "string" ? parseISO(v) : new Date(v); } catch { return null; }
}
export function timeAgo(v) {
  const d = toDate(v);
  if (!d || isNaN(d)) return "";
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return "just now";
  return `${formatDistanceToNowStrict(d)} ago`;
}
export function shortTime(v) {
  const d = toDate(v);
  if (!d || isNaN(d)) return "";
  if (isToday(d)) return format(d, "HH:mm");
  if (isYesterday(d)) return "Yesterday";
  if (Date.now() - d.getTime() < 6 * 864e5) return format(d, "EEE");
  return format(d, "MMM d");
}
export function clock(v) {
  const d = toDate(v);
  return d && !isNaN(d) ? format(d, "HH:mm") : "";
}
export function longDate(v) {
  const d = toDate(v);
  return d && !isNaN(d) ? format(d, "MMM d, yyyy") : "";
}
export function dayKey(v) {
  const d = toDate(v);
  if (!d || isNaN(d)) return "Earlier";
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  return format(d, "EEE, MMM d");
}

/* ───────────────────────── Plans (mirrors backend PLANS) ───────────────────────── */
export const PLANS = {
  monthly: { id: "monthly", name: "Monthly", usd: 12, inr: 999, per: "month", blurb: "For ongoing client work.", limit: "Up to 10 active projects" },
  project: { id: "project", name: "Per project", usd: 2, inr: 199, per: "project", blurb: "For occasional, one-off projects.", limit: "One project, active for 60 days" },
};
export const PLAN_LABEL = { monthly: "Monthly", project: "Per project", ph_launch: "Launch offer", test: "Test" };

/* ───────────────────────── Errors ───────────────────────── */
export const isPaywall = (e) => e?.response?.status === 402;
export const isAuthErr = (e) => e?.response?.status === 401;
