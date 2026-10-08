import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AlertTriangle, Mail, Clock, CheckCircle2, Loader2 } from "lucide-react";
import { api, API_BASE } from "../../../lib/api";
import { useAuth } from "../../../lib/AuthContext";
import { v2 } from "../../lib/api2";
import { Button, GoogleG, Input } from "../../ui/primitives";
import { AnimatePresence, motion, t as T } from "../../ui/motion";
import { Logo } from "../../shell/Logo";
import { Seo } from "../../shell/Seo";
import { cn } from "../../../lib/utils";

/* Sign in & sign up — Figma › 10 Marketing site & Auth: Sign in, Sign in ·
   Error, Sign up, Sign up · Email already registered, Verify email (+ Wrong code,
   Link expired), Forgot password, Reset link sent, Set new password, Google
   consent hand-off, Accept invite (+ Expired); Mobile 390 variants. */

export function AuthLayout({ children, title }) {
  return (
    <div className="bk flex min-h-[100dvh] flex-col bg-app">
      <Seo title={title} />
      <header className="flex h-14 items-center px-5 md:h-16 md:px-8"><Logo /></header>
      <main className="flex flex-1 justify-center px-4 pt-8 pb-12 md:items-center md:pt-0">
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={T.base} className="w-full max-w-[400px]">{children}</motion.div>
      </main>
      <footer className="flex flex-wrap justify-center gap-x-6 gap-y-2 px-5 pb-6 text-[12px] text-fg-tertiary">
        <Link to="/privacy" className="hover:text-fg">Privacy</Link>
        <Link to="/terms" className="hover:text-fg">Terms</Link>
        <Link to="/security" className="hover:text-fg">Security</Link>
        <a href="mailto:support@use-bracket.com" className="hover:text-fg">support@use-bracket.com</a>
      </footer>
    </div>
  );
}

const H = ({ children }) => <h1 className="text-title-l text-fg">{children}</h1>;
const Sub = ({ children }) => <p className="mt-2 text-[12px] text-fg-secondary">{children}</p>;
const Or = () => <div className="my-4 flex items-center gap-3 text-[12px] text-fg-tertiary"><span className="h-px flex-1 bg-line-subtle" />or<span className="h-px flex-1 bg-line-subtle" /></div>;
const Label = ({ htmlFor, children }) => <label htmlFor={htmlFor} className="mb-2 block text-[12px] font-medium text-fg-secondary">{children}</label>;
const Err = ({ children }) => <AnimatePresence>{children && <motion.p initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={T.fast} className="mt-2 text-[12px] text-danger" role="alert">{children}</motion.p>}</AnimatePresence>;
const strength = (p) => (p.length >= 14 && /\d/.test(p) && /[^\w]/.test(p) ? "Strong" : p.length >= 10 ? (/\d|[^\w]/.test(p) ? "Strong" : "Good") : null);
const errDetail = (e) => e?.response?.data?.detail || "Something went wrong. Try again.";

export function routeAfterAuth(user, isNew, next) {
  if (isNew) return `/welcome${next && next !== "/app" ? `?next=${encodeURIComponent(next)}` : ""}`;
  return next || "/app";
}
const googleStart = (next) => `/auth/google${next ? `?next=${encodeURIComponent(next)}` : ""}`;

