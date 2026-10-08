/* Admin panel API (mock) — owner only. Figma › 13 Admin panel.
   Contract mirrors backend/admin_v2.py; see docs/API_V2.md § Admin.

   Auth is separate from product accounts: one username + password checked on
   the server, a 30-minute sliding session in an httpOnly cookie scoped to
   /api/v2/admin, 5 wrong attempts from one address → 15-minute pause, and
   every sign-in and action written to an audit log.

   Metrics come from a deterministic synthetic customer base (so every screen
   has realistic numbers) plus live sandbox events from this mock session. */
const crypto = require("crypto");
const CREDS = require("./seed-admin");

const DAY = 864e5;
const FX = 83; // INR per USD for converted totals
const SESSION_MIN = 30;
const MAX_ATTEMPTS = 5;
const PAUSE_MIN = 15;
const PRICE = { monthly: { usd: 12, inr: 999 }, project: { usd: 2, inr: 199 } };

/* ───────────────────────── synthetic customers ───────────────────────── */
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const FIRST = ["Maya", "Ana", "Leo", "Kenji", "Priya", "Sofia", "Tom", "Ravi", "Elena", "Jon", "Chloe", "Arjun", "Hana", "Lucas", "Isla", "Noah", "Zara", "Omar", "Mei", "Felix", "Aisha", "Diego", "Nina", "Kabir", "Lea", "Sam", "Ines", "Yuki", "Theo", "Rhea", "Ben", "Lina", "Ivan", "Tara", "Owen", "Neha"];
const LAST = ["Rao", "Ruiz", "Martins", "Watanabe", "Nair", "Greco", "Becker", "Iyer", "Petrova", "Ellis", "Martin", "Mehta", "Kim", "Weber", "Brown", "Singh", "Haddad", "Chen", "Novak", "Okafor", "Silva", "Kapoor", "Dubois", "Larsen", "Costa", "Fischer", "Sato", "Moreau", "Bose", "Hughes", "Park", "Reyes"];
const STUDIO = ["Studio", "Design", "Co", "Labs", "Partners", "Works", "Legal", "Build", "Collective", "Agency"];
const PROVIDERS = [["gmail", 0.69], ["slack", 0.43], ["notes", 0.37], ["files", 0.26], ["meetings", 0.09]];
const CLIENTS = ["Acme Finance", "Kiln & Co", "Harbor Trust", "Northwind Labs", "Ravi Textiles", "Bluebird Health", "Juniper Foods", "Atlas Motors", "Cedar Legal", "Orbit Media"];
const WORK = ["Website redesign", "Brand refresh", "Annual report", "Mobile app", "Spring order", "Product launch", "Pitch deck", "Retainer", "Packaging", "Campaign"];

