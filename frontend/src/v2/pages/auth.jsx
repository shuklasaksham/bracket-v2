import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Mail, KeyRound, Check, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError, API_BASE } from "../../lib/api";
import { useAuth } from "../../lib/AuthContext";
import { PLANS } from "../lib/data";
import { Banner, Button, Card, Checkbox, Field, Input, Segmented } from "../ui/primitives";
import { Logo, Mark } from "../shell/Logo";
import { Seo } from "../shell/Seo";
import { FullScreenLoader } from "../shell/Guards";
import { cn } from "../../lib/utils";

/* ───────────────────────── Layout ───────────────────────── */
function AuthLayout({ children, wide }) {
  return (
    <div className="bk flex min-h-[100dvh] flex-col bg-app">
      <header className="flex h-16 items-center justify-between px-5 md:px-8">
        <Logo />
        <Link to="/" className="text-body-s text-fg-tertiary hover:text-fg">Back to site</Link>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pb-16 pt-6 md:items-center md:pt-0">
        <div className={cn("w-full animate-fade-up", wide ? "max-w-[880px]" : "max-w-[400px]")}>{children}</div>
      </main>
      <footer className="px-5 pb-6 text-center text-body-s text-fg-tertiary">
        © {new Date().getFullYear()} Bracket Inc. · <Link to="/privacy" className="hover:text-fg">Privacy</Link> · <Link to="/terms" className="hover:text-fg">Terms</Link>
      </footer>
    </div>
  );
}

const ERRS = {
  google: "Google sign-in didn’t complete. Please try again.",
  google_state: "That sign-in link expired. Please try again.",
  google_token: "Google couldn’t verify the sign-in. Please try again.",
  google_userinfo: "Google didn’t share your email. Please try again.",
  google_email: "Your Google account has no email address we can use.",
};

function GoogleG() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

/* After any sign-in: no plan → /plan · incomplete profile → /onboarding · else next */
function routeAfterAuth(user, isNew, next) {
  if (isNew) return "/welcome";
  return next || "/app";
}