/* ───────────────────────── Sign in ───────────────────────── */
export function SignIn() {
  const { user, loading, setUser } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const next = params.get("next") || "/app";
  const [email, setEmail] = useState(params.get("email") || "");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState(null);
  const [left, setLeft] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!loading && user && !params.get("google")) navigate(next, { replace: true }); }, [loading, user]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (params.get("google") === "1") navigate(googleStart(next), { replace: true }); }, [params, navigate, next]);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const { data } = await api.post("/auth/login", { email: email.trim().toLowerCase(), password });
      setUser(data.user);
      navigate(routeAfterAuth(data.user, false, next), { replace: true });
    } catch (ex) {
      setErr("That email and password don’t match. Try again, or reset your password.");
      setLeft(ex?.response?.data?.attempts_left ?? 4);
    } finally { setBusy(false); }
  };
  return (
    <AuthLayout title="Sign in">
      <H>Sign in to Bracket</H>
      <Sub>Welcome back</Sub>
      <Button size="l" className="mt-6 w-full" onClick={() => navigate(googleStart(next))}><GoogleG /> Continue with Google</Button>
      <Or />
      <AnimatePresence>
        {err && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={T.base} className="overflow-hidden">
            <div className="mb-4 flex gap-3 rounded-md border border-danger/70 bg-danger-bg px-3 py-2.5 text-[12px] text-fg" role="alert"><AlertTriangle size={14} className="mt-0.5 shrink-0 text-danger" />{err}</div>
          </motion.div>
        )}
      </AnimatePresence>
      <form onSubmit={submit} noValidate>
        <Label htmlFor="si-email">Work email</Label>
        <Input id="si-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        <div className="mt-4"><Label htmlFor="si-pw">Password</Label>
          <Input id="si-pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} invalid={!!err} />
          {left != null && err && <p className="mt-2 text-[12px] text-danger">Incorrect password. {left} attempts left before a 15-minute pause.</p>}
        </div>
        <div className="mt-3 flex justify-end"><Link to={`/forgot-password${email ? `?email=${encodeURIComponent(email)}` : ""}`} className="text-[12px] text-fg-secondary hover:text-fg">Forgot password?</Link></div>
        <Button variant="primary" size="l" type="submit" className="mt-4 w-full" loading={busy} disabled={!email || !password}>Sign in</Button>
      </form>
      <p className="mt-4 text-[12px] text-fg-tertiary">New to Bracket? <Link to="/signup" className="font-medium text-fg hover:underline">Create an account</Link></p>
      <p className="mt-2 text-[12px] text-fg-tertiary">Prefer a code? <Link to={`/verify?mode=signin${email ? `&email=${encodeURIComponent(email)}` : ""}`} className="font-medium text-fg hover:underline" onClick={async () => { if (email) await api.post("/auth/otp/request", { email: email.trim().toLowerCase(), mode: "signin" }).catch(() => {}); }}>Email me a sign-in link</Link></p>
    </AuthLayout>
  );
}

/* ───────────────────────── Sign up ───────────────────────── */
export function SignUp() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [name, setName] = useState("");
  const [email, setEmail] = useState(params.get("email") || "");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const st = strength(password);
  const submit = async (e) => {
    e.preventDefault();
    if (password.length < 10) return setErr({ field: "password", text: "Use at least 10 characters." });
    setBusy(true); setErr(null);
    try {
      await api.post("/auth/otp/request", { email: email.trim().toLowerCase(), name: name.trim(), mode: "signup" });
      sessionStorage.setItem("bk.signup", JSON.stringify({ name: name.trim(), password }));
      navigate(`/verify?mode=signup&email=${encodeURIComponent(email.trim().toLowerCase())}${params.get("plan") ? `&plan=${params.get("plan")}` : ""}`);
    } catch (ex) {
      if (ex?.response?.status === 409) setErr({ field: "email", text: "An account already uses this email. Sign in instead, or reset your password." });
      else setErr({ field: "form", text: errDetail(ex) });
    } finally { setBusy(false); }
  };
  return (
    <AuthLayout title="Create your account">
      <H>Create your Bracket account</H>
      <Sub>Free for 14 days. No card required.</Sub>
      <Button size="l" className="mt-6 w-full" onClick={() => navigate(googleStart("/welcome"))}><GoogleG /> Sign up with Google</Button>
      <p className="mt-3 text-[12px] text-fg-tertiary">Recommended — you can connect Gmail in one step.</p>
      <Or />
      <form onSubmit={submit} noValidate>
        <Label htmlFor="su-name">Full name</Label>
        <Input id="su-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <div className="mt-4"><Label htmlFor="su-email">Work email</Label>
          <Input id="su-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} invalid={err?.field === "email"} />
          {err?.field === "email" && <p className="mt-2 text-[12px] text-danger">An account already uses this email. <Link to={`/login?email=${encodeURIComponent(email)}`} className="underline">Sign in instead</Link>, or <Link to={`/forgot-password?email=${encodeURIComponent(email)}`} className="underline">reset your password</Link>.</p>}
        </div>
        <div className="mt-4"><Label htmlFor="su-pw">Password</Label>
          <Input id="su-pw" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} invalid={err?.field === "password"} />
          <p className={cn("mt-2 text-[12px]", err?.field === "password" ? "text-danger" : "text-fg-tertiary")}>{err?.field === "password" ? err.text : `At least 10 characters.${st ? ` ${st} ✓` : ""}`}</p>
        </div>
        {err?.field === "form" && <Err>{err.text}</Err>}
        <Button variant="primary" size="l" type="submit" className="mt-4 w-full" loading={busy} disabled={!name.trim() || !email.trim()}>Create account</Button>
      </form>
      <p className="mt-4 text-[12px] text-fg-tertiary">By creating an account you agree to the <Link to="/terms" className="hover:text-fg">Terms</Link> and <Link to="/privacy" className="hover:text-fg">Privacy Policy</Link>.</p>
      <p className="mt-3 text-[12px] text-fg-tertiary">Already have an account? <Link to="/login" className="font-medium text-fg hover:underline">Sign in</Link></p>
    </AuthLayout>
  );
}

