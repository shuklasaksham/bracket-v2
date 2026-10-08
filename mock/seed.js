/* Seed data for the mock API — the Figma story ("Fintech Landing Page Redesign"
   for Acme Finance, run by Maya Rao at Northlight Studio) plus a second business
   (the apparel manufacturer example, page 07) so the model is shown to generalise.
   Times are relative to "now" so the UI reads naturally on any day. */

const MIN = 60e3, HOUR = 60 * MIN, DAY = 24 * HOUR;
const now = () => Date.now();
const ago = (ms) => new Date(now() - ms).toISOString();
const mins = (m) => ago(m * MIN);
/* d(-3, "16:20") → 3 days ago at 16:20 local; d(3) → 3 days ahead at 09:00 */
function d(days, hhmm = "09:00") {
  const [h, m] = hhmm.split(":").map(Number);
  const x = new Date(now() + days * DAY);
  x.setHours(h, m, 0, 0);
  return x.toISOString();
}
/* Next weekday (0=Sun..6=Sat) at least `min` days out. */
function nextDow(dow, min = 1) {
  for (let i = min; i < min + 8; i++) {
    const x = new Date(now() + i * DAY);
    if (x.getDay() === dow) return d(i);
  }
  return d(min);
}

let _id = 1000;
const uid = (p) => `${p}${++_id}`;