let USERS = null;
function users() {
  if (USERS) return USERS;
  const R = rng(42);
  const pick = (a) => a[Math.floor(R() * a.length)];
  const now = Date.now();
  USERS = [];
  for (let i = 0; i < 2377; i++) {
    const f = pick(FIRST), l = pick(LAST);
    const r = R();
    const age = r < 0.42 ? R() * 90 : r < 0.72 ? 90 + R() * 110 : 200 + R() * 220; // days since sign-up
    const created = now - age * DAY - R() * DAY;
    const india = R() < 0.28;
    const u = {
      id: "usr_" + (0x100000 + i * 7919).toString(16).slice(-6),
      name: `${f} ${l}`, email: `${f.toLowerCase()}@${l.toLowerCase()}${pick(["", "studio", "co", "design"])}.${india ? "in" : pick(["com", "co", "studio", "io", "dev"])}`,
      company: `${l} ${pick(STUDIO)}`, country: india ? "IN" : pick(["US", "GB", "DE", "FR", "ES", "IT", "JP", "AE", "SG", "NL"]), currency: india ? "inr" : "usd",
      sign_in: R() < 0.63 ? "google" : "password", created_at: created, trial_ends_at: created + 14 * DAY,
      from_sandbox: age < 150 && R() < 0.36, suspended: false, email_verified: R() < 0.97,
    };
    if (age < 14) {
      if (R() < 0.07) Object.assign(u, { plan: "monthly", status: "active", paid_since: created + R() * age * DAY });
      else Object.assign(u, { plan: "trial", status: "trialing" });
    } else if (R() < 0.234) {
      const paid = created + (8 + R() * 6) * DAY;
      if (R() < 0.8) {
        const s = R();
        Object.assign(u, { plan: "monthly", paid_since: paid, status: s < 0.03 ? "past_due" : s < 0.15 ? "canceled" : "active" });
        if (u.status === "canceled") u.canceled_at = paid + R() * (now - paid);
      } else {
        Object.assign(u, { plan: "project", paid_since: paid, status: now - paid < 60 * DAY ? "active" : "ended" });
      }
    } else Object.assign(u, { plan: "trial", status: "expired" });
    const busy = u.status === "active" || u.status === "past_due" || u.status === "trialing";
    u.last_active = busy ? now - R() * R() * (u.status === "trialing" ? 5 : 6) * DAY : Math.min(now - DAY, (u.canceled_at || u.trial_ends_at || created) + R() * 10 * DAY);
    u.projects = u.plan === "project" ? 1 : u.status === "trialing" ? Math.floor(R() * 4) : u.status === "expired" ? Math.floor(R() * 2) : 1 + Math.floor(R() * (u.plan === "monthly" ? 9 : 3));
    u.sources = u.projects ? PROVIDERS.filter(([, p]) => R() < p).map(([k]) => k) : [];
    if (u.projects && !u.sources.length) u.sources = ["gmail"];
    u.sync_error = u.sources.length && busy && R() < 0.012 ? pick(u.sources.includes("slack") ? ["slack"] : u.sources) : null;
    const act = busy ? 0.4 + R() : 0.05 * R();
    u.usage = { sessions: Math.round(act * 70), reviewed: Math.round(act * 48), accepted: 0, asks: Math.round(act * 60), replies: Math.round(act * 14) };
    u.usage.accepted = Math.round(u.usage.reviewed * (0.6 + R() * 0.25));
    if (u.status === "past_due") u.retry = { attempt: 1 + Math.floor(R() * 3), next_at: now + (1 + Math.floor(R() * 3)) * DAY, grace_ends_at: now + (3 + Math.floor(R() * 5)) * DAY };
    USERS.push(u);
  }
  // A known account for the user-detail screen.
  Object.assign(USERS[0], { id: "usr_8f21c4", name: "Maya Rao", email: "maya@northlight.studio", company: "Northlight Studio", country: "IN", currency: "inr", sign_in: "google", plan: "trial", status: "trialing", created_at: now - 11 * DAY, trial_ends_at: now + 3 * DAY, last_active: now - 2 * 60e3, projects: 3, sources: ["gmail", "slack", "notes"], sync_error: "slack", from_sandbox: true, usage: { sessions: 62, reviewed: 41, accepted: 34, asks: 57, replies: 12 } });
  return USERS;
}

/* ───────────────────────── helpers ───────────────────────── */
const fx = (amount, from, to) => (from === to ? amount : from === "inr" ? amount / FX : amount * FX);
const round = (n, d = 0) => Math.round(n * 10 ** d) / 10 ** d;
const pct = (a, b) => (b ? round((a / b) * 100, 1) : 0);
const delta = (cur, prev) => (prev ? round(((cur - prev) / prev) * 100, 0) : null);
const iso = (t) => (t ? new Date(t).toISOString() : null);
const isPaying = (u) => (u.plan === "monthly" && (u.status === "active" || u.status === "past_due")) || (u.plan === "project" && u.status === "active");
const mrrOf = (u, cur) => (u.plan === "monthly" && (u.status === "active" || u.status === "past_due") ? fx(PRICE.monthly[u.currency], u.currency, cur) : 0);
const statusKey = (u) => (u.suspended ? "suspended" : u.status === "trialing" ? "trial" : isPaying(u) && u.status !== "past_due" ? "paying" : u.status === "past_due" ? "past_due" : u.status === "canceled" ? "canceled" : "expired");
const planLabel = (u) => (u.suspended ? "Suspended" : u.status === "trialing" ? "Trial" : u.status === "past_due" ? "Past due" : u.status === "canceled" ? "Canceled" : u.plan === "monthly" ? "Monthly" : u.plan === "project" ? (u.status === "active" ? "Per project" : "Project ended") : "Expired");
const within = (t, days, offset = 0) => t >= Date.now() - (days + offset) * DAY && t < Date.now() - offset * DAY;
const trialDay = (u) => Math.max(1, Math.min(Math.round((u.trial_ends_at - u.created_at) / DAY), Math.ceil((Date.now() - u.created_at) / DAY)));