/* ───────────────────────── Login / sign up ───────────────────────── */
export function Login({ mode: initialMode = "signin" }) {
  const { user, loading, setUser } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next") || "";
  const [mode, setMode] = useState(initialMode); // signin | signup
  const [step, setStep] = useState("email"); // email | code | password
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [devCode, setDevCode] = useState("");
  const [error, setError] = useState(ERRS[params.get("err")] || "");

  useEffect(() => { if (!loading && user) navigate(routeAfterAuth(user, false, next), { replace: true }); }, [loading, user, navigate, next]);

  const google = () => { window.location.href = `${API_BASE}/auth/google/native/start`; };
  const requestCode = async (e) => {
    e?.preventDefault();
    setError("");
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setError("Enter a valid email address."); return; }
    setBusy(true);
    try {
      const { data } = await api.post("/auth/otp/request", { email: email.trim().toLowerCase(), name: name.trim() });
      if (data?.dev_code) setDevCode(data.dev_code);
      setStep("code");
      toast.success(data?.throttled ? "We just sent a code — check your inbox." : `We sent a 6-digit code to ${email.trim()}`);
    } catch (err) { setError(formatApiError(err)); } finally { setBusy(false); }
  };
  const verify = async (e) => {
    e?.preventDefault();
    setError("");
    setBusy(true);
    try {
      const { data } = await api.post("/auth/otp/verify", { email: email.trim().toLowerCase(), code: code.trim(), name: name.trim() });
      setUser(data.user);
      navigate(routeAfterAuth(data.user, data.is_new, next), { replace: true });
    } catch (err) { setError(formatApiError(err)); } finally { setBusy(false); }
  };
  const passwordLogin = async (e) => {
    e?.preventDefault();
    setError("");
    setBusy(true);
    try {
      const { data } = await api.post("/auth/login", { email: email.trim().toLowerCase(), password });
      setUser(data.user);
      navigate(routeAfterAuth(data.user, false, next), { replace: true });
    } catch (err) { setError(formatApiError(err)); } finally { setBusy(false); }
  };

  if (loading) return <FullScreenLoader />;
  const signup = mode === "signup";
  return (
    <AuthLayout>
      <Seo title={signup ? "Create your account" : "Sign in"} noindex={false} />
      {step === "code" ? (
        <form onSubmit={verify}>
          <button type="button" onClick={() => { setStep("email"); setCode(""); }} className="mb-6 inline-flex items-center gap-1.5 text-body-s text-fg-tertiary hover:text-fg"><ArrowLeft size={14} /> Use a different email</button>
          <h1 className="text-display-s">Check your email</h1>
          <p className="mt-2 text-body-m text-fg-tertiary">Enter the 6-digit code we sent to <span className="text-fg">{email}</span>. It expires in 10 minutes.</p>
          {devCode && <Banner tone="info" className="mt-4" title={`Test mode code: ${devCode}`} />}
          <Field label="Code" htmlFor="otp" className="mt-6">
            <Input id="otp" inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={8} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className="h-12 text-center font-mono text-[22px] tracking-[0.5em]" placeholder="••••••" invalid={!!error} />
          </Field>
          {error && <p className="mt-2 text-body-s text-danger" role="alert">{error}</p>}
          <Button type="submit" variant="primary" size="l" className="mt-5 w-full" loading={busy} disabled={code.length < 4}>Verify and continue</Button>
          <button type="button" onClick={requestCode} className="mt-4 w-full text-center text-body-s text-fg-tertiary hover:text-fg">Didn’t get it? Send a new code</button>
        </form>
      ) : step === "password" ? (
        <form onSubmit={passwordLogin}>
          <button type="button" onClick={() => setStep("email")} className="mb-6 inline-flex items-center gap-1.5 text-body-s text-fg-tertiary hover:text-fg"><ArrowLeft size={14} /> Back</button>
          <h1 className="text-display-s">Sign in with password</h1>
          <div className="mt-6 space-y-4">
            <Field label="Email" htmlFor="pe"><Input id="pe" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <Field label="Password" htmlFor="pp"><Input id="pp" type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} invalid={!!error} /></Field>
          </div>
          {error && <p className="mt-2 text-body-s text-danger" role="alert">{error}</p>}
          <Button type="submit" variant="primary" size="l" className="mt-5 w-full" loading={busy} disabled={!email || password.length < 6}>Sign in</Button>
          <button type="button" onClick={() => { setStep("email"); setError(""); }} className="mt-4 w-full text-center text-body-s text-fg-tertiary hover:text-fg">Forgot it? Sign in with an email code instead</button>
        </form>
      ) : (
        <form onSubmit={requestCode}>
          <Mark size={32} />
          <h1 className="mt-6 text-display-s">{signup ? "Create your Bracket account" : "Sign in to Bracket"}</h1>
          <p className="mt-2 text-body-m text-fg-tertiary">{signup ? "Free for 14 days. No card required to look around." : "Welcome back."}</p>
          {error && <Banner tone="danger" className="mt-5" title={error} />}
          <Button type="button" variant="secondary" size="l" className="mt-6 w-full" onClick={google}><GoogleG /> Continue with Google</Button>
          <div className="my-5 flex items-center gap-3 text-body-s text-fg-tertiary"><span className="h-px flex-1 bg-line" />or<span className="h-px flex-1 bg-line" /></div>
          <div className="space-y-4">
            {signup && <Field label="Your name" htmlFor="nm"><Input id="nm" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Maya Rao" /></Field>}
            <Field label="Work email" htmlFor="em"><Input id="em" type="email" autoComplete="email" autoFocus={!signup} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" /></Field>
          </div>
          <Button type="submit" variant="primary" size="l" className="mt-5 w-full" icon={Mail} loading={busy}>Continue with email</Button>
          {!signup && <button type="button" onClick={() => { setStep("password"); setError(""); }} className="mt-3 w-full text-center text-body-s text-fg-tertiary hover:text-fg"><KeyRound size={12} className="mr-1 inline" />Use a password instead</button>}
          <p className="mt-6 text-center text-body-s text-fg-tertiary">
            {signup ? <>Already have an account? <button type="button" className="text-fg hover:underline" onClick={() => setMode("signin")}>Sign in</button></> : <>New to Bracket? <button type="button" className="text-fg hover:underline" onClick={() => setMode("signup")}>Create an account</button></>}
          </p>
          <p className="mt-4 text-center text-body-s text-fg-tertiary">By continuing you agree to the <Link to="/terms" className="underline">Terms</Link> and <Link to="/privacy" className="underline">Privacy policy</Link>.</p>
        </form>
      )}
    </AuthLayout>
  );
}