function build() {
  const me = {
    user_id: "u1", email: "maya@northlight.studio", name: "Maya Rao", designation: "Design lead",
    company: "Northlight Studio", picture: null, plan: "monthly", plan_since: d(-20), has_password: true,
    is_admin: false, is_guest: false, timezone: "Asia/Kolkata", created_at: d(-60),
  };

  /* ───── People (workspace-level, also members of memory category "people") ───── */
  const people = [
    { id: "pe1", name: "Sarah Chen", role: "Client lead", org: "Acme Finance", email: "sarah.chen@acmefinance.com", messages: 12, summary: "12 messages · 3 commitments",
      role_in_work: "Day-to-day decision maker for the website", approves: "Design direction (confirmed) · scope changes (unconfirmed)", approves_confidence: "low", prefers: "Email for decisions, Slack for quick questions" },
    { id: "pe2", name: "James Park", role: "Head of Marketing", org: "Acme Finance", email: "james.park@acmefinance.com", messages: 6, summary: "6 messages · approved proposal",
      role_in_work: "Budget owner; approved the proposal", approves: "Budget and contract", approves_confidence: "high", prefers: "Email" },
    { id: "pe3", name: "Maya Rao", role: "Design lead", org: "Northlight (you)", email: "maya@northlight.studio", messages: 14, summary: "14 messages · 2 commitments", you: true,
      role_in_work: "Leads design and owns client communication", approves: "Design deliverables", approves_confidence: "high", prefers: "Slack" },
    { id: "pe4", name: "Dev Patel", role: "Webflow developer", org: "Northlight", email: "dev@northlight.studio", messages: 9, summary: "Slack · 9 messages",
      role_in_work: "Builds the site in Webflow", approves: "—", approves_confidence: "medium", prefers: "Slack" },
    { id: "pe5", name: "Lena Torres", role: "Copywriter", org: "Northlight", email: "lena@northlight.studio", messages: 3, summary: "Slack · 3 messages",
      role_in_work: "Writes homepage copy and testimonials", approves: "—", approves_confidence: "medium", prefers: "Slack" },
  ];

  /* ───── Sources ───── */
  const sources = [
    {
      id: "s_gmail", provider: "gmail", label: "Gmail", account: "maya@northlight.studio", connected_at: d(-5, "11:02"), connected_by: "Maya Rao",
      status: "synced", last_sync_at: mins(2), messages: 214, health: "ok",
      reads_summary: "3 selected threads · Sarah Chen, James Park",
      threads: [
        { id: "t1", subject: "Re: Homepage direction + next steps", from: "Sarah Chen", messages: 14, memories: 9 },
        { id: "t2", subject: "Kickoff recap — Acme Finance", from: "Sarah Chen", messages: 6, memories: 8 },
        { id: "t3", subject: "Proposal — Acme Finance website", from: "James Park", messages: 9, memories: 6 },
      ],
      auto_include: { enabled: true, domain: "acmefinance.com" },
      permissions: { read: true, send: true },
      learned: { total: 23, by: { scope: 4, decision: 5, commitment: 3, requirement: 4, person: 7 }, corroborated: 9 },
      activity: [
        { at: mins(18), text: "Read 1 new email from Sarah Chen → 5 proposed updates" },
        { at: d(-1, "10:12"), text: "Read 2 emails → decision changed (homepage direction)" },
        { at: d(-5, "11:02"), text: "Connected · first sync read 23 messages from Sep 10 onward" },
      ],
      candidates: [
        { id: "t4", subject: "Brand assets", from: "Sarah Chen", messages: 2, at: d(-8, "15:10") },
        { id: "t5", subject: "Invoice #0042", from: "Acme Finance AP", messages: 1, at: d(-3, "12:00") },
        { id: "t6", subject: "Webflow staging link", from: "Dev Patel", messages: 4, at: d(-2, "17:30") },
        { id: "t7", subject: "Testimonials — first draft", from: "Lena Torres", messages: 3, at: d(-1, "11:45") },
      ],
    },
    {
      id: "s_slack", provider: "slack", label: "Slack", account: "Northlight Studio", connected_at: d(-5, "11:10"), connected_by: "Maya Rao",
      status: "syncing", progress: { done: 1204, total: 3880 }, last_sync_at: mins(4), messages: 1204, health: "ok",
      reads_summary: "#acme-redesign",
      channels: [
        { id: "C1", name: "#acme-redesign", messages: 1204, memories: 12, members: 6 },
      ],
      candidates: [
        { id: "C2", name: "#acme-dev", messages: 382, members: 3 },
        { id: "C3", name: "#general", messages: 9100, members: 24 },
        { id: "C4", name: "#design-crit", messages: 640, members: 8 },
      ],
      permissions: { read: true, send: true },
      learned: { total: 12, by: { scope: 1, decision: 3, commitment: 2, requirement: 3, person: 3 }, corroborated: 4 },
      activity: [
        { at: mins(4), text: "Syncing history · 1,204 of 3,880 messages" },
        { at: d(-1, "10:20"), text: "Read 38 messages → 1 decision found" },
        { at: d(-5, "11:10"), text: "Connected #acme-redesign" },
      ],
    },
    {
      id: "s_notes", provider: "notes", label: "Notes", account: "Added in Bracket", connected_at: d(-4, "18:00"), connected_by: "Maya Rao",
      status: "synced", last_sync_at: mins(60), messages: 2, health: "ok",
      reads_summary: "Kickoff call, Performance & SEO review",
      notes: [
        { id: "n1", title: "Kickoff call notes", at: d(-4, "18:00"), by: "Maya Rao", memories: 6, attendees: "Maya Rao, Sarah Chen, James Park",
          body: "Attendees: Sarah (Acme), James (Acme), Maya\n\n· Goal: improve trust + conversions on the marketing site\n· Platforms: desktop + mobile\n· Timeline: 2 weeks from today → launch Fri Oct 17\n· Build in Webflow; perf + SEO are priorities\n· Mobile screens to Sarah by Fri Oct 10" },
        { id: "n2", title: "Performance & SEO review", at: d(-3, "15:20"), by: "Maya Rao", memories: 3, attendees: "3 attendees",
          body: "Lighthouse 90+ on mobile, schema for reviews, lazy-load hero imagery. Webflow CMS for testimonials." },
      ],
      permissions: { read: true, send: false },
      learned: { total: 9, by: { scope: 1, decision: 2, commitment: 2, requirement: 3, person: 1 }, corroborated: 3 },
      activity: [
        { at: d(-3, "15:20"), text: "Meeting note added — Performance & SEO review → 3 memories" },
        { at: d(-4, "18:00"), text: "Kickoff call notes added → 6 memories" },
      ],
    },
  ];
  const connectors = [
    { key: "figma", label: "Figma", desc: "Comments and file versions", status: "available" },
    { key: "github", label: "GitHub", desc: "Issues and pull requests", status: "available" },
    { key: "notion", label: "Notion", desc: "Docs and databases", status: "available" },
    { key: "jira", label: "Jira", desc: "Issues and sprints", status: "available" },
    { key: "meetings", label: "Meetings", desc: "Meeting recorder", status: "soon" },
  ];

  /* ───── Evidence helper ───── */
  const ev = (provider, author, where, at, quote, ref = {}) => ({ id: uid("e"), provider, author, where, at, quote, ...ref });

  /* ───── Memory (39 current items + pending proposals) ───── */
  const M = [];
  const add = (o) => { const it = { id: o.id || uid("m"), status: "current", confidence: "high", created_at: o.created_at || d(-4), changed_at: o.changed_at || o.created_at || d(-4), history: [], related: [], evidence: [], ...o }; M.push(it); return it; };

  // Scope (6)
  add({ id: "sc1", category: "scope", title: "Desktop and mobile layouts are included", detail: "Agreed at kickoff; covers the marketing homepage and four inner pages.",
    evidence: [ev("notes", "Maya Rao", "Kickoff call notes", d(-4, "18:00"), "Platforms: desktop + mobile", { source_id: "s_notes", ref_id: "n1" }), ev("gmail", "Sarah Chen", "Re: Kickoff recap", d(-4, "18:02"), "Desktop and mobile it is.", { source_id: "s_gmail", ref_id: "t2" })],
    history: [{ at: d(-4, "18:00"), text: "Discovered at kickoff" }], related: ["co1", "dl1"], pending_change: { review_id: "r1", text: "Tablet layouts requested — would add a breakpoint" } });
  add({ id: "sc2", category: "scope", title: "Marketing homepage plus four inner pages", detail: "About, Pricing, Security, Contact.", evidence: [ev("gmail", "James Park", "Proposal — Acme Finance website", d(-12, "10:00"), "Homepage + 4 inner pages as outlined.", { source_id: "s_gmail", ref_id: "t3" })] });
  add({ id: "sc3", category: "scope", title: "Copywriting included for the homepage", evidence: [ev("slack", "Lena Torres", "#acme-redesign", d(-3, "10:20"), "Copy will be ready Wednesday — testimonials included.", { source_id: "s_slack" })] });
  add({ id: "sc4", category: "scope", title: "Build in Webflow, including CMS setup", evidence: [ev("notes", "Maya Rao", "Kickoff call notes", d(-4, "18:00"), "Build in Webflow; perf + SEO are priorities", { source_id: "s_notes", ref_id: "n1" })] });
  add({ id: "sc5", category: "scope", title: "Blog redesign is out of scope", confidence: "medium", evidence: [ev("gmail", "James Park", "Proposal — Acme Finance website", d(-12, "10:00"), "We'll leave the blog as-is for now.", { source_id: "s_gmail", ref_id: "t3" })] });
  add({ id: "sc6", category: "scope", title: "Two rounds of revisions per page", evidence: [ev("gmail", "James Park", "Proposal — Acme Finance website", d(-12, "10:00"), "Two rounds of revisions per page.", { source_id: "s_gmail", ref_id: "t3" })] });

  // Decisions (9)
  add({ id: "de1", category: "decision", title: "Homepage direction is editorial", detail: "Story-led layout replaces the classic, image-led hero.", changed_at: d(-1, "17:40"),
    versions: [{ at: d(-6, "12:00"), title: "Homepage uses a classic, image-led hero", superseded_at: d(-1, "17:40") }],
    evidence: [ev("gmail", "Sarah Chen", "Re: Homepage direction + next steps", d(-1, "10:12"), "Let's go with the editorial direction — it feels much more like us.", { source_id: "s_gmail", ref_id: "t1" })],
    history: [{ at: d(-1, "17:40"), text: "Changed from classic to editorial — accepted by Maya" }, { at: d(-6, "12:00"), text: "Discovered: classic hero (moodboard review)" }] });
  add({ id: "de2", category: "decision", title: "Primary CTA is “Open an account”", evidence: [ev("slack", "Sarah Chen", "#acme-redesign", d(-3, "14:00"), "Primary CTA: Open an account.", { source_id: "s_slack" })] });
  add({ id: "de3", category: "decision", title: "Use Urbanist for headings", evidence: [ev("slack", "Maya Rao", "#acme-redesign", d(-3, "14:10"), "Going with Urbanist for headings.", { source_id: "s_slack" })] });
  add({ id: "de4", category: "decision", title: "Testimonials managed in Webflow CMS", changed_at: d(-3, "15:20"), evidence: [ev("notes", "Maya Rao", "Performance & SEO review", d(-3, "15:20"), "Webflow CMS for testimonials.", { source_id: "s_notes", ref_id: "n2" })] });
  add({ id: "de5", category: "decision", title: "Hero imagery is lazy-loaded", changed_at: d(-3, "15:20"), evidence: [ev("notes", "Maya Rao", "Performance & SEO review", d(-3, "15:20"), "lazy-load hero imagery", { source_id: "s_notes", ref_id: "n2" })] });
  add({ id: "de6", category: "decision", title: "Sarah approves design direction", evidence: [ev("gmail", "James Park", "Re: Kickoff recap", d(-4, "18:30"), "Sarah has final say on design.", { source_id: "s_gmail", ref_id: "t2" })] });
  add({ id: "de7", category: "decision", title: "Weekly check-in on Mondays", evidence: [ev("notes", "Maya Rao", "Kickoff call notes", d(-4, "18:00"), "Weekly check-in Mondays 10:00", { source_id: "s_notes", ref_id: "n1" })] });
  add({ id: "de8", category: "decision", title: "Dark mode is not required", confidence: "medium", evidence: [ev("slack", "Sarah Chen", "#acme-redesign", d(-2, "11:00"), "No need for dark mode for launch.", { source_id: "s_slack" })] });
  add({ id: "de9", category: "decision", title: "Stock photography over illustration", evidence: [ev("gmail", "Sarah Chen", "Re: Homepage direction + next steps", d(-1, "10:12"), "Photography over illustration, please.", { source_id: "s_gmail", ref_id: "t1" })] });

  // Deliverables (4)
  add({ id: "dl1", category: "deliverable", title: "Mobile screens for the homepage", detail: "Due to Sarah on Fri Oct 10.", related: ["co1", "sc1"], evidence: [ev("gmail", "Sarah Chen", "Proposal — Acme Finance website", d(-12, "10:00"), "Mobile screens for review before build.", { source_id: "s_gmail", ref_id: "t3" })], pending_change: { review_id: "r1", text: "Tablet layouts would add a deliverable" } });
  add({ id: "dl2", category: "deliverable", title: "Desktop homepage design", evidence: [ev("notes", "Maya Rao", "Kickoff call notes", d(-4, "18:00"), "Desktop homepage first.", { source_id: "s_notes", ref_id: "n1" })] });
  add({ id: "dl3", category: "deliverable", title: "Webflow build with CMS", evidence: [ev("slack", "Dev Patel", "#acme-redesign", d(-1, "10:12"), "Webflow build for the homepage starts Monday.", { source_id: "s_slack" })] });
  add({ id: "dl4", category: "deliverable", title: "Homepage copy and testimonials", evidence: [ev("slack", "Lena Torres", "#acme-redesign", d(-1, "10:20"), "Copy will be ready Wednesday — testimonials included.", { source_id: "s_slack" })] });

  // Requirements (7)
  add({ id: "rq1", category: "requirement", title: "Testimonials on the homepage", changed_at: d(-1, "11:03"), created_at: d(-1, "11:03"), evidence: [ev("slack", "Sarah Chen", "#acme-redesign", d(-1, "11:03"), "Can we add testimonials to the homepage?", { source_id: "s_slack" })], history: [{ at: d(-1, "11:03"), text: "Added to Requirements automatically · high confidence" }] });
  add({ id: "rq2", category: "requirement", title: "Lighthouse 90+ on mobile", evidence: [ev("notes", "Maya Rao", "Performance & SEO review", d(-3, "15:20"), "Lighthouse 90+ on mobile", { source_id: "s_notes", ref_id: "n2" })] });
  add({ id: "rq3", category: "requirement", title: "Review schema for testimonials", evidence: [ev("notes", "Maya Rao", "Performance & SEO review", d(-3, "15:20"), "schema for reviews", { source_id: "s_notes", ref_id: "n2" })] });
  add({ id: "rq4", category: "requirement", title: "WCAG 2.2 AA contrast on all text", evidence: [ev("gmail", "James Park", "Proposal — Acme Finance website", d(-12, "10:00"), "Accessibility to WCAG AA.", { source_id: "s_gmail", ref_id: "t3" })] });
  add({ id: "rq5", category: "requirement", title: "Use Acme brand guide v3", evidence: [ev("gmail", "Sarah Chen", "Brand assets", d(-8, "15:10"), "Please follow brand guide v3.", { source_id: "s_gmail", ref_id: "t4" })] });
  add({ id: "rq6", category: "requirement", title: "Pricing page shows INR and USD", confidence: "medium", evidence: [ev("slack", "Sarah Chen", "#acme-redesign", d(-2, "16:00"), "Pricing should show both INR and USD.", { source_id: "s_slack" })] });
  add({ id: "rq7", category: "requirement", title: "Cookie banner with decline option", evidence: [ev("gmail", "James Park", "Proposal — Acme Finance website", d(-12, "10:00"), "Compliant cookie banner.", { source_id: "s_gmail", ref_id: "t3" })] });

  // Commitments (5) — owner / owed_to / due / state
  add({ id: "co1", category: "commitment", title: "Maya will deliver mobile screens to Acme Finance by Friday, Oct 10.", short: "Mobile screens to Sarah", owner: "Maya Rao", owed_to: "Sarah Chen", direction: "You → Acme Finance", due: d(3), state: "open", changed_at: d(-4, "18:02"),
    evidence: [ev("slack", "Maya Rao", "#acme-redesign", d(-4, "16:20"), "We'll have the mobile screens over to you by Friday.", { source_id: "s_slack" }), ev("gmail", "Sarah Chen", "Re: Kickoff recap", d(-4, "18:02"), "Friday works for mobile — thanks Maya.", { source_id: "s_gmail", ref_id: "t2" })],
    history: [{ at: d(-4, "18:02"), text: "Due date set to Friday, Oct 10 — confirmed by Sarah" }, { at: d(-6, "12:00"), text: "Discovered: mobile screens are a deliverable (proposal email)" }],
    related: ["dl1", "sc1"], pending_change: { review_id: "r1", text: "Tablet layouts requested — may affect this date" } });
  add({ id: "co2", category: "commitment", title: "Acme Finance will provide brand assets (logos and fonts).", short: "Brand assets from Acme", owner: "Sarah Chen", owed_to: "Maya Rao", direction: "Acme Finance → You", promised_at: d(-8, "15:10"), state: "open", waiting_days: 8,
    evidence: [ev("gmail", "Sarah Chen", "Brand assets", d(-8, "15:10"), "I'll send logos and fonts early next week.", { source_id: "s_gmail", ref_id: "t4" })] });
  add({ id: "co3", category: "commitment", title: "Launch two weeks after kickoff — Oct 17.", short: "Launch", owner: "Maya Rao", owed_to: "Acme Finance", direction: "Agreed at kickoff", due: d(10), state: "open", at_risk: true,
    evidence: [ev("notes", "Maya Rao", "Kickoff call notes", d(-4, "18:00"), "Timeline: 2 weeks from today → launch Fri Oct 17", { source_id: "s_notes", ref_id: "n1" }), ev("gmail", "Sarah Chen", "Re: Kickoff recap", d(-4, "18:02"), "Launch on the 17th works.", { source_id: "s_gmail", ref_id: "t2" })],
    pending_change: { review_id: "r1", text: "Two-week timeline may not fit the expanded scope" } });
  add({ id: "co4", category: "commitment", title: "Review the editorial homepage with Sarah before development starts.", short: "Editorial homepage review with Sarah", owner: "Maya Rao", owed_to: "Sarah Chen", direction: "You → Acme Finance", state: "open",
    evidence: [ev("gmail", "Sarah Chen", "Re: Homepage direction + next steps", d(-2, "09:00"), "Let's walk through it before Dev starts.", { source_id: "s_gmail", ref_id: "t1" })] });
  add({ id: "co5", category: "commitment", title: "Share the editorial homepage direction with Acme Finance.", owner: "Maya Rao", owed_to: "Sarah Chen", state: "completed", completed_at: d(-1, "17:12"),
    evidence: [ev("gmail", "Maya Rao", "Re: Homepage direction + next steps", d(-1, "17:12"), "Sharing the editorial homepage direction we discussed.", { source_id: "s_gmail", ref_id: "t1" })] });

  // People (8) — memory items that describe people
  people.forEach((p) => add({ id: `pm_${p.id}`, category: "person", title: `${p.name} — ${p.role.toLowerCase()}`, person_id: p.id,
    evidence: [ev("gmail", p.name, "Re: Kickoff recap", d(-4, "18:02"), `${p.name}, ${p.role}`, { source_id: "s_gmail", ref_id: "t2" })] }));
  add({ id: "pm6", category: "person", title: "Priya Nair — Acme compliance reviewer", confidence: "medium", evidence: [ev("gmail", "James Park", "Proposal — Acme Finance website", d(-12, "10:00"), "Priya from compliance will review copy.", { source_id: "s_gmail", ref_id: "t3" })] });
  add({ id: "pm7", category: "person", title: "Acme Finance AP — invoices", evidence: [ev("gmail", "Acme Finance AP", "Invoice #0042", d(-3, "12:00"), "Please send invoices to ap@acmefinance.com", { source_id: "s_gmail" })] });
  add({ id: "pm8", category: "person", title: "Tom Wu — Acme brand designer", confidence: "low", evidence: [ev("gmail", "Sarah Chen", "Brand assets", d(-8, "15:10"), "Tom from our brand team will send files.", { source_id: "s_gmail", ref_id: "t4" })] });

  /* ───── Categories ───── */
  const categories = [
    { key: "scope", label: "Scope", singular: "Scope", description: "What is and isn't part of this work." },
    { key: "decision", label: "Decisions", singular: "Decision", description: "Choices that were agreed, and who agreed them." },
    { key: "deliverable", label: "Deliverables", singular: "Deliverable", description: "What you'll hand over." },
    { key: "requirement", label: "Requirements", singular: "Requirement", description: "Conditions the work has to meet." },
    { key: "commitment", label: "Commitments", singular: "Commitment", description: "Promises made by you or the client, with who owes what and by when." },
    { key: "person", label: "People", singular: "Person", description: "Everyone involved in this work, what they've said and what they're owed." },
  ];

  /* ───── Review queue ───── */
  const reviews = [
    {
      id: "r1", kind: "scope_change", status: "pending", label: "Potential scope change",
      title: "Sarah asked to add tablet layouts while keeping the two-week timeline",
      detected: { count: 1, unit: "email", at: mins(18) },
      interpretation: "Sarah is asking to expand scope to tablet without moving the deadline. That adds a deliverable and a requirement, and puts the Oct 17 launch at risk. Nothing changes until you accept.",
      trigger: {
        provider: "gmail", source_id: "s_gmail", thread_id: "t1", from: "Sarah Chen", to: "Maya Rao", at: mins(18),
        subject: "Re: Homepage direction + next steps",
        body: [
          { text: "Hi Maya,\n\nThanks for the editorial direction — the team loves it and we’re aligned on moving forward." },
          { text: "Can we include tablet layouts as well?", tags: ["Scope", "Deliverables", "Requirements"] },
          { text: "Ideally we’d still like to keep the two-week timeline.", tags: ["Commitments"] },
          { text: "I’ll send the brand assets over shortly.\n\nBest,\nSarah" },
        ],
      },
      compared: [
        { memory_id: "sc1", text: "Desktop and mobile layouts are included in the redesign.", chip: { provider: "gmail", label: "Agreed Sep 12" } },
        { memory_id: "co3", text: "Launch two weeks after kickoff — Oct 17.", chip: { provider: "notes", label: "Kickoff call · Oct 3" } },
        { memory_id: "dl1", text: "Mobile screens for the homepage.", chip: { provider: "gmail", label: "Proposal · Sep 12" } },
      ],
      proposals: [
        { id: "p1", category: "scope", op: "modify", target: "sc1", before: "Desktop and mobile layouts are included.", after: "Desktop, tablet and mobile layouts are included.", confidence: "high", rationale: "Sarah explicitly asks to “include tablet layouts as well.”" },
        { id: "p2", category: "deliverable", op: "add", after: "Tablet layouts for the homepage.", confidence: "high", rationale: "New layout set implied by the scope request." },
        { id: "p3", category: "requirement", op: "add", after: "Homepage must be responsive at tablet widths (768–1024px).", confidence: "medium", rationale: "Inferred from the tablet request; exact breakpoints weren’t specified." },
        { id: "p4", category: "commitment", op: "conflict", target: "co3", before: "Launch two weeks after kickoff — Oct 17.", after: "Oct 17 launch is at risk — no new date agreed for the expanded scope.", confidence: "medium", rationale: "Sarah wants to “keep the two-week timeline”; the original estimate covered desktop and mobile only." },
        { id: "p5", category: "person", op: "modify", target: "pm_pe1", before: "Sarah Chen — client lead.", after: "Sarah Chen — client lead and approver for scope changes.", confidence: "low", rationale: "Low confidence: she’s requesting the change, but approval authority isn’t stated anywhere." },
      ],
      reply_to: "Sarah",
    },
    {
      id: "r2", kind: "decision", status: "pending", saved: true, label: "New requirement",
      title: "Lena wants testimonials managed by Acme in the CMS",
      detected: { count: 1, unit: "Slack message", at: mins(60 * 3) },
      interpretation: "Lena suggests Acme edit testimonials themselves in Webflow. That adds a CMS requirement and a training deliverable.",
      trigger: {
        provider: "slack", source_id: "s_slack", thread_id: "C1", from: "Lena Torres", to: "#acme-redesign", at: mins(60 * 3), subject: "#acme-redesign",
        body: [
          { text: "Quick one —" },
          { text: "Acme should be able to edit testimonials themselves in Webflow.", tags: ["Requirements"] },
          { text: "Maybe a 30-min handover session?", tags: ["Deliverables"] },
        ],
      },
      compared: [{ memory_id: "de4", text: "Testimonials managed in Webflow CMS", chip: { provider: "notes", label: "Perf & SEO review" } }],
      proposals: [
        { id: "p1", category: "requirement", op: "add", after: "Acme can edit testimonials in the Webflow CMS.", confidence: "high", rationale: "Stated directly by Lena." },
        { id: "p2", category: "deliverable", op: "add", after: "30-minute CMS handover session.", confidence: "medium", rationale: "Suggested, not yet agreed with Acme." },
      ],
      reply_to: "Lena",
    },
  ];

  /* ───── Attention ───── */
  const attention = [
    { id: "a1", kind: "scope_change", tone: "warning", eyebrow: "Potential scope change · affects 5 memories", title: "Sarah asked to add tablet layouts while keeping the two-week timeline",
      detail: "Tablet isn’t in the current agreement. It touches scope, deliverables and the launch date.", chip: { provider: "gmail", label: "Sarah Chen", at: mins(18) },
      action: { label: "Review 5 changes", kind: "review", target: "r1", primary: true } },
    { id: "a2", kind: "conflict", tone: "danger", eyebrow: "Conflicting information", title: "The two-week timeline may not fit the expanded scope",
      detail: "Kickoff agreed two weeks for desktop and mobile. No new date has been agreed since tablet was requested.", chip: { provider: "slack", label: "#acme-redesign", at: d(-4, "16:20") },
      action: { label: "Resolve", kind: "resolve", target: "cf1" } },
    { id: "a3", kind: "waiting", tone: "neutral", eyebrow: "Waiting on Acme Finance · 8 days", title: "Brand assets haven’t been received",
      detail: "Sarah said she’d send logos and fonts “early next week” on Sep 29.", chip: { provider: "gmail", label: "Sarah Chen", at: d(-8, "15:10") },
      action: { label: "Draft follow-up", kind: "follow_up", target: "t4" } },
    { id: "a4", kind: "waiting", tone: "neutral", eyebrow: "Waiting on Dev Patel · 2 days", title: "Staging link for the homepage build",
      detail: "Dev said he'd share a staging link once the CMS is wired.", chip: { provider: "slack", label: "#acme-redesign", at: d(-2, "17:30") },
      action: { label: "Draft follow-up", kind: "follow_up", target: "C1" }, snoozed_until: d(2) },
    { id: "a5", kind: "reply", tone: "neutral", eyebrow: "Needs a reply", title: "Invoice #0042 question from Acme AP",
      detail: "AP asked for a PO number before paying.", chip: { provider: "gmail", label: "Acme Finance AP", at: d(-3, "12:00") },
      action: { label: "Draft reply", kind: "reply", target: "t5" }, saved: true },
  ];

  const conflicts = [
    { id: "cf1", title: "The two-week timeline may not fit the expanded scope",
      sides: [
        { provider: "notes", label: "Kickoff call notes", quote: "“Timeline: 2 weeks from today → launch Fri Oct 17” — scope was desktop + mobile.", meta: "Oct 3 · agreed by Sarah Chen and Maya Rao" },
        { provider: "gmail", label: "Sarah Chen", quote: "“Can we include tablet layouts as well? Ideally we’d still like to keep the two-week timeline.”", meta: "Today 09:41 · not yet answered" },
      ],
      note: "Bracket can’t decide which is true — this needs a decision from you or Sarah. Nothing changes until you choose.",
      options: [
        { id: "split", title: "Split the launch", detail: "Keep Oct 17 for desktop and mobile; tablet ships later.", date_label: "Tablet delivery date", date: d(17), effect: "Updates Commitments (Launch) and Deliverables (Tablet). Previous values stay in history.", cta: "Update memory & draft reply" },
        { id: "move", title: "Move the whole launch", detail: "All three breakpoints ship together on a new date.", date_label: "New launch date", date: d(15), effect: "Updates Commitments (Launch). Previous values stay in history.", cta: "Update memory & draft reply" },
        { id: "drop", title: "Keep two weeks, drop tablet", detail: "Scope stays desktop + mobile. Tablet request is declined.", effect: "Dismisses the tablet proposal. Nothing else changes.", cta: "Update memory & draft reply" },
        { id: "ask", title: "Not decided yet — ask Sarah", detail: "Bracket drafts a reply with both options; the conflict stays open.", effect: "Nothing in memory changes. The conflict stays in Needs your attention.", cta: "Draft reply" },
      ] },
  ];

  /* ───── Conversations ───── */
  const threads = [
    { id: "t1", provider: "gmail", kind: "email", title: "Re: Homepage direction + next steps", who: "Sarah Chen", participants: "Sarah Chen, Maya Rao", to_email: "sarah.chen@acmefinance.com", count: 4, started_at: d(-1, "17:12"), at: mins(18),
      preview: "Can we include tablet layouts as well? Ideally we'd still like to keep...", badge: { tone: "warning", label: "5 changes to review" }, needs_reply: true, earlier: { count: 2, at: d(-1) },
      messages: [
        { id: "mm1", author: "Maya Rao", at: d(-1, "17:12"), body: [{ text: "Hi Sarah — sharing the editorial homepage direction we discussed. Let us know what the team thinks." }] },
        { id: "mm2", author: "Sarah Chen", at: mins(18), body: [
          { text: "Hi Maya, thanks for the editorial direction — the team loves it and we’re aligned on moving forward." },
          { text: "Can we include tablet layouts as well?", tag: "Scope change", tone: "warning" },
          { text: "Ideally we’d still like to keep the two-week timeline.", tag: "Commitment", tone: "warning" },
          { text: "I’ll send the brand assets over shortly." },
        ] },
      ],
      would_change: [{ category: "Scope", text: "Desktop, tablet and mobile" }, { category: "Commitments", text: "Oct 17 launch at risk" }, { more: 3, text: "Deliverables, Requirements, People" }],
      created: [{ category: "Decisions", text: "Homepage direction is editorial", id: "de1" }, { category: "Commitments", text: "Acme Finance will send brand assets", id: "co2" }],
      referenced: [{ category: "Scope", text: "Desktop and mobile are included", id: "sc1" }, { category: "People", text: "Sarah Chen — client lead", id: "pm_pe1" }],
      review_id: "r1", can_send: true },
    { id: "C1", provider: "slack", kind: "slack", title: "Dev handoff — Webflow CMS structure", who: "#acme-redesign", channel: "#acme-redesign", participants: "Dev Patel, Sarah Chen, Maya Rao", count: 6, started_at: d(-1, "14:02"), at: d(-1, "14:31"),
      preview: "Dev: confirmed we're building in Webflow, CMS for testimonials...", subtitle: "Dev handoff — Webflow CMS structure", badge: { tone: "info", label: "1 decision found" }, needs_reply: false, earlier: null,
      messages: [
        { id: "sm1", author: "Dev Patel", at: d(-1, "14:02"), body: [{ text: "Proposal for the CMS: one collection for testimonials, one for case studies. Homepage pulls the 3 latest testimonials." }, { text: "We’re building in Webflow, not Framer — confirmed with James.", tag: "Decision", tone: "info" }] },
        { id: "sm2", author: "Sarah Chen", at: d(-1, "14:20"), body: [{ text: "Works for us. Can testimonials include a company logo?" }] },
        { id: "sm3", author: "Maya Rao", at: d(-1, "14:31"), body: [{ text: "Yes — adding a logo field." }] },
      ],
      would_change: [], created: [{ category: "Decisions", text: "Build in Webflow (not Framer)", id: "de4" }, { category: "Requirements", text: "Testimonials include company logo", id: "rq1" }], referenced: [{ category: "Requirements", text: "Add testimonials to the homepage", id: "rq1" }],
      draft_hint: "in thread", can_send: true },
    { id: "t4", provider: "gmail", kind: "email", title: "Brand assets", who: "Sarah Chen", participants: "Sarah Chen, Maya Rao", to_email: "sarah.chen@acmefinance.com", count: 3, started_at: d(-12, "11:00"), at: d(-8, "16:40"),
      preview: "I'll pull the logo files and fonts together early next week.", badge: { tone: "neutral", label: "Awaiting assets" }, needs_reply: true, earlier: { count: 2, at: d(-1) },
      messages: [
        { id: "bm2", author: "Sarah Chen", at: d(-8, "16:40"), body: [{ text: "I’ll pull the logo files and fonts together and send them early next week." }] },
      ],
      would_change: [], created: [{ category: "Commitments", text: "Acme Finance will send brand assets", id: "co2" }], referenced: [{ category: "Scope", text: "Desktop and mobile are included", id: "sc1" }, { category: "People", text: "Sarah Chen — client lead", id: "pm_pe1" }], can_send: true },
    { id: "n2", provider: "notes", kind: "note", title: "Performance & SEO review", who: "Performance & SEO review", participants: "Maya Rao, James Park, Dev Patel", count: 1, started_at: d(-3, "15:20"), at: d(-3, "15:20"),
      preview: "Lighthouse 90+ on mobile, schema for reviews, lazy-load hero...", subtitle: "Meeting note · 3 attendees", needs_reply: false, earlier: null,
      note: [
        { text: "Attendees: Maya, James (Acme), Dev" },
        { text: "· Goal: Lighthouse 90+ on mobile" },
        { text: "· Build in Webflow; use CMS for testimonials", tag: "Decision", tone: "info" },
        { text: "· Performance and SEO are priorities for launch", tag: "Requirement", tone: "info" },
        { text: "· Schema markup for reviews on homepage", tag: "Requirement", tone: "info" },
        { text: "· Lazy-load hero video; compress images to WebP" },
      ],
      messages: [],
      would_change: [], created: [{ category: "Decisions", text: "Build in Webflow with CMS", id: "de4" }, { category: "Requirements", text: "Performance and SEO are priorities", id: "rq2" }, { category: "Requirements", text: "Review schema on homepage", id: "rq3" }], referenced: [], can_send: false },
    { id: "C1b", provider: "slack", kind: "slack", title: "Kickoff follow-ups", who: "#acme-redesign", channel: "#acme-redesign", participants: "Maya Rao, Sarah Chen", count: 6, started_at: d(-4, "16:00"), at: d(-4, "16:20"),
      preview: "We'll have the mobile screens over to you by Friday.", subtitle: "Kickoff follow-ups", needs_reply: false, earlier: null,
      messages: [{ id: "km0", author: "Sarah Chen", at: d(-4, "16:12"), body: [{ text: "Can we see mobile before the review on Monday?" }] }, { id: "km1", author: "Maya Rao", at: d(-4, "16:20"), body: [{ text: "We’ll have the mobile screens over to you by Friday.", tag: "Commitment", tone: "warning" }] }],
      would_change: [], created: [{ category: "Commitments", text: "Mobile screens to Sarah by Fri", id: "co1" }], referenced: [], can_send: true },
    { id: "t3", provider: "gmail", kind: "email", title: "Proposal — Acme Finance website", who: "James Park", participants: "James Park, Maya Rao", to_email: "james.park@acmefinance.com", count: 9, started_at: d(-12, "10:00"), at: d(-12, "10:00"),
      preview: "Attached is the proposal covering desktop and mobile...", needs_reply: false, earlier: { count: 7, at: d(-14) },
      messages: [{ id: "pm1", author: "James Park", at: d(-12, "10:00"), body: [{ text: "Attached is the proposal covering desktop and mobile.", tag: "Scope", tone: "warning" }, { text: "Homepage + 4 inner pages as outlined. Two rounds of revisions per page." }] }],
      would_change: [], created: [{ category: "Scope", text: "Marketing homepage plus four inner pages", id: "sc2" }, { category: "Scope", text: "Two rounds of revisions per page", id: "sc6" }], referenced: [], can_send: true },
    { id: "t8", provider: "gmail", kind: "email", title: "Webflow seat for Acme", who: "James Park", participants: "James Park, Maya Rao", to_email: "james.park@acmefinance.com", count: 2, started_at: d(-6, "11:05"), at: d(-6, "11:40"),
      preview: "Hi Maya — I've added you as an editor on our Webflow workspace.", needs_reply: false, earlier: null, nothing_detected: true,
      messages: [{ id: "wm1", author: "James Park", at: d(-6, "11:05"), body: [{ text: "Hi Maya — I’ve added you as an editor on our Webflow workspace." }] }, { id: "wm2", author: "Maya Rao", at: d(-6, "11:40"), body: [{ text: "Got it, thanks James!" }] }],
      would_change: [], created: [], referenced: [], can_send: true },
    { id: "t5", provider: "gmail", kind: "email", title: "Invoice #0042", who: "Acme Finance AP", participants: "Acme Finance AP, Maya Rao", to_email: "ap@acmefinance.com", count: 1, started_at: d(-3, "12:00"), at: d(-3, "12:00"),
      preview: "Could you add our PO number before we process payment?", needs_reply: false, earlier: null, nothing_detected: true,
      messages: [{ id: "im1", author: "Acme Finance AP", at: d(-3, "12:00"), body: [{ text: "Hi — could you add our PO number (PO-7781) to the invoice before we process payment? Thanks." }] }],
      would_change: [], created: [], referenced: [], can_send: true },
  ];
  const conversationTotal = 14;

  /* ───── Timeline ───── */
  const events = [
    { id: "ev1", at: mins(17), kind: "change_detected", title: "Change detected — tablet layouts requested", actor: { provider: "gmail", label: "Sarah Chen" }, meta: "5 proposed updates · waiting for your review", dot: "warning", review_id: "r1" },
    { id: "ev2", short: "Sarah Chen emailed about tablet layouts", icon: "mail", at: mins(18), kind: "email_received", title: "Email received — Re: Homepage direction + next steps", actor: { provider: "gmail", label: "Sarah Chen" }, meta: "Read by Bracket · 2 requests found", source: "gmail", thread_id: "t1" },
    { id: "ev3", at: mins(60 + 44), kind: "sync", title: "Slack synced", actor: { provider: "slack", label: "#acme-redesign" }, meta: "38 messages read · 1 decision found", source: "slack", system: true },
    { id: "ev4", short: "Homepage direction changed to editorial", icon: "changed", at: d(-1, "17:40"), kind: "decision_changed", title: "Decision changed — homepage direction is now editorial", actor: { provider: "gmail", label: "Sarah Chen" }, meta: "Accepted by Maya Rao · 2 memories updated", dot: "success", memory: true,
      detail: { heading: "Homepage direction is now editorial", eyebrow: "Decision changed", when: d(-1, "17:40"), accepted_by: "Maya Rao", triggered_by: "Email from Sarah Chen, 10:12",
        changes: [{ category: "Decisions", before: "Homepage uses a classic, image-led hero.", after: "Homepage uses an editorial, story-led direction." }, { category: "Deliverables", before: "Homepage design — classic direction.", after: "Homepage design — editorial direction." }],
        source: { provider: "gmail", label: "Sarah Chen · " + "Oct 6, 10:12", quote: "Let’s go with the editorial direction — it feels much more like us." }, restorable: true } },
    { id: "ev5", at: d(-1, "17:12"), kind: "email_sent", title: "Email sent — editorial homepage direction shared", actor: { provider: "gmail", label: "Maya Rao" }, meta: "Commitment completed", source: "gmail", memory: true },
    { id: "ev6", short: "New requirement: testimonials on homepage", icon: "added", at: d(-1, "11:03"), kind: "requirement_discovered", title: "Requirement discovered — add testimonials to the homepage", actor: { provider: "slack", label: "Sarah Chen" }, meta: "Added to Requirements automatically · high confidence", memory: true, memory_id: "rq1" },
    { id: "ev7", at: d(-3, "15:20"), kind: "note_added", title: "Meeting note added — Performance & SEO review", actor: { provider: "notes", label: "Maya Rao" }, meta: "3 memories created: Webflow, performance, SEO", source: "notes", memory: true },
    { id: "ev8", at: d(-4, "18:02"), kind: "commitment_confirmed", title: "Commitment confirmed — mobile screens by Friday", actor: { provider: "gmail", label: "Sarah Chen" }, meta: "Due date set to Oct 10", memory: true, memory_id: "co1" },
    { id: "ev9", at: d(-4, "16:20"), kind: "commitment_discovered", title: "Commitment discovered — mobile screens by Friday", actor: { provider: "slack", label: "Maya Rao" }, meta: "Owner: Maya Rao", memory: true, memory_id: "co1" },
    { id: "ev10", at: d(-5, "11:10"), kind: "source_connected", title: "Slack connected — #acme-redesign", actor: { provider: "slack", label: "Maya Rao" }, meta: "Reading history", system: true, source: "slack" },
    { id: "ev11", at: d(-5, "11:02"), kind: "source_connected", title: "Gmail connected — 3 threads", actor: { provider: "gmail", label: "Maya Rao" }, meta: "First sync read 23 messages", system: true, source: "gmail" },
    { id: "ev12", at: d(-6, "12:00"), kind: "dismissed", title: "Change dismissed — “Add a blog”", actor: { provider: "gmail", label: "James Park" }, meta: "Dismissed by Maya · reason: not requested", memory: true },
  ];

  /* ───── Files ───── */
  const files = [
    { id: "f1", name: "Acme_Finance_Proposal_v2.pdf", type: "pdf", size: 2.4e6, pages: 12, added_at: d(-5, "11:30"), added_by: "Maya", status: "in_memory", contributed: { memories: 6, categories: ["Scope", "Deliverables"] } },
    { id: "f2", name: "Kickoff_notes.docx", type: "docx", size: 48e3, pages: 3, added_at: d(-4, "18:10"), added_by: "Maya", status: "in_memory", contributed: { memories: 4, categories: ["Commitments"] } },
    { id: "f3", name: "Brand_Guidelines_2024.pdf", type: "pdf", size: 18.2e6, pages: 34, added_at: d(-5, "12:00"), added_by: "James", status: "reading", progress: { done: 12, total: 34 } },
    { id: "f4", name: "Moodboard_editorial.png", type: "png", size: 3.1e6, added_at: d(-2, "14:00"), added_by: "Maya", status: "in_memory", contributed: { memories: 1, categories: ["Decisions"], note: "Referenced by 1 decision" } },
    { id: "f5", name: "Kickoff_recording.mov", type: "mov", size: 420e6, added_at: d(-4, "18:20"), added_by: "Maya", status: "not_supported", reason: "Video isn't supported — add a transcript" },
    { id: "f6", name: "SOW_signed.pdf", type: "pdf", size: 640e3, pages: 4, added_at: d(-5, "11:31"), added_by: "Maya", status: "in_memory", contributed: { memories: 2, categories: ["Scope"] } },
  ];

  /* ───── Members ───── */
  const members = [
    { id: "u1", name: "Maya Rao", email: "maya@northlight.studio", role: "owner", status: "active" },
    { id: "u2", name: "James Park", email: "james@northlight.studio", role: "editor", status: "active", note: "Can accept changes" },
    { id: "u3", name: "Lena Torres", email: "lena@northlight.studio", role: "viewer", status: "active", note: "Read-only" },
    { id: "u4", name: null, email: "sam@northlight.studio", role: "editor", status: "pending", invited_at: d(-1, "12:00") },
  ];

  /* ───── Ask history ───── */
  const askHistory = [
    { id: "q1", question: "Did we ever agree to a two-week deadline?", at: mins(30) },
    { id: "q2", question: "What is currently included in scope?", at: d(-1, "15:00") },
    { id: "q3", question: "Why did we change the homepage direction?", at: d(-1, "18:00") },
    { id: "q4", question: "What commitments are due this week?", at: d(-2, "09:30") },
  ];

  /* ───── Updates feed (bell) ───── */
  const updates = [
    { id: "u_1", group: "attention", icon: "warning", title: "Scope change detected from Sarah Chen", sub: "Fintech Landing Page", at: mins(17), read: false, link: { kind: "review", id: "r1", workspace: "p1" } },
    { id: "u_2", group: "attention", icon: "calendar", title: "Mobile screens due in 3 days", sub: "Fintech Landing Page · Commitment", at: null, read: true, link: { kind: "memory", id: "co1", workspace: "p1" } },
    { id: "u_3", group: "memory", icon: "changed", title: "Homepage direction changed to editorial", sub: "Accepted by you", at: d(-1, "17:40"), read: true, link: { kind: "event", id: "ev4", workspace: "p1" } },
    { id: "u_4", group: "system", icon: "synced", title: "Slack finished syncing · 3,880 messages", sub: "", at: mins(60 * 2), read: false, link: { kind: "source", id: "s_slack", workspace: "p1" } },
  ];

  const workspaces = [
    { id: "p1", name: "Fintech Landing Page Redesign", client_name: "Acme Finance", business: "Acme Finance", initials: "AF", role: "owner", status: "active",
      summary: "Acme Finance is redesigning its website to improve trust and conversions. Desktop and mobile are agreed; tablet scope and the launch date are still open.",
      created_at: d(-6), memory_updated_at: mins(2), last_seen_prev: mins(60 * 20) },
    { id: "p2", name: "Spring ’26 polo order", client_name: "Ravi Textiles", business: "Ravi Textiles", initials: "RT", attention: 2, role: "owner", status: "active",
      summary: "Bulk polo order for Ravi Textiles' spring line. Quantities and the delivery split are agreed; payment terms are still open.",
      created_at: d(-30), memory_updated_at: mins(60 * 26), last_seen_prev: d(-2) },
    { id: "p3", name: "Atlas mobile app", client_name: "Northwind Labs", business: "Northwind Labs", initials: "NL", attention: 1, role: "editor", status: "active", summary: "", created_at: d(-40), memory_updated_at: d(-3), last_seen_prev: d(-3) },
    { id: "p5", name: "Freelance clients", client_name: "", business: "Personal", initials: "FC", role: "owner", status: "active", sources_label: "Gmail · Notes", summary: "", created_at: d(-200), memory_updated_at: d(-1) },
    { id: "p4", name: "Brand refresh 2025", client_name: "Acme Finance", business: "Acme Finance", initials: "AF", role: "owner", status: "archived", archived_at: d(-14), summary: "", created_at: d(-120), memory_updated_at: d(-20) },
  ];

  const billing = {
    plan: "monthly", status: "active", currency: "inr", amount: 999, interval: "month", label: "Monthly",
    since: d(-20), renews_on: d(10), trial_ends_at: null, card: { brand: "Visa", last4: "4242", exp: "08/28" },
    workspaces: { used: 3, limit: 10 },
    invoices: [
      { id: "in_3", at: d(-20), amount: 999, currency: "inr", status: "paid", label: "Monthly · Sep" },
      { id: "in_2", at: d(-50), amount: 199, currency: "inr", status: "paid", label: "Per project · Atlas mobile app" },
    ],
  };

  const notifications = {
    attention: { email: true, push: true, in_app: true },
    changes: { email: false, push: false, in_app: true, digest: "daily" },
    system: { email: true, push: false, in_app: true },
    digest_time: "09:00", quiet_hours: { enabled: true, from: "20:00", to: "08:00" }, muted_workspaces: [],
  };

  const sessions = [
    { id: "se1", device: "Chrome on Windows", location: "Bengaluru, IN", last_active: mins(0), current: true },
    { id: "se2", device: "Safari on iPhone", location: "Bengaluru, IN", last_active: d(-1, "21:10") },
    { id: "se3", device: "Chrome on macOS", location: "Mumbai, IN", last_active: d(-6, "10:00") },
  ];

  return {
    me, people, sources, connectors, memory: M, categories, reviews, attention, conflicts, threads, conversationTotal,
    events, files, members, askHistory, updates, workspaces, billing, notifications, sessions,
    workspaceSettings: { review_rule: "always", auto_accept_high: false, retention_days: 30 },
  };
}

module.exports = { build, uid, mins, d, ago, MIN, HOUR, DAY };
