// Bracket analytics tracker
// ─────────────────────────
// Fires session + page-view + click events to the backend for the admin
// analytics dashboard. Fire-and-forget: any failure is swallowed silently
// so a hiccup can never break the user's page.
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { api } from "./api";

const KEY = "bracket_track_session";
const CLICK_THROTTLE_MS = 200; // avoid duplicate clicks (double-click, mousedown+mouseup)

function getOrCreateSessionId() {
  try {
    let sid = sessionStorage.getItem(KEY);
    if (!sid) {
      sid = (typeof crypto !== "undefined" && crypto.randomUUID)
        ? crypto.randomUUID()
        : `sid-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      sessionStorage.setItem(KEY, sid);
    }
    return sid;
  } catch {
    // sessionStorage blocked (private mode) — generate an ephemeral id.
    return `sid-anon-${Date.now()}`;
  }
}

function utmFromLocation() {
  try {
    const params = new URLSearchParams(window.location.search);
    const utm = {};
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"].forEach((k) => {
      const v = params.get(k);
      if (v) utm[k] = v;
    });
    return utm;
  } catch {
    return {};
  }
}

// Fires on every route change so page views get counted.
function pingSession(pathname) {
  try {
    const sid = getOrCreateSessionId();
    const utm = utmFromLocation();
    api.post("/public/track/session", {
      session_id: sid,
      path: pathname,
      referrer: document.referrer || "",
      utm_source:   utm.utm_source   || "",
      utm_medium:   utm.utm_medium   || "",
      utm_campaign: utm.utm_campaign || "",
      utm_term:     utm.utm_term     || "",
      utm_content:  utm.utm_content  || "",
    }).catch(() => {});
  } catch {
    /* silent */
  }
}

// Click listener — captures normalized (x, y) fractions of the viewport.
let lastClickTs = 0;
function onDocumentClick(e) {
  const now = Date.now();
  if (now - lastClickTs < CLICK_THROTTLE_MS) return;
  lastClickTs = now;
  try {
    const w = window.innerWidth || document.documentElement.clientWidth || 1;
    const h = window.innerHeight || document.documentElement.clientHeight || 1;
    const x = e.clientX;
    const y = e.clientY;
    if (x < 0 || y < 0) return;
    const target = e.target;
    // Compact tag: elementType[#id][.className-first]
    let tag = "";
    if (target && target.tagName) {
      tag = target.tagName.toLowerCase();
      const testId = target.getAttribute && target.getAttribute("data-testid");
      if (testId) tag = `${tag}[${testId.slice(0, 30)}]`;
    }
    api.post("/public/track/click", {
      session_id: getOrCreateSessionId(),
      path: window.location.pathname || "/",
      x_frac: Math.min(1, Math.max(0, x / w)),
      y_frac: Math.min(1, Math.max(0, y / h)),
      vp_w: Math.round(w),
      vp_h: Math.round(h),
      tag: tag.slice(0, 40),
    }).catch(() => {});
  } catch {
    /* silent */
  }
}

// Public React hook — mount once at the top level. Handles both page-view
// pings and click tracking.
export function useAnalyticsTracker() {
  const loc = useLocation();
  useEffect(() => {
    pingSession(loc.pathname);
  }, [loc.pathname]);
  useEffect(() => {
    window.addEventListener("click", onDocumentClick, { passive: true });
    return () => window.removeEventListener("click", onDocumentClick);
  }, []);
}