/* ───────────────────────── Emergent Google callback (#session_id=…) ───────────────────────── */
export function AuthCallback() {
  const navigate = useNavigate();
  const { setUser } = useAuth();
  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const sid = params.get("session_id");
    if (!sid) { navigate("/login", { replace: true }); return; }
    api.post("/auth/google/exchange", { session_id: sid })
      .then(({ data }) => { setUser(data.user); window.history.replaceState(null, "", window.location.pathname); navigate(routeAfterAuth(data.user, data.is_new, "/app"), { replace: true }); })
      .catch(() => navigate("/login?err=google", { replace: true }));
  }, [navigate, setUser]);
  return <FullScreenLoader label="Signing you in" />;
}

/* ───────────────────────── Onboarding (profile) ───────────────────────── */
const ROLES = ["Founder", "Designer", "Developer", "Agency owner", "Freelancer", "Project manager", "Account manager", "Other"];
export function Onboarding() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next") || "/app";
  const [name, setName] = useState(user?.name && user.name !== "Guest" ? user.name : "");
  const [designation, setDesignation] = useState(user?.designation || "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { data } = await api.patch("/auth/me", { name: name.trim(), designation: designation.trim(), avatar: user?.avatar || "mono-1" });
      setUser(data);
      if (password) await api.post("/auth/password/set", { password });
      const { data: claimable } = await api.get("/auth/claimable").catch(() => ({ data: [] }));
      navigate(Array.isArray(claimable) && claimable.length ? `/claim?next=${encodeURIComponent(next)}` : next, { replace: true });
    } catch (err) { toast.error(formatApiError(err)); } finally { setBusy(false); }
  };
  return (
    <AuthLayout>
      <Seo title="Welcome" />
      <form onSubmit={save}>
        <p className="eyebrow">Step 1 of 2</p>
        <h1 className="mt-2 text-display-s">Tell us about you</h1>
        <p className="mt-2 text-body-m text-fg-tertiary">Bracket uses your name when it drafts replies and records decisions.</p>
        <div className="mt-6 space-y-4">
          <Field label="Your name" htmlFor="on"><Input id="on" required autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="What do you do?" htmlFor="od">
            <Input id="od" required list="roles" value={designation} onChange={(e) => setDesignation(e.target.value)} placeholder="e.g. Design lead" />
            <datalist id="roles">{ROLES.map((r) => <option key={r} value={r} />)}</datalist>
          </Field>
          {!user?.has_password && (
            <Field label="Password (optional)" htmlFor="op" helper="At least 8 characters. You can always sign in with an email code instead.">
              <Input id="op" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} invalid={!!password && password.length < 8} />
            </Field>
          )}
        </div>
        <Button type="submit" variant="primary" size="l" className="mt-6 w-full" loading={busy} disabled={!name.trim() || !designation.trim() || (password && password.length < 8)}>Continue</Button>
      </form>
    </AuthLayout>
  );
}