const summary = (u, cur) => ({
  id: u.id, name: u.name, email: u.email, company: u.company, plan: u.plan, status: statusKey(u), plan_label: planLabel(u),
  trial_day: u.status === "trialing" ? trialDay(u) : null, trial_length: Math.round((u.trial_ends_at - u.created_at) / DAY),
  projects: u.projects, sources: u.sources, last_active_at: iso(u.last_active), created_at: iso(u.created_at),
  mrr: u.plan === "project" && u.status === "active" ? { amount: PRICE.project[u.currency], currency: u.currency, one_time: true } : mrrOf(u, u.currency) ? { amount: PRICE.monthly[u.currency], currency: u.currency } : null,
  from_sandbox: u.from_sandbox,
});

/* ───────────────────────── register ───────────────────────── */
function register({ on, HttpError }) {
  const sessions = new Map(); // sha256(token) → { expires, created }
  const attempts = new Map(); // ip → { fails, paused_until }
  const audit = [];
  const sandboxEvents = [];
  const log = (action, ip, detail) => audit.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), action, ip, detail: detail || null });
  const hash = (t) => crypto.createHash("sha256").update(t).digest("hex");
  const ipOf = (req) => (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "local").split(",")[0].trim();
  const cookie = (token, maxAge) => `bk_admin=${token}; Path=/api/v2/admin; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`;

  const verify = (password) => {
    const [, salt, want] = String(CREDS.password_hash).split("$");
    if (!salt || !want) return false;
    const got = crypto.scryptSync(String(password || ""), salt, 32);
    const w = Buffer.from(want, "hex");
    return w.length === got.length && crypto.timingSafeEqual(w, got);
  };
  const sameText = (a, b) => {
    const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || ""));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
  };
  /* Throws 401 unless the request carries a live admin session; slides expiry. */
  const need = (cookies) => {
    const t = cookies.bk_admin;
    const s = t && sessions.get(hash(t));
    if (!s || s.expires < Date.now()) {
      if (s) sessions.delete(hash(t));
      throw new HttpError(401, "Your admin session ended. Sign in again.", { code: "admin_session" });
    }
    s.expires = Date.now() + SESSION_MIN * 60e3;
    return s;
  };
  const range = (q) => Math.min(365, Math.max(1, Number(q.range) || 30));
  const curOf = (q) => (q.currency === "inr" ? "inr" : "usd");

  on("POST", "/api/v2/admin/login", ({ body, req }) => {
    const ip = ipOf(req);
    const a = attempts.get(ip) || { fails: 0, paused_until: 0 };
    if (a.paused_until > Date.now()) {
      log("sign_in_blocked", ip);
      throw new HttpError(429, "Sign-in is paused for 15 minutes.", { code: "admin_paused", retry_at: new Date(a.paused_until).toISOString() });
    }
    const ok = sameText(body.username, CREDS.username) & verify(body.password); // evaluate both — no early exit
    if (!ok) {
      a.fails += 1;
      if (a.fails >= MAX_ATTEMPTS) { a.paused_until = Date.now() + PAUSE_MIN * 60e3; a.fails = 0; }
      attempts.set(ip, a);
      log("sign_in_failed", ip);
      if (a.paused_until > Date.now()) throw new HttpError(429, "Sign-in is paused for 15 minutes.", { code: "admin_paused", retry_at: new Date(a.paused_until).toISOString() });
      throw new HttpError(401, "Incorrect username or password.", { code: "admin_credentials", attempts_left: MAX_ATTEMPTS - a.fails });
    }
    attempts.delete(ip);
    const token = crypto.randomBytes(32).toString("base64url");
    const expires = Date.now() + SESSION_MIN * 60e3;
    sessions.set(hash(token), { expires, created: Date.now() });
    log("sign_in", ip);
    return { ok: true, username: CREDS.username, expires_at: new Date(expires).toISOString(), __cookies: [cookie(token, SESSION_MIN * 60)] };
  });
  on("GET", "/api/v2/admin/session", ({ cookies }) => {
    const s = need(cookies);
    return { username: CREDS.username, expires_at: new Date(s.expires).toISOString(), minutes: SESSION_MIN };
  });
  on("POST", "/api/v2/admin/logout", ({ cookies, req }) => {
    if (cookies.bk_admin) sessions.delete(hash(cookies.bk_admin));
    log("sign_out", ipOf(req));
    return { ok: true, __cookies: [cookie("", 0)] };
  });

  /* Overview — Figma 205:58 */
  on("GET", "/api/v2/admin/overview", ({ q, cookies }) => {
    need(cookies);
    const R = range(q), cur = curOf(q), U = users();
    const signups = U.filter((u) => within(u.created_at, R)).length;
    const prevSignups = U.filter((u) => within(u.created_at, R, R)).length;
    const active = (days) => U.filter((u) => !u.suspended && u.last_active >= Date.now() - days * DAY).length;
    const paying = U.filter(isPaying);
    const mrr = U.reduce((s, u) => s + mrrOf(u, cur), 0);
    const mrrInr = U.filter((u) => u.currency === "inr").reduce((s, u) => s + mrrOf(u, "inr"), 0);
    const newMrr = U.filter((u) => u.paid_since && within(u.paid_since, R)).reduce((s, u) => s + mrrOf(u, cur), 0);
    const cohort = U.filter((u) => u.created_at >= Date.now() - (R + 14) * DAY && u.created_at < Date.now() - 14 * DAY);
    const converted = cohort.filter((u) => u.plan === "monthly" || u.plan === "project");
    const canceled30 = U.filter((u) => u.canceled_at && within(u.canceled_at, 30)).length;
    const monthly = U.filter((u) => u.plan === "monthly" && (u.status === "active" || u.status === "past_due")).length;
    const pastDue = U.filter((u) => u.status === "past_due");
    const createdWs = U.reduce((s, u) => s + u.projects, 0);
    const activeWs = U.filter((u) => u.last_active >= Date.now() - 30 * DAY && u.status !== "expired").reduce((s, u) => s + u.projects, 0);
    const series = Array.from({ length: Math.min(R, 90) }, (_, i) => {
      const day = Math.min(R, 90) - 1 - i;
      return { date: new Date(Date.now() - day * DAY).toISOString().slice(0, 10), signups: U.filter((u) => u.created_at >= Date.now() - (day + 1) * DAY && u.created_at < Date.now() - day * DAY).length };
    });
    const live = sandboxEvents.filter((e) => e.type === "start" && within(Date.parse(e.at), R)).length;
    const sbOpened = Math.round(signups * 3.99) + live;
    const withSources = U.filter((u) => u.sources.length);
    return {
      range: R, currency: cur, updated_at: new Date().toISOString(),
      kpis: {
        signups: { value: signups, delta_pct: delta(signups, prevSignups) },
        active_users: { dau: active(1), wau: active(7), mau: active(30) },
        mrr: { value: round(mrr, 2), currency: cur, new: round(newMrr, 2), inr_value: round(mrrInr, 0) },
        trial_to_paid: { pct: pct(converted.length, cohort.length), converted: converted.length, trials: cohort.length },
        paying: { value: paying.length, monthly: paying.filter((u) => u.plan === "monthly").length, project: paying.filter((u) => u.plan === "project").length },
        churn: { pct: pct(canceled30, monthly + canceled30), canceled: canceled30 },
        workspaces: { active: activeWs, created: createdWs },
        failed_payments: { value: pastDue.length, at_risk: round(pastDue.reduce((s, u) => s + fx(PRICE.monthly[u.currency], u.currency, cur), 0), 2), currency: cur },
      },
      signups_series: series,
      funnel: [
        { key: "sandbox", label: "Sandbox opened", value: sbOpened },
        { key: "tour", label: "Finished the tour", value: Math.round(sbOpened * 0.45) },
        { key: "signup", label: "Signed up", value: signups },
        { key: "trial", label: "Started a trial", value: Math.round(signups * 0.927) },
        { key: "paid", label: "Became paying", value: U.filter((u) => u.paid_since && within(u.paid_since, R)).length },
      ],
      sources: PROVIDERS.map(([k]) => ({ provider: k, count: withSources.filter((u) => u.sources.includes(k)).length })),
      health: {
        sync_failures: U.filter((u) => u.sync_error).length,
        review_acceptance_pct: pct(U.reduce((s, u) => s + u.usage.accepted, 0), U.reduce((s, u) => s + u.usage.reviewed, 0)),
        asks_per_day: Math.round(U.reduce((s, u) => s + u.usage.asks, 0) / 30),
        high_confidence_pct: 82,
        replies_per_day: Math.round(U.reduce((s, u) => s + u.usage.replies, 0) / 30),
      },
      latest: [...U].sort((a, b) => b.created_at - a.created_at).slice(0, 5).map((u) => summary(u, cur)),
    };
  });

  /* Users — Figma 207:193 */
  on("GET", "/api/v2/admin/users", ({ q, cookies }) => {
    need(cookies);
    const U = users();
    const counts = { all: U.length, trial: 0, paying: 0, past_due: 0, canceled: 0, expired: 0, suspended: 0 };
    U.forEach((u) => { counts[statusKey(u)] += 1; });
    const s = (q.q || "").trim().toLowerCase();
    let list = U.filter((u) => (!q.status || q.status === "all" || statusKey(u) === q.status) && (!s || u.name.toLowerCase().includes(s) || u.email.includes(s) || u.company.toLowerCase().includes(s)));
    const sort = q.sort || "last_active";
    const key = { last_active: (u) => -u.last_active, signed_up: (u) => -u.created_at, projects: (u) => -u.projects, name: (u) => u.name };
    const k = key[sort] || key.last_active;
    list = list.sort((a, b) => (k(a) < k(b) ? -1 : k(a) > k(b) ? 1 : 0));
    const size = q.export ? 5000 : Math.min(100, Math.max(5, Number(q.size) || 25));
    const page = Math.max(1, Number(q.page) || 1);
    return { total: list.length, page, size, counts, users: list.slice((page - 1) * size, page * size).map((u) => summary(u)) };
  });

  on("GET", "/api/v2/admin/users/:uid", ({ p, cookies }) => {
    need(cookies);
    const u = users().find((x) => x.id === p.uid);
    if (!u) throw new HttpError(404, "No user with that ID.");
    const R = rng(parseInt(u.id.slice(4), 16));
    const pick = (a) => a[Math.floor(R() * a.length)];
    const workspaces = Array.from({ length: u.projects }, (_, i) => {
      const src = u.sources.filter(() => R() < 0.7);
      return { id: `w_${u.id.slice(4)}_${i}`, name: i === 0 && u.id === "usr_8f21c4" ? "Fintech Landing Page Redesign" : pick(WORK), client: i === 0 && u.id === "usr_8f21c4" ? "Acme Finance" : pick(CLIENTS), sources: src.length ? src : u.sources.slice(0, 1), memories: 5 + Math.floor(R() * 40), attention: R() < 0.4 ? 1 + Math.floor(R() * 3) : 0 };
    });
    const busy = u.last_active >= Date.now() - 30 * DAY;
    const activity = Array.from({ length: 30 }, (_, i) => {
      const t = Date.now() - (29 - i) * DAY;
      return { date: new Date(t).toISOString().slice(0, 10), sessions: t < u.created_at || !busy ? 0 : Math.floor(R() * 10) };
    });
    const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString();
    return {
      ...summary(u),
      country: u.country, currency: u.currency, sign_in: u.sign_in, email_verified: u.email_verified, suspended: u.suspended, suspended_reason: u.suspended_reason || null,
      trial_ends_at: iso(u.trial_ends_at), paid_since: iso(u.paid_since), canceled_at: iso(u.canceled_at),
      billing: {
        status: statusKey(u), plan_label: planLabel(u), currency: u.currency,
        payment_method: isPaying(u) || u.status === "past_due" ? { brand: u.currency === "inr" ? "RuPay" : "Visa", last4: String(1000 + Math.floor(R() * 8999)) } : null,
        invoices: u.paid_since ? Math.max(1, Math.round((Math.min(Date.now(), u.canceled_at || Date.now()) - u.paid_since) / (30 * DAY))) : 0,
        lifetime_value: u.plan === "project" ? PRICE.project[u.currency] : u.paid_since ? PRICE.monthly[u.currency] * Math.max(1, Math.round((Math.min(Date.now(), u.canceled_at || Date.now()) - u.paid_since) / (30 * DAY))) : 0,
        retry: u.retry ? { ...u.retry, next_at: iso(u.retry.next_at), grace_ends_at: iso(u.retry.grace_ends_at) } : null,
      },
      workspaces,
      sources: u.sources.map((s) => ({ provider: s, label: { gmail: `${1 + Math.floor(R() * 6)} threads`, slack: "#" + pick(["acme-redesign", "client-work", "general", "launch"]), notes: `${1 + Math.floor(R() * 9)} notes`, files: `${1 + Math.floor(R() * 12)} files`, meetings: `${1 + Math.floor(R() * 5)} transcripts` }[s], status: u.sync_error === s ? "error" : "synced", error: u.sync_error === s ? (s === "slack" ? "Token revoked" : "Access expired") : null, since: u.sync_error === s ? ago(6) : ago(R() * 3) })),
      activity, usage: u.usage,
      account: { members_invited: Math.floor(R() * 3), last_device: pick(["Chrome on macOS", "Safari on iPhone", "Chrome on Windows", "Edge on Windows"]), last_city: u.country === "IN" ? pick(["Mumbai", "Bengaluru", "Delhi", "Pune"]) : pick(["London", "Berlin", "New York", "Madrid", "Tokyo"]) },
      actions: audit.filter((a) => a.detail?.user_id === u.id).slice(0, 10),
    };
  });

  on("POST", "/api/v2/admin/users/:uid/extend-trial", ({ p, body, cookies, req }) => {
    need(cookies);
    const u = users().find((x) => x.id === p.uid);
    if (!u) throw new HttpError(404, "No user with that ID.");
    if (!(u.status === "trialing" || u.status === "expired") || u.paid_since) throw new HttpError(409, "Only accounts on a trial, or whose trial ended, can be extended.");
    const days = Number(body.days);
    if (![7, 14].includes(days)) throw new HttpError(422, "Choose 7 or 14 days.");
    if (!String(body.reason || "").trim()) throw new HttpError(422, "Add a reason for the audit log.", { field: "reason" });
    const base = Math.max(Date.now(), u.trial_ends_at);
    u.trial_ends_at = base + days * DAY;
    u.status = "trialing"; u.plan = "trial";
    log("extend_trial", ipOf(req), { user_id: u.id, days, reason: body.reason, notified: !!body.notify });
    return { ok: true, trial_ends_at: iso(u.trial_ends_at), notified: !!body.notify };
  });
  on("POST", "/api/v2/admin/users/:uid/suspend", ({ p, body, cookies, req }) => {
    need(cookies);
    const u = users().find((x) => x.id === p.uid);
    if (!u) throw new HttpError(404, "No user with that ID.");
    if (!String(body.reason || "").trim()) throw new HttpError(422, "Add a reason for the audit log.", { field: "reason" });
    Object.assign(u, { suspended: true, suspended_reason: body.reason });
    log("suspend", ipOf(req), { user_id: u.id, reason: body.reason });
    return { ok: true };
  });
  on("POST", "/api/v2/admin/users/:uid/unsuspend", ({ p, cookies, req }) => {
    need(cookies);
    const u = users().find((x) => x.id === p.uid);
    if (!u) throw new HttpError(404, "No user with that ID.");
    Object.assign(u, { suspended: false, suspended_reason: null });
    log("unsuspend", ipOf(req), { user_id: u.id });
    return { ok: true };
  });

  /* Revenue — Figma 208:433 */
  on("GET", "/api/v2/admin/revenue", ({ q, cookies }) => {
    need(cookies);
    const R = range(q), cur = curOf(q), U = users();
    const live = (t) => U.filter((u) => u.plan === "monthly" && u.paid_since <= t && (!u.canceled_at || u.canceled_at > t) && !(u.status === "canceled" && !u.canceled_at));
    const mrrAt = (t) => live(t).reduce((s, u) => ({ usd: s.usd + (u.currency === "usd" ? fx(12, "usd", cur) : 0), inr: s.inr + (u.currency === "inr" ? fx(999, "inr", cur) : 0) }), { usd: 0, inr: 0 });
    const months = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - (11 - i) + 1); d.setDate(0); // last day of month
      const t = Math.min(Date.now(), d.getTime());
      const m = mrrAt(t);
      return { month: new Date(t).toLocaleDateString("en-US", { month: "short" }), usd: round(m.usd, 2), inr: round(m.inr, 2) };
    });
    const now = mrrAt(Date.now()), prev = mrrAt(Date.now() - R * DAY);
    const monthly = U.filter((u) => u.plan === "monthly" && (u.status === "active" || u.status === "past_due"));
    const projects = U.filter((u) => u.plan === "project" && within(u.paid_since, R));
    const mrr = now.usd + now.inr;
    const tenure = U.filter((u) => u.plan === "monthly" && u.paid_since).map((u) => ((u.canceled_at || Date.now()) - u.paid_since) / (30 * DAY));
    return {
      range: R, currency: cur,
      kpis: {
        mrr: { value: round(mrr, 2), net_new: round(mrr - (prev.usd + prev.inr), 2) },
        inr: { value: round(monthly.filter((u) => u.currency === "inr").length * 999, 0) },
        arpa: { value: monthly.length ? round(mrr / monthly.length, 2) : 0 },
        per_project: { count: projects.length, amount: round(projects.reduce((s, u) => s + fx(PRICE.project[u.currency], u.currency, cur), 0), 2) },
      },
      months,
      mix: [
        { key: "monthly_usd", label: "Monthly · USD", count: monthly.filter((u) => u.currency === "usd").length, amount: monthly.filter((u) => u.currency === "usd").length * 12, currency: "usd" },
        { key: "monthly_inr", label: "Monthly · INR", count: monthly.filter((u) => u.currency === "inr").length, amount: monthly.filter((u) => u.currency === "inr").length * 999, currency: "inr" },
        { key: "project_usd", label: "Per project · USD", count: projects.filter((u) => u.currency === "usd").length, amount: projects.filter((u) => u.currency === "usd").length * 2, currency: "usd" },
        { key: "project_inr", label: "Per project · INR", count: projects.filter((u) => u.currency === "inr").length, amount: projects.filter((u) => u.currency === "inr").length * 199, currency: "inr" },
      ],
      avg_tenure_months: tenure.length ? round(tenure.reduce((a, b) => a + b, 0) / tenure.length, 1) : 0,
      failed_payments: U.filter((u) => u.status === "past_due").map((u) => ({ user_id: u.id, name: u.name, amount: PRICE.monthly[u.currency], currency: u.currency, attempt: u.retry.attempt, of: 3, next_retry_at: u.retry.attempt >= 3 ? null : iso(u.retry.next_at), grace_ends_at: iso(u.retry.grace_ends_at) })),
    };
  });

  /* Usage & health — Figma 208:764 */
  on("GET", "/api/v2/admin/usage", ({ q, cookies }) => {
    need(cookies);
    const U = users();
    const weekly = U.filter((u) => u.last_active >= Date.now() - 7 * DAY);
    const share = (f) => pct(weekly.filter(f).length, weekly.length);
    const withSources = U.filter((u) => u.sources.length);
    const reviewed = U.reduce((s, u) => s + u.usage.reviewed, 0);
    const errs = U.filter((u) => u.sync_error);
    const by = (p) => errs.filter((u) => u.sync_error === p).length;
    return {
      range: range(q),
      kpis: {
        review_acceptance: { pct: pct(U.reduce((s, u) => s + u.usage.accepted, 0), reviewed), reviewed },
        asks: { per_day: Math.round(U.reduce((s, u) => s + u.usage.asks, 0) / 30), high_confidence_pct: 82 },
        replies: { per_day: Math.round(U.reduce((s, u) => s + u.usage.replies, 0) / 30) },
        sync_failures: { value: errs.length },
      },
      sources: PROVIDERS.map(([k]) => ({ provider: k, count: withSources.filter((u) => u.sources.includes(k)).length, pct: pct(withSources.filter((u) => u.sources.includes(k)).length, withSources.length) })),
      features: [
        { key: "review", label: "Change review", pct: share((u) => u.usage.reviewed > 0) },
        { key: "ask", label: "Ask Bracket", pct: share((u) => u.usage.asks > 20) },
        { key: "replies", label: "Draft replies", pct: share((u) => u.usage.replies > 6) },
        { key: "restore", label: "Timeline restore", pct: 12 },
        { key: "invite", label: "Invite members", pct: 9 },
      ],
      sync_failures: [
        { provider: "slack", error: "Token revoked by workspace admin", workspaces: by("slack"), since: new Date(Date.now() - 6 * 3600e3).toISOString() },
        { provider: "gmail", error: "Google consent expired", workspaces: by("gmail"), since: new Date(Date.now() - DAY).toISOString() },
        { provider: "notes", error: "File too large (over 25 MB)", workspaces: by("notes"), since: new Date(Date.now() - 2 * DAY).toISOString() },
        { provider: "files", error: "Couldn’t read a scanned PDF", workspaces: by("files"), since: new Date(Date.now() - 3 * DAY).toISOString() },
      ].filter((r) => r.workspaces > 0),
    };
  });

  /* Sandbox — Figma 208:1053 */
  on("GET", "/api/v2/admin/sandbox", ({ q, cookies }) => {
    need(cookies);
    const R = range(q), U = users();
    const signups = U.filter((u) => within(u.created_at, R) && u.from_sandbox).length;
    const prev = U.filter((u) => within(u.created_at, R, R) && u.from_sandbox).length;
    const live = sandboxEvents.filter((e) => within(Date.parse(e.at), R));
    const liveStarts = live.filter((e) => e.type === "start").length;
    const sessionsN = Math.round(signups * 11.1) + liveStarts;
    const prevN = Math.round(prev * 11.1);
    const steps = [1, 0.78, 0.64, 0.54, 0.45];
    const liveSteps = [1, 2, 3, 4, 5].map((n) => live.filter((e) => e.type === "tour_step" && Number(e.step) === n).length);
    const lockedLive = (a) => live.filter((e) => e.type === "locked" && e.action === a).length;
    return {
      range: R,
      kpis: {
        sessions: { value: sessionsN, delta_pct: delta(sessionsN, prevN) },
        finished_tour: { pct: 45, count: Math.round(sessionsN * 0.45) },
        to_signup: { pct: pct(signups, sessionsN), count: signups },
        median_time_s: 220,
      },
      steps: ["Needs your attention", "Review a change", "Ask Bracket", "Play a client message", "What you pay for"].map((label, i) => ({ step: i + 1, label, count: Math.round(sessionsN * steps[i]) + liveSteps[i] })),
      locked: [["connect", "Connect Gmail or Slack", 0.28], ["note", "Add a note", 0.06], ["invite", "Invite a member", 0.067], ["upload", "Upload a file", 0.058], ["send", "Send a reply", 0.054]].map(([k, label, r]) => ({ action: k, label, count: Math.round(sessionsN * r) + lockedLive(k) })),
      actions: [
        { key: "play", label: "Played a client message", per_session: 2.4, pct: 61 },
        { key: "accept", label: "Accepted a change", per_session: 1.8, pct: 58 },
        { key: "ask", label: "Asked a question", per_session: 1.3, pct: 44 },
        { key: "source", label: "Opened a source", per_session: 1.1, pct: 39 },
        { key: "reset", label: "Reset the sandbox", per_session: 0.2, pct: 11 },
      ],
      live: { sessions: liveStarts, events: live.length },
    };
  });

  on("GET", "/api/v2/admin/audit", ({ cookies }) => { need(cookies); return { items: audit.slice(0, 100) }; });

  return { sandbox: (e) => sandboxEvents.push({ ...e, at: new Date().toISOString() }) };
}

module.exports = { register };