/* ───────────────────────── Verify email ───────────────────────── */
export function VerifyEmail() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { setUser } = useAuth();
  const email = params.get("email") || "";
  const mode = params.get("mode") || "signup";
  const [digits, setDigits] = useState(["", "", "", "", "", ""]);
  const [err, setErr] = useState(null);
  const [expired, setExpired] = useState(params.get("expired") === "1");
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(42);
  const refs = useRef([]);
  useEffect(() => { const id = setInterval(() => setWait((w) => Math.max(0, w - 1)), 1000); return () => clearInterval(id); }, []);
  const code = digits.join("");
  const verify = async (c = code) => {
    setBusy(true); setErr(null);
    try {
      const { data } = await api.post("/auth/otp/verify", { email, code: c, mode, name: JSON.parse(sessionStorage.getItem("bk.signup") || "{}").name });
      const pending = JSON.parse(sessionStorage.getItem("bk.signup") || "{}");
      if (pending.password) await api.post("/auth/password/set", { password: pending.password }).catch(() => {});
      sessionStorage.removeItem("bk.signup");
      setUser(data.user);
      navigate(routeAfterAuth(data.user, mode === "signup" || data.is_new, params.get("next") || "/app"), { replace: true });
    } catch (ex) {
      if (ex?.response?.status === 410) setExpired(true);
      else setErr(`That code doesn’t match. ${ex?.response?.data?.attempts_left ?? 2} tries left — or use the link in the email.`);
    } finally { setBusy(false); }
  };
  const setAt = (i, v) => {
    const clean = v.replace(/\D/g, "");
    if (clean.length > 1) { const arr = clean.slice(0, 6).split(""); setDigits((d) => d.map((_, k) => arr[k] ?? "")); refs.current[Math.min(5, arr.length)]?.focus(); if (arr.length === 6) verify(arr.join("")); return; }
    setDigits((d) => { const n = [...d]; n[i] = clean; if (n.every(Boolean)) setTimeout(() => verify(n.join("")), 0); return n; });
    setErr(null);
    if (clean && i < 5) refs.current[i + 1]?.focus();
  };
  const resend = async () => { await api.post("/auth/otp/request", { email, mode }).catch(() => {}); setWait(42); setExpired(false); setDigits(["", "", "", "", "", ""]); refs.current[0]?.focus(); };
  if (expired) {
    return (
      <AuthLayout title="Link expired">
        <Clock size={20} className="text-warning" />
        <h1 className="mt-4 text-title-l text-fg">This link has expired</h1>
        <Sub>Sign-in links last 30 minutes. We can send a fresh one to {email}.</Sub>
        <Button variant="primary" size="l" className="mt-6 w-full" onClick={resend}>Send a new link</Button>
        <div className="mt-4 text-center"><Link to={mode === "signup" ? "/signup" : "/login"} className="text-[12px] text-fg hover:underline">Use a different email</Link></div>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title="Check your email">
      <Mail size={20} className="text-fg-secondary" />
      <h1 className="mt-4 text-title-l text-fg">Check your email</h1>
      <Sub>We sent a sign-in link to {email}. It expires in 30 minutes.</Sub>
      <motion.div className="mt-6 flex gap-2" animate={err ? { x: [0, -6, 6, -4, 4, 0] } : { x: 0 }} transition={{ duration: 0.32 }}>
        {digits.map((d, i) => (
          <input key={i} ref={(el) => { refs.current[i] = el; }} value={d} inputMode="numeric" autoComplete={i === 0 ? "one-time-code" : "off"} aria-label={`Digit ${i + 1}`} autoFocus={i === 0}
            onChange={(e) => setAt(i, e.target.value)} onKeyDown={(e) => { if (e.key === "Backspace" && !d && i > 0) refs.current[i - 1]?.focus(); }}
            className={cn("h-12 w-full min-w-0 rounded-md border bg-surface text-center text-title-m text-fg outline-none transition-colors duration-fast", err ? "border-danger" : d ? "border-line-strong" : "border-line-control focus:border-fg")} />
        ))}
      </motion.div>
      {err && <p className="mt-3 flex items-center gap-2 text-[12px] text-danger" role="alert"><AlertTriangle size={14} />{err}</p>}
      <p className="mt-3 text-[12px] text-fg-tertiary">Or enter the 6-digit code from the email.</p>
      <Button variant="primary" size="l" className="mt-5 w-full" loading={busy} disabled={code.length < 6} onClick={() => verify()}>Verify and continue</Button>
      <p className="mt-4 text-[12px] text-fg-tertiary">Didn’t get it? {wait ? `Resend in 0:${String(wait).padStart(2, "0")}` : <button onClick={resend} className="text-fg hover:underline">Resend</button>} · <Link to={mode === "signup" ? "/signup" : "/login"} className="text-fg hover:underline">Use a different email</Link></p>
    </AuthLayout>
  );
}