/* ───────────────────────── Claim earlier projects ───────────────────────── */
export function Claim() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next") || "/app";
  const [list, setList] = useState(null);
  const [keep, setKeep] = useState(new Set());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.get("/auth/claimable").then(({ data }) => { const l = Array.isArray(data) ? data : []; setList(l); setKeep(new Set(l.map((p) => p.id))); if (!l.length) navigate(next, { replace: true }); }).catch(() => navigate(next, { replace: true }));
  }, [navigate, next]);
  const submit = async () => {
    setBusy(true);
    try {
      const keep_ids = [...keep];
      const delete_ids = (list || []).filter((p) => !keep.has(p.id)).map((p) => p.id);
      const { data } = await api.post("/auth/claim", { keep_ids, delete_ids });
      toast.success(`${data.claimed} workspace${data.claimed === 1 ? "" : "s"} added to your account`);
      navigate(next, { replace: true });
    } catch (e) { toast.error(formatApiError(e)); } finally { setBusy(false); }
  };
  if (!list) return <FullScreenLoader />;
  return (
    <AuthLayout>
      <Seo title="Your earlier work" />
      <h1 className="text-display-s">We found earlier work under your email</h1>
      <p className="mt-2 text-body-m text-fg-tertiary">Keep the workspaces you want in your account. Unselected ones are deleted.</p>
      <Card className="mt-6 overflow-hidden">
        {list.map((p) => (
          <label key={p.id} htmlFor={`cl-${p.id}`} className="flex cursor-pointer items-center gap-3 border-b border-line-subtle px-4 py-3 last:border-0 hover:bg-hover">
            <Checkbox id={`cl-${p.id}`} checked={keep.has(p.id)} onChange={(v) => setKeep((s) => { const n = new Set(s); v ? n.add(p.id) : n.delete(p.id); return n; })} label={p.name} />
            <span className="flex-1 truncate text-body-m">{p.name || "Untitled"}</span>
          </label>
        ))}
      </Card>
      <Button variant="primary" size="l" className="mt-6 w-full" loading={busy} onClick={submit}>Continue</Button>
    </AuthLayout>
  );
}

