import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Lock as LockIcon, ShieldAlert, Mail, ArrowLeft } from "lucide-react";
import { api, formatApiError } from "../lib/api";
import { useAuth } from "../lib/AuthContext";

/**
 * Hidden admin login. Same JWT cookie auth as the rest of the app, just a
 * stricter UI surface — no Google, no marketing chrome, no link from anywhere
 * public.
 *
 * Two ways in:
 *   1. Email + password (preferred for daily use, fastest).
 *   2. Email + OTP fallback (used when the password is unset / forgotten —
 *      the OTP arrives in the admin's inbox, so it's a strong second factor).
 *
 * Either path lands at /admin only if the resolved user has `is_admin: true`.
 */
export default function AdminLogin() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [mode, setMode] = useState("pw"); // "pw" | "otp-request" | "otp-code"
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const finish = async (data) => {
    if (!data?.user?.is_admin) {
      await api.post("/auth/logout").catch(() => {});
      setError("This account is not authorized for the console.");
      setLoading(false);
      return;
    }
    await refresh();
    navigate("/admin/legacy", { replace: true });
  };

  const submitPw = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { data } = await api.post("/auth/login", { email: email.trim(), password: pw });
      await finish(data);
    } catch (err) {
      const msg = formatApiError(err) || "Sign-in failed.";
      setError(msg);
      setLoading(false);
    }
  };

  const requestOtp = async (e) => {
    e?.preventDefault?.();
    setError("");
    setLoading(true);
    try {
      await api.post("/auth/otp/request", { email: email.trim() });
      setMode("otp-code");
      setLoading(false);
    } catch (err) {
      setError(formatApiError(err) || "Could not send code.");
      setLoading(false);
    }
  };

  const submitOtp = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { data } = await api.post("/auth/otp/verify", {
        email: email.trim(),
        code: otp.trim(),
      });
      await finish(data);
    } catch (err) {
      setError(formatApiError(err) || "Invalid code.");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-ink text-chalk flex flex-col" data-testid="admin-login-page">
      <main className="flex-1 grid place-items-center px-5 py-12">
        <div className="w-full max-w-sm border border-chalk/30 bg-ink p-6 sm:p-8" data-testid="admin-login-form">
          <div className="flex items-center gap-2 text-signal">
            <ShieldAlert size={14} />
            <span className="mono-tag">{"< admin console >"}</span>
          </div>
          <h1 className="font-display text-3xl uppercase mt-3 leading-[0.95]">
            Restricted.
            <br />
            <span className="text-signal">Sign in.</span>
          </h1>

          {mode === "pw" && (
            <form onSubmit={submitPw}>
              <label className="block mt-6">
                <span className="mono-tag text-chalk/70">EMAIL</span>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-2 w-full bg-transparent border-b-2 border-chalk/40 focus:border-signal outline-none py-2 font-mono text-sm"
                  data-testid="admin-email-input"
                />
              </label>

              <label className="block mt-5">
                <span className="mono-tag text-chalk/70">PASSWORD</span>
                <div className="mt-2 flex items-center gap-2 border-b-2 border-chalk/40 focus-within:border-signal">
                  <LockIcon size={14} className="text-chalk/40" />
                  <input
                    type="password"
                    required
                    autoComplete="current-password"
                    value={pw}
                    onChange={(e) => setPw(e.target.value)}
                    className="flex-1 bg-transparent outline-none py-2 font-mono text-sm"
                    data-testid="admin-password-input"
                  />
                </div>
              </label>

              {error && (
                <p className="mono-tag text-danger mt-4" data-testid="admin-login-error">{error}</p>
              )}

              <button
                type="submit"
                disabled={loading || !email || !pw}
                className="mt-6 w-full px-4 py-3 bg-signal text-chalk font-mono text-xs tracking-widest uppercase border border-signal disabled:opacity-40 inline-flex items-center justify-center gap-2"
                data-testid="admin-login-submit"
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : null}
                {loading ? "Authenticating…" : "Enter console"}
              </button>

              <button
                type="button"
                onClick={() => { setMode("otp-request"); setError(""); }}
                className="mt-4 w-full mono-tag text-chalk/60 hover:text-signal inline-flex items-center justify-center gap-2"
                data-testid="admin-use-otp"
              >
                <Mail size={11} /> Sign in with email code instead
              </button>
            </form>
          )}

          {mode === "otp-request" && (
            <form onSubmit={requestOtp}>
              <label className="block mt-6">
                <span className="mono-tag text-chalk/70">EMAIL</span>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-2 w-full bg-transparent border-b-2 border-chalk/40 focus:border-signal outline-none py-2 font-mono text-sm"
                  data-testid="admin-otp-email-input"
                />
              </label>
              <p className="mono-tag text-chalk/50 mt-3">
                We'll email you a 6-digit code. Code is valid for 10 minutes.
              </p>

              {error && (
                <p className="mono-tag text-danger mt-4" data-testid="admin-login-error">{error}</p>
              )}

              <button
                type="submit"
                disabled={loading || !email}
                className="mt-6 w-full px-4 py-3 bg-signal text-chalk font-mono text-xs tracking-widest uppercase border border-signal disabled:opacity-40 inline-flex items-center justify-center gap-2"
                data-testid="admin-otp-request"
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : <Mail size={12} />}
                {loading ? "Sending…" : "Email me a code"}
              </button>
              <button
                type="button"
                onClick={() => { setMode("pw"); setError(""); }}
                className="mt-4 w-full mono-tag text-chalk/60 hover:text-chalk inline-flex items-center justify-center gap-2"
                data-testid="admin-back-to-pw"
              >
                <ArrowLeft size={11} /> Back to password
              </button>
            </form>
          )}

          {mode === "otp-code" && (
            <form onSubmit={submitOtp}>
              <p className="mono-tag text-chalk/60 mt-6">
                Code sent to <span className="text-chalk">{email}</span>.
              </p>
              <label className="block mt-5">
                <span className="mono-tag text-chalk/70">6-DIGIT CODE</span>
                <input
                  type="text"
                  required
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  autoFocus
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/[^0-9]/g, ""))}
                  className="mt-2 w-full bg-transparent border-b-2 border-chalk/40 focus:border-signal outline-none py-2 font-mono text-2xl tracking-[0.4em]"
                  data-testid="admin-otp-input"
                />
              </label>

              {error && (
                <p className="mono-tag text-danger mt-4" data-testid="admin-login-error">{error}</p>
              )}

              <button
                type="submit"
                disabled={loading || otp.length < 6}
                className="mt-6 w-full px-4 py-3 bg-signal text-chalk font-mono text-xs tracking-widest uppercase border border-signal disabled:opacity-40 inline-flex items-center justify-center gap-2"
                data-testid="admin-otp-submit"
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : null}
                {loading ? "Verifying…" : "Verify & enter console"}
              </button>
              <button
                type="button"
                onClick={() => { setMode("otp-request"); setOtp(""); setError(""); }}
                className="mt-4 w-full mono-tag text-chalk/60 hover:text-chalk inline-flex items-center justify-center gap-2"
                data-testid="admin-otp-resend"
              >
                <ArrowLeft size={11} /> Use a different email / resend
              </button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