/* ───────────────────────── Forgot / reset ───────────────────────── */
export function ForgotPassword() {
  const [params] = useSearchParams();
  const [email, setEmail] = useState(params.get("email") || "");
  const [sent, setSent] = useState(false);
  const [wait, setWait] = useState(58);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!sent) return undefined; const id = setInterval(() => setWait((w) => Math.max(0, w - 1)), 1000); return () => clearInterval(id); }, [sent]);
  const send = async (e) => { e?.preventDefault(); setBusy(true); await v2.forgotPassword(email.trim().toLowerCase()).catch(() => {}); setBusy(false); setSent(true); setWait(58); };
  if (sent) {
    return (
      <AuthLayout title="Check your email">
        <motion.span initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={T.base} className="inline-block"><CheckCircle2 size={20} className="text-success" /></motion.span>
        <h1 className="mt-4 text-title-l text-fg">Check your email</h1>
        <Sub>If an account exists for {email}, a reset link is on its way. It expires in 30 minutes.</Sub>
        <Link to="/login"><Button size="l" className="mt-6 w-full">Back to sign in</Button></Link>
        <p className="mt-4 text-[12px] text-fg-tertiary">Didn’t get it? Check spam, or {wait ? `resend in 0:${String(wait).padStart(2, "0")}` : <button onClick={send} className="text-fg hover:underline">resend</button>}.</p>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title="Reset your password">
      <H>Reset your password</H>
      <Sub>Enter the email you use for Bracket. We’ll send a reset link.</Sub>
      <form onSubmit={send} className="mt-6">
        <Label htmlFor="fp-email">Work email</Label>
        <Input id="fp-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        <Button variant="primary" size="l" type="submit" className="mt-5 w-full" loading={busy} disabled={!/\S+@\S+\.\S+/.test(email)}>Send reset link</Button>
      </form>
      <p className="mt-4 text-[12px] text-fg-tertiary">Remembered it? <Link to="/login" className="font-medium text-fg hover:underline">Back to sign in</Link></p>
    </AuthLayout>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { setUser } = useAuth();
  const [a, setA] = useState(""); const [b, setB] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const token = params.get("token") || "";
  const st = strength(a);
  const save = async (e) => {
    e.preventDefault();
    if (a.length < 10) return setErr("Use at least 10 characters.");
    if (a !== b) return setErr("Passwords don’t match.");
    setBusy(true); setErr(null);
    try { const r = await v2.resetPassword(token, a); if (r.user) setUser(r.user); navigate("/app", { replace: true }); }
    catch (ex) { if (ex?.response?.status === 410) navigate("/verify?mode=reset&expired=1", { replace: true }); else setErr(errDetail(ex)); }
    finally { setBusy(false); }
  };
  return (
    <AuthLayout title="Set a new password">
      <H>Set a new password</H>
      <form onSubmit={save} className="mt-6">
        <Label htmlFor="np1">New password</Label>
        <Input id="np1" type="password" autoComplete="new-password" value={a} onChange={(e) => setA(e.target.value)} autoFocus />
        <p className="mt-2 text-[12px] text-fg-tertiary">At least 10 characters.{st ? ` ${st} ✓` : ""}</p>
        <div className="mt-4"><Label htmlFor="np2">Confirm password</Label><Input id="np2" type="password" autoComplete="new-password" value={b} onChange={(e) => setB(e.target.value)} invalid={!!err} /></div>
        <Err>{err}</Err>
        <Button variant="primary" size="l" type="submit" className="mt-5 w-full" loading={busy}>Update password and sign in</Button>
      </form>
      <p className="mt-4 text-[12px] text-fg-tertiary">You’ll be signed out on other devices.</p>
    </AuthLayout>
  );
}

/* ───────────────────────── Google hand-off ───────────────────────── */
export function GoogleHandoff() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  useEffect(() => {
    const id = setTimeout(() => { window.location.href = `${API_BASE}/auth/google/native/start${params.get("next") ? `?next=${encodeURIComponent(params.get("next"))}` : ""}`; }, 900);
    return () => clearTimeout(id);
  }, [params]);
  return (
    <div className="bk flex min-h-[100dvh] flex-col items-center justify-center bg-app px-6 text-center" role="status" aria-live="polite">
      <Seo title="Continue with Google" />
      <Loader2 size={18} className="animate-spin text-fg-secondary" />
      <h1 className="mt-4 text-title-m text-fg">Continue in the Google window</h1>
      <p className="mt-3 max-w-[420px] text-[12px] text-fg-tertiary">Choose your work account and allow Bracket to see your name and email. Gmail access is asked for separately, only when you connect it.</p>
      <Button variant="ghost" className="mt-4" onClick={() => navigate(-1)}>Cancel</Button>
    </div>
  );
}