/* ───────────────────────── Choose a plan (Razorpay) ───────────────────────── */
function loadRazorpay() {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}
export function Plan() {
  const { user, refresh, logout } = useAuth();
  const navigate = useNavigate();
  const [selected, setSelected] = useState("monthly");
  const [currency, setCurrency] = useState("inr");
  const [busy, setBusy] = useState(false);
  const [phOn, setPhOn] = useState(false);
  useEffect(() => { api.get("/public/ph-launch").then(({ data }) => setPhOn(!!data?.enabled)).catch(() => {}); }, []);
  const afterPaid = async () => {
    const u = await refresh();
    navigate(!u?.name || !u?.designation ? "/onboarding?next=%2Fapp" : "/app", { replace: true });
  };
  const pay = async () => {
    setBusy(true);
    try {
      const ok = await loadRazorpay();
      if (!ok) { toast.error("Couldn’t load the payment window — check your connection and retry."); setBusy(false); return; }
      const { data } = await api.post("/payments/razorpay/order", { plan_id: selected, currency });
      const rzp = new window.Razorpay({
        key: data.key_id, amount: data.amount, currency: data.currency, name: "Bracket", description: data.plan_label, order_id: data.order_id,
        prefill: { email: user?.email, name: user?.name }, theme: { color: "#08090A" },
        handler: async (resp) => {
          try {
            await api.post("/payments/razorpay/verify", { razorpay_order_id: resp.razorpay_order_id, razorpay_payment_id: resp.razorpay_payment_id, razorpay_signature: resp.razorpay_signature });
            toast.success("Payment received — welcome to Bracket");
            navigate("/payment/success", { replace: true });
          } catch (e) { toast.error(formatApiError(e)); navigate("/payment/cancel", { replace: true }); }
        },
        modal: { ondismiss: () => setBusy(false) },
      });
      rzp.on("payment.failed", (r) => { toast.error(r?.error?.description || "Payment failed — please try again."); setBusy(false); });
      rzp.open();
    } catch (e) { toast.error(formatApiError(e)); setBusy(false); }
  };
  const launchOffer = async () => {
    setBusy(true);
    try { await api.post("/payments/ph-activate"); toast.success("Launch offer activated"); await afterPaid(); } catch (e) { toast.error(formatApiError(e)); } finally { setBusy(false); }
  };
  const price = (p) => (currency === "inr" ? `₹${p.inr}` : `$${p.usd}`);
  return (
    <AuthLayout wide>
      <Seo title="Choose a plan" />
      <div className="text-center">
        <h1 className="text-display-s">Choose a plan</h1>
        <p className="mt-2 text-body-m text-fg-tertiary">Pay monthly for ongoing work, or once for a single project.</p>
        <div className="mt-5 inline-flex"><Segmented value={currency} onChange={setCurrency} options={[{ value: "inr", label: "₹ INR" }, { value: "usd", label: "$ USD" }]} /></div>
      </div>
      {phOn && user?.can_ph_launch && (
        <Banner tone="success" className="mt-6" title="Launch offer: your first project free for 14 days" action={<Button size="s" variant="primary" loading={busy} onClick={launchOffer}>Claim offer</Button>}>No card needed. You can choose a plan any time.</Banner>
      )}
      <div className="mt-6 grid gap-3 md:grid-cols-2" role="radiogroup" aria-label="Plans">
        {Object.values(PLANS).map((p) => {
          const on = selected === p.id;
          return (
            <button key={p.id} role="radio" aria-checked={on} onClick={() => setSelected(p.id)}
              className={cn("rounded-xl border p-5 text-left transition-colors", on ? "border-fg-secondary bg-raised" : "border-line bg-surface hover:border-line-strong")}>
              <div className="flex items-center justify-between">
                <p className="text-title-m">{p.name}</p>
                <span className={cn("inline-flex h-5 w-5 items-center justify-center rounded-full border", on ? "border-inverse bg-inverse text-fg-inverse" : "border-line-control")}>{on && <Check size={12} />}</span>
              </div>
              <p className="mt-3"><span className="text-[32px] font-semibold tracking-[-1px] num">{price(p)}</span> <span className="text-body-m text-fg-tertiary">/ {p.per}</span></p>
              <p className="mt-1 text-body-m text-fg-tertiary">{p.blurb}</p>
              <ul className="mt-4 space-y-2 text-body-m text-fg-secondary">
                {[p.limit, "Unlimited connected tools", "Living memory & change review", "Draft & send replies", "Ask Bracket with citations"].map((f) => (
                  <li key={f} className="flex items-center gap-2"><Check size={14} className="text-success" />{f}</li>
                ))}
              </ul>
            </button>
          );
        })}
      </div>
      <div className="mx-auto mt-6 max-w-[400px]">
        <Button variant="primary" size="l" className="w-full" loading={busy} onClick={pay}>
          Continue — {price(PLANS[selected])}{PLANS[selected].per === "month" ? " / month" : ""}
        </Button>
        <p className="mt-3 flex items-center justify-center gap-1.5 text-body-s text-fg-tertiary"><ShieldCheck size={13} /> Secure checkout by Razorpay. {currency === "inr" ? "Prices in ₹ include GST." : "USD prices exclude local taxes."}</p>
        <p className="mt-4 text-center text-body-s text-fg-tertiary">Signed in as {user?.email} · <button className="underline hover:text-fg" onClick={async () => { await logout(); navigate("/login"); }}>Sign out</button></p>
      </div>
    </AuthLayout>
  );
}

export function PaymentResult({ ok }) {
  const { refresh } = useAuth();
  const navigate = useNavigate();
  useEffect(() => { if (ok) refresh(); }, [ok, refresh]);
  return (
    <AuthLayout>
      <Seo title={ok ? "Payment received" : "Payment cancelled"} />
      <div className="text-center">
        <span className={cn("mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full border", ok ? "border-success/30 bg-success-bg text-success" : "border-line bg-raised text-fg-tertiary")}>
          {ok ? <Check size={22} /> : <Loader2 size={22} />}
        </span>
        <h1 className="mt-5 text-display-s">{ok ? "You’re all set" : "Payment cancelled"}</h1>
        <p className="mt-2 text-body-m text-fg-tertiary">{ok ? "Your plan is active. A receipt is on its way to your inbox." : "No charge was made. You can pick a plan whenever you’re ready."}</p>
        <Button variant="primary" size="l" className="mt-6 w-full" onClick={() => navigate(ok ? "/onboarding?next=%2Fwelcome" : "/plan", { replace: true })}>
          {ok ? "Set up your first workspace" : "Back to plans"}
        </Button>
      </div>
    </AuthLayout>
  );
}
