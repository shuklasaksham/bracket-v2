/* Sandbox — try Bracket without connecting tools or paying.
   Figma › 12 Sandbox. Contract in docs/API_V2.md § Sandbox.

   A sandbox session is an anonymous guest who plays Maya Rao (design lead at
   Northlight Studio) on the seeded Acme Finance project. Everything that
   would touch a real account — connecting tools, uploading, inviting,
   sending, paying — answers 403 { code: "sandbox_locked", action } and the
   app shows the "start a free trial" prompt instead.

   "Play next client message" applies one scripted beat at a time so the
   visitor can watch Bracket read a message, update memory and flag changes. */
const { uid } = require("./seed");

const now = () => new Date().toISOString();

/* Routes a sandbox guest can't use, with the action name the UI explains. */
const LOCKED = [
  ["POST", /^\/api\/v2\/w\/[^/]+\/sources\/connect$/, "connect"],
  ["POST", /^\/api\/v2\/w\/[^/]+\/sources\/add$/, "connect"],
  ["POST", /^\/api\/v2\/w\/[^/]+\/sources\/[^/]+\/(threads|reconnect|disconnect)$/, "connect"],
  ["POST", /^\/api\/v2\/w\/[^/]+\/onboarding\//, "connect"],
  ["POST", /^\/api\/v2\/w\/[^/]+\/notes$/, "note"],
  ["POST", /^\/api\/v2\/w\/[^/]+\/files(\/[^/]+\/replace)?$/, "upload"],
  ["DELETE", /^\/api\/v2\/w\/[^/]+\/files\//, "upload"],
  ["POST", /^\/api\/v2\/w\/[^/]+\/members\/invite$/, "invite"],
  ["POST", /^\/api\/v2\/w\/[^/]+\/threads\/[^/]+\/send$/, "send"],
  ["POST", /^\/api\/v2\/w\/[^/]+\/messages$/, "send"],
  ["POST", /^\/api\/v2\/workspaces$/, "workspace"],
  ["POST", /^\/api\/v2\/w\/[^/]+\/(delete|archive|leave|export)$/, "workspace"],
  ["POST", /^\/api\/v2\/billing\//, "billing"],
  ["PATCH", /^\/api\/v2\/billing$/, "billing"],
  ["DELETE", /^\/api\/v2\/me$/, "account"],
  ["POST", /^\/api\/v2\/me\//, "account"],
  ["PATCH", /^\/api\/auth\/me$/, "account"],
  ["POST", /^\/api\/auth\/password\//, "account"],
];

const LOCKED_COPY = {
  connect: "Connecting your own tools starts a free trial.",
  note: "Adding your own notes starts a free trial.",
  upload: "Adding your own files starts a free trial.",
  invite: "Inviting your team starts a free trial.",
  send: "Sending replies from your inbox starts a free trial.",
  workspace: "Creating your own workspaces starts a free trial.",
  billing: "Plans and billing start after the sandbox.",
  account: "The sandbox has no account to change.",
};

/* Scripted client messages, played in order. Each mutates the seeded state the
   same way a real sync would: a message lands in a conversation, Bracket
   flags what changed, and the overview, timeline and updates follow. */
const BEATS = [
  {
    key: "assets",
    summary: "Sarah Chen sent the brand assets · 1 commitment completed",
    apply(S) {
      const at = now();
      const t = S.threads.find((x) => x.id === "t4");
      if (t) {
        t.messages.push({ id: uid("mm"), author: "Sarah Chen", at, body: [
          { text: "Hi Maya, sorry for the wait! Attached are the logo files and the font licences." },
          { text: "Brand assets are attached: logos (SVG, PNG) and fonts.", tag: "Commitment met", tone: "success" },
        ] });
        Object.assign(t, { at, count: t.count + 1, preview: "Attached are the logo files and the font licences.", badge: { tone: "success", label: "Assets received" }, needs_reply: false });
        delete t.alert;
      }
      S.attention = S.attention.filter((a) => a.id !== "a3");
      S.events.unshift({ id: uid("ev"), short: "Sarah Chen sent the brand assets", icon: "mail", at, kind: "commitment_completed", title: "Commitment completed — brand assets received", actor: { provider: "gmail", label: "Sarah Chen" }, meta: "Acme Finance delivered logos and fonts · 8 days late", dot: "success", memory: true, source: "gmail", thread_id: "t4" });
      S.updates.unshift({ id: uid("u"), group: "memory", icon: "changed", title: "Brand assets received from Sarah Chen", sub: "Commitment completed", at, read: false, link: { kind: "thread", id: "t4", workspace: "p1" } });
    },
  },
  {
    key: "blog",
    summary: "James Park asked for a blog · 2 changes to review",
    apply(S) {
      const at = now();
      const body = [
        { text: "Hi Maya, quick one from our side." },
        { text: "Could we add a blog section before launch? Marketing wants to publish two articles in week one.", tags: ["Scope", "Deliverables"] },
        { text: "Happy to discuss what it means for the timeline.\n\nJames" },
      ];
      S.threads.unshift({ id: "t9", provider: "gmail", kind: "email", title: "Blog for launch?", who: "James Park", participants: "James Park, Maya Rao", to_email: "james.park@acmefinance.com", count: 1, started_at: at, at,
        preview: "Could we add a blog section before launch?", badge: { tone: "warning", label: "2 changes to review" }, needs_reply: true, earlier: null,
        messages: [{ id: uid("mm"), author: "James Park", at, body: [body[0], { text: body[1].text, tag: "Scope change", tone: "warning" }, body[2]] }],
        would_change: [{ category: "Scope", text: "Homepage, four inner pages and a blog" }, { category: "Deliverables", text: "Blog index and article templates" }],
        created: [], referenced: [{ category: "Scope", text: "Marketing homepage plus four inner pages", id: "sc2" }], review_id: "r3", can_send: true });
      S.reviews.unshift({ id: "r3", kind: "scope_change", status: "pending", label: "Potential scope change",
        title: "James asked to add a blog section before launch",
        detected: { count: 1, unit: "email", at },
        interpretation: "James wants a blog live in launch week. The proposal covers the homepage and four inner pages only, so this adds pages and templates. Nothing changes until you accept.",
        trigger: { provider: "gmail", source_id: "s_gmail", thread_id: "t9", from: "James Park", to: "Maya Rao", at, subject: "Blog for launch?", body },
        compared: [{ memory_id: "sc2", text: "Marketing homepage plus four inner pages.", chip: { provider: "gmail", label: "Proposal · Sep 12" } }],
        proposals: [
          { id: "p1", category: "scope", op: "modify", target: "sc2", before: "Marketing homepage plus four inner pages.", after: "Marketing homepage, four inner pages and a blog.", confidence: "high", rationale: "James asks to “add a blog section before launch.”" },
          { id: "p2", category: "deliverable", op: "add", after: "Blog index and article page templates.", confidence: "medium", rationale: "A blog needs at least an index and an article layout; James didn’t specify more." },
        ],
        reply_to: "James" });
      S.attention.forEach((a) => { if (a.action) a.action.primary = false; });
      S.attention.unshift({ id: "a6", kind: "scope_change", tone: "warning", eyebrow: "Potential scope change · affects 2 memories", title: "James asked to add a blog section before launch",
        detail: "A blog isn’t in the proposal. It adds pages and templates in launch week.", chip: { provider: "gmail", label: "James Park", at },
        action: { label: "Review 2 changes", kind: "review", target: "r3", primary: true } });
      S.events.unshift({ id: uid("ev"), at, kind: "change_detected", title: "Change detected — blog section requested", actor: { provider: "gmail", label: "James Park" }, meta: "2 proposed updates · waiting for your review", dot: "warning", review_id: "r3" });
      S.updates.unshift({ id: uid("u"), group: "attention", icon: "warning", title: "Scope change detected from James Park", sub: "Fintech Landing Page", at, read: false, link: { kind: "review", id: "r3", workspace: "p1" } });
    },
  },
  {
    key: "staging",
    summary: "Dev Patel shared the staging link · 1 commitment completed",
    apply(S) {
      const at = now();
      const c = S.threads.find((x) => x.id === "C1");
      if (c) {
        c.messages.push({ id: uid("sm"), author: "Dev Patel", at, body: [{ text: "Staging is up with the CMS wired: acme-staging.webflow.io", tag: "Commitment met", tone: "success" }] });
        Object.assign(c, { at, count: c.count + 1, preview: "Staging is up with the CMS wired." });
      }
      S.attention = S.attention.filter((a) => a.id !== "a4");
      S.events.unshift({ id: uid("ev"), short: "Dev Patel shared the staging link", icon: "added", at, kind: "commitment_completed", title: "Commitment completed — staging link shared", actor: { provider: "slack", label: "Dev Patel" }, meta: "#acme-redesign", dot: "success", memory: true, source: "slack" });
    },
  },
  {
    key: "launch",
    summary: "Sarah agreed to move the launch · 1 change to review",
    apply(S) {
      const at = now();
      const body = [
        { text: "Hi Maya, we talked internally." },
        { text: "Let’s move the launch to Friday Oct 24 so tablet can ship with everything else.", tags: ["Commitments"] },
        { text: "Sarah" },
      ];
      const t = S.threads.find((x) => x.id === "t1");
      if (t) {
        t.messages.push({ id: uid("mm"), author: "Sarah Chen", at, body: [body[0], { text: body[1].text, tag: "Commitment", tone: "warning" }, body[2]] });
        Object.assign(t, { at, count: t.count + 1, preview: "Let’s move the launch to Friday Oct 24..." });
      }
      S.reviews.unshift({ id: "r4", kind: "decision", status: "pending", label: "Timeline change",
        title: "Sarah agreed to move the launch to Oct 24",
        detected: { count: 1, unit: "email", at },
        interpretation: "Sarah is moving the launch a week so tablet layouts fit. This replaces the Oct 17 date agreed at kickoff and settles the open timeline conflict.",
        trigger: { provider: "gmail", source_id: "s_gmail", thread_id: "t1", from: "Sarah Chen", to: "Maya Rao", at, subject: "Re: Homepage direction + next steps", body },
        compared: [{ memory_id: "co3", text: "Launch two weeks after kickoff — Oct 17.", chip: { provider: "notes", label: "Kickoff call · Oct 3" } }],
        proposals: [{ id: "p1", category: "commitment", op: "modify", target: "co3", before: "Launch two weeks after kickoff — Oct 17.", after: "Launch on Fri Oct 24, including tablet layouts.", confidence: "high", rationale: "Sarah writes “let’s move the launch to Friday Oct 24.”" }],
        reply_to: "Sarah" });
      S.attention.forEach((a) => { if (a.action) a.action.primary = false; });
      S.attention = S.attention.filter((a) => a.id !== "a2");
      S.attention.unshift({ id: "a7", kind: "decision", tone: "warning", eyebrow: "Timeline change · affects 1 memory", title: "Sarah agreed to move the launch to Oct 24",
        detail: "This replaces the Oct 17 date and settles the timeline conflict.", chip: { provider: "gmail", label: "Sarah Chen", at },
        action: { label: "Review 1 change", kind: "review", target: "r4", primary: true } });
      S.events.unshift({ id: uid("ev"), at, kind: "change_detected", title: "Change detected — launch moved to Oct 24", actor: { provider: "gmail", label: "Sarah Chen" }, meta: "1 proposed update · waiting for your review", dot: "warning", review_id: "r4" });
      S.updates.unshift({ id: uid("u"), group: "attention", icon: "warning", title: "Sarah Chen moved the launch date", sub: "Fintech Landing Page", at, read: false, link: { kind: "review", id: "r4", workspace: "p1" } });
    },
  },
  {
    key: "invoice",
    summary: "Acme Finance paid invoice #0042",
    apply(S) {
      const at = now();
      const t = S.threads.find((x) => x.id === "t5");
      if (t) {
        t.messages.push({ id: uid("im"), author: "Acme Finance AP", at, body: [{ text: "Thanks for adding the PO number. Invoice #0042 has been paid." }] });
        Object.assign(t, { at, count: t.count + 1, preview: "Invoice #0042 has been paid." });
      }
      S.attention = S.attention.filter((a) => a.id !== "a5");
      S.events.unshift({ id: uid("ev"), at, kind: "email_received", title: "Email received — invoice #0042 paid", actor: { provider: "gmail", label: "Acme Finance AP" }, meta: "Nothing to review", source: "gmail", thread_id: "t5" });
    },
  },
];

function register({ on, HttpError, state, reset, setLoggedIn, analytics }) {
  let session = null; // { id, started_at, beat, tour_step, locked: {}, actions: {} }

  const apply = () => {
    reset();
    const S = state();
    S.me = { ...S.me, is_sandbox: true, sandbox_id: session.id };
    S.workspaces = S.workspaces.filter((w) => w.id === "p1").map((w) => ({ ...w, is_sandbox: true }));
    S.primaryIds = new Set(["p1"]);
    Object.assign(S.billing, { plan: "sandbox", status: "sandbox", label: "Sandbox", amount: 0, card: null, invoices: [], renews_on: null, trial_ends_at: null, workspaces: { used: 1, limit: 1 } });
    S.sessions = S.sessions.filter((s) => s.current);
    setLoggedIn(true);
  };
  const view = () => session && ({ id: session.id, beat: session.beat, total: BEATS.length, done: session.beat >= BEATS.length, tour_step: session.tour_step, started_at: session.started_at });

  on("POST", "/api/v2/sandbox/start", () => {
    session = { id: uid("sbx"), started_at: now(), beat: 0, tour_step: 1, locked: {}, actions: {} };
    apply();
    analytics.sandbox({ type: "start", id: session.id });
    return { ok: true, workspace_id: "p1", sandbox: view() };
  });
  on("GET", "/api/v2/sandbox", () => ({ active: !!session, sandbox: view() }));
  on("POST", "/api/v2/sandbox/next", () => {
    if (!session) throw new HttpError(404, "The sandbox isn’t open.");
    if (session.beat >= BEATS.length) return { done: true, step: session.beat, total: BEATS.length, beat: null };
    const b = BEATS[session.beat];
    b.apply(state());
    session.beat += 1;
    analytics.sandbox({ type: "action", action: "play", id: session.id });
    return { done: session.beat >= BEATS.length, step: session.beat, total: BEATS.length, beat: { key: b.key, summary: b.summary } };
  });
  on("POST", "/api/v2/sandbox/reset", () => {
    if (!session) throw new HttpError(404, "The sandbox isn’t open.");
    session.beat = 0;
    apply();
    analytics.sandbox({ type: "action", action: "reset", id: session.id });
    return { ok: true, workspace_id: "p1", sandbox: view() };
  });
  on("POST", "/api/v2/sandbox/leave", () => {
    if (session) analytics.sandbox({ type: "leave", id: session.id, beat: session.beat, tour_step: session.tour_step });
    session = null;
    reset();
    setLoggedIn(false);
    return { ok: true };
  });
  /* Tour progress + interaction events — feeds Admin › Sandbox. */
  on("POST", "/api/v2/sandbox/events", ({ body }) => {
    if (!session) return { ok: true };
    if (body.type === "tour_step" && Number(body.step) > 0) session.tour_step = Math.max(session.tour_step, Number(body.step));
    analytics.sandbox({ ...body, id: session.id });
    return { ok: true };
  });

  return {
    active: () => !!session,
    /* → { action, detail } when this request isn't allowed in the sandbox */
    lockFor(method, pathname) {
      if (!session) return null;
      const hit = LOCKED.find(([m, rx]) => m === method && rx.test(pathname));
      if (!hit) return null;
      const action = hit[2];
      session.locked[action] = (session.locked[action] || 0) + 1;
      analytics.sandbox({ type: "locked", action, id: session.id });
      return { action, detail: LOCKED_COPY[action] };
    },
  };
}

module.exports = { register, BEATS, LOCKED };