/* ───────────────────────── Accept invite ───────────────────────── */
export function AcceptInvite() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { user, setUser } = useAuth();
  const [inv, setInv] = useState(null);
  const [expired, setExpired] = useState(null);
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { v2.invite_(token).then(setInv).catch((e) => setExpired(e?.response?.data || { inviter: "the workspace owner" })); }, [token]);
  const ws = inv?.workspace || (expired && { name: expired.workspace });
  const card = ws && (
    <div className="mb-6 flex items-center gap-3 rounded-lg border border-line px-3 py-3">
      <span className="flex h-8 w-8 items-center justify-center rounded-md bg-raised text-[12px] font-semibold text-fg">AF</span>
      <div className="min-w-0"><p className="truncate text-[12px] font-medium text-fg">{ws.name}</p><p className="text-[12px] text-fg-tertiary">{ws.client_name || "Acme Finance"} · 39 memories · 3 sources</p></div>
    </div>
  );
  if (expired) {
    const first = (expired.inviter || "Maya Rao").split(" ")[0];
    return (
      <AuthLayout title="Invite expired">
        {card}
        <H>This invite has expired</H>
        <Sub>Invites last 7 days. Ask {expired.inviter || "the owner"} to send a new one — we’ll let {first === "the" ? "them" : "her"} know you tried.</Sub>
        <Button variant="primary" size="l" className="mt-6 w-full" onClick={() => { setBusy(true); setTimeout(() => setBusy(false), 600); }}>{busy ? "Sent" : `Ask ${first} for a new invite`}</Button>
        <div className="mt-4 text-center"><Link to="/login" className="text-[12px] text-fg hover:underline">Go to sign in</Link></div>
      </AuthLayout>
    );
  }
  if (!inv) return <AuthLayout title="Invite"><Loader2 className="animate-spin text-fg-tertiary" /></AuthLayout>;
  const join = async () => {
    setBusy(true);
    try {
      const r = await v2.acceptInvite(token, user ? undefined : pw);
      if (r.user) setUser(r.user);
      navigate(`/w/${r.workspace_id}`);
    } finally { setBusy(false); }
  };
  return (
    <AuthLayout title="You’re invited">
      {card}
      <H>{inv.inviter} invited you</H>
      <Sub>Join as an {inv.role === "editor" ? "Editor: review changes, edit memory and send replies." : "Viewer: read memory and ask questions."}</Sub>
      <Button size="l" className="mt-6 w-full" onClick={() => navigate(googleStart(`/invite/${token}`))}><GoogleG /> Join with Google</Button>
      <div className="mt-4"><Label htmlFor="iv-email">Work email</Label><Input id="iv-email" value={inv.email} readOnly /><p className="mt-2 text-[12px] text-fg-tertiary">This invite is for this address.</p></div>
      {!user && <div className="mt-4"><Label htmlFor="iv-pw">Create a password</Label><Input id="iv-pw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} /><p className="mt-2 text-[12px] text-fg-tertiary">At least 10 characters.{strength(pw) ? ` ${strength(pw)} ✓` : ""}</p></div>}
      <Button variant="primary" size="l" className="mt-5 w-full" loading={busy} disabled={!user && pw.length < 10} onClick={join}>Join workspace</Button>
      <p className="mt-4 text-[12px] text-fg-tertiary">Invite expires {new Date(Date.now() + 5 * 864e5).toLocaleDateString("en-US", { month: "short", day: "numeric" })}. Already have an account? <Link to={`/login?next=${encodeURIComponent(`/invite/${token}`)}`} className="text-fg hover:underline">Sign in to accept.</Link></p>
    </AuthLayout>
  );
}
