import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AlertTriangle, Lock } from "lucide-react";
import { Logo } from "../shell/Logo";
import { Seo } from "../shell/Seo";
import { Badge, Banner, Button, Input } from "../ui/primitives";
import { AnimatePresence, motion, t as T } from "../ui/motion";
import { admin } from "./api";

/* /admin/login — Figma › Admin · 1 Sign in (209:775), 2 Wrong password
   (209:811), 2b Paused after 5 attempts (209:845), mobile 209:907.
   No sign-up, Google or password reset: the credentials are set on the server. */
export default function SignIn() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next") && params.get("next").startsWith("/admin") ? params.get("next") : "/admin";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState(null); // { text, left }
  const [pausedUntil, setPausedUntil] = useState(null);
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);
  const pw = useRef(null);

  useEffect(() => { // already signed in → straight through
    admin.session().then(() => navigate(next, { replace: true })).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!pausedUntil) return undefined;
    const i = setInterval(() => { if (Date.now() >= pausedUntil) setPausedUntil(null); tick((n) => n + 1); }, 1000);
    return () => clearInterval(i);
  }, [pausedUntil]);

  const paused = pausedUntil && pausedUntil > Date.now();
  const left = paused ? Math.ceil((pausedUntil - Date.now()) / 1000) : 0;
  const mmss = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;

  const submit = async (e) => {
    e.preventDefault();
    if (paused || busy) return;
    if (!username.trim() || !password) { setErr({ text: "Enter the username and password." }); return; }
    setBusy(true);
    setErr(null);
    try {
      await admin.login(username.trim(), password);
      navigate(next, { replace: true });
    } catch (ex) {
      const d = ex?.response?.data || {};
      setPassword("");
      if (ex?.response?.status === 429) setPausedUntil(Date.parse(d.retry_at) || Date.now() + 15 * 60e3);
      else if (d.code === "admin_credentials") setErr({ text: `Incorrect username or password.${d.attempts_left != null ? ` ${d.attempts_left} attempt${d.attempts_left === 1 ? "" : "s"} left before a 15-minute pause.` : ""}` });
      else setErr({ text: d.detail || "Couldn’t sign in. Check your connection and try again." });
      setTimeout(() => pw.current?.focus(), 0);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bk flex min-h-[100dvh] flex-col bg-app">
      <Seo title="Admin sign in" />
      <header className="flex h-14 items-center gap-2 px-4 md:h-16 md:px-8"><Logo to="/admin/login" /><Badge>Admin</Badge></header>
      <main className="flex flex-1 justify-center px-4 pb-12 pt-10 md:items-center md:pt-0">
        <motion.form onSubmit={submit} noValidate initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={T.base} className="w-full max-w-[400px] space-y-4">
          <div>
            <h1 className="text-display-s text-fg">Admin sign in</h1>
            <p className="mt-1.5 text-body-m text-fg-secondary">Restricted to the Bracket owner. Every attempt is logged.</p>
          </div>
          <AnimatePresence initial={false}>
            {paused && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={T.base}>
                <Banner tone="danger" title="Sign-in is paused for 15 minutes">Too many incorrect attempts from this network. Try again in {mmss}.</Banner>
              </motion.div>
            )}
            {params.get("expired") && !paused && !err && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={T.base}>
                <Banner tone="neutral" title="Your admin session ended">Sessions end after 30 minutes without activity. Sign in again to continue.</Banner>
              </motion.div>
            )}
          </AnimatePresence>
          <div>
            <label htmlFor="admin-user" className="mb-2 block text-body-s font-medium text-fg-secondary">Username</label>
            <Input id="admin-user" autoComplete="username" autoFocus value={username} disabled={paused} onChange={(e) => setUsername(e.target.value)} spellCheck={false} autoCapitalize="none" />
          </div>
          <div>
            <label htmlFor="admin-pass" className="mb-2 block text-body-s font-medium text-fg-secondary">Password</label>
            <Input id="admin-pass" ref={pw} type="password" autoComplete="current-password" value={password} disabled={paused} invalid={!!err} aria-invalid={!!err} aria-describedby={err ? "admin-err" : undefined} onChange={(e) => setPassword(e.target.value)} />
            <AnimatePresence>
              {err && (
                <motion.p id="admin-err" role="alert" initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={T.fast} className="mt-2 flex gap-1.5 text-body-s text-danger">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />{err.text}
                </motion.p>
              )}
            </AnimatePresence>
          </div>
          <Button type="submit" variant="primary" className="h-11 w-full md:h-9" loading={busy} disabled={paused}>{paused ? `Try again in ${mmss}` : "Sign in"}</Button>
          <p className="flex gap-2 rounded-lg border border-line-subtle p-3 text-body-s text-fg-tertiary">
            <Lock size={16} className="mt-px shrink-0" />No sign-up, Google sign-in or password reset here. The username and password are set on the server.
          </p>
        </motion.form>
      </main>
    </div>
  );
}
