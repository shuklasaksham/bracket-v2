import axios from "axios";

// Prefer same-origin in the browser (works on custom domains + preview).
const ENV_BACKEND = process.env.REACT_APP_BACKEND_URL;
const BACKEND_URL =
  typeof window !== "undefined" && window.location && window.location.origin
    ? window.location.origin
    : ENV_BACKEND;
export const API_BASE = `${BACKEND_URL}/api`;

// withCredentials=true so the httpOnly session_token cookie flows on every call.
export const api = axios.create({ baseURL: API_BASE, withCredentials: true });

// ---------------------------------------------------------------------------
// AI backpressure auto-retry
// ---------------------------------------------------------------------------
// Backend surfaces HTTP 503 with `code: "ai_backpressure"` when the AI
// semaphore is saturated (see ai_engine._dispatch_llm_call). Rather than
// bubble a scary error to the UI, we transparently retry the request twice
// with exponential backoff. The whole retry window stays under 15s so the
// user perceives it as a slow response, not a failure. Cloudflare's 524
// wall (100s) is well outside this window.
const MAX_BACKPRESSURE_RETRIES = 2;

api.interceptors.response.use(
  (r) => r,
  async (error) => {
    const cfg = error?.config;
    const status = error?.response?.status;
    const code = error?.response?.data?.code;
    const retryAfterHdr = Number(error?.response?.headers?.["retry-after"]);
    // Only retry idempotent-ish flows (POST too — LLM outputs are not
    // strictly idempotent but re-running the same paste twice is safe
    // because the endpoint reads state and writes fresh AI output).
    if (status === 503 && code === "ai_backpressure" && cfg) {
      cfg.__aiRetryCount = (cfg.__aiRetryCount || 0) + 1;
      if (cfg.__aiRetryCount <= MAX_BACKPRESSURE_RETRIES) {
        const base = (Number.isFinite(retryAfterHdr) && retryAfterHdr > 0) ? retryAfterHdr : 3;
        const wait = base * 1000 + Math.random() * 800; // jitter
        await new Promise((res) => setTimeout(res, wait));
        return api.request(cfg);
      }
    }
    return Promise.reject(error);
  },
);

export function formatApiError(err) {
  const detail = err?.response?.data?.detail;
  if (!detail) return err?.message || "Something went wrong.";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail.map((e) => (e && typeof e.msg === "string" ? e.msg : JSON.stringify(e))).join(" · ");
  }
  if (detail?.msg) return detail.msg;
  return String(detail);
}
