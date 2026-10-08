import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Check, MessagesSquare, RefreshCw, User, Lock, Link2, Unlink, Plus } from "lucide-react";
import { useAuth } from "../../../lib/AuthContext";
import { Badge, Button, SourceMark } from "../../ui/primitives";
import { Reveal, Section } from "./Layout";
import { Seo } from "../../shell/Seo";
import { motion, AnimatePresence, EASE } from "../../ui/motion";
import { cn } from "../../../lib/utils";

const TOOLS = [
  { p: "gmail", l: "Gmail" }, { p: "slack", l: "Slack" }, { p: "notes", l: "Notes & transcripts" }, { p: "file", l: "Files" },
  { l: "Figma", soon: "F" }, { l: "GitHub", soon: "G" }, { l: "Notion", soon: "N" }, { l: "Jira", soon: "J" },
];
const PROBLEMS = [
  [MessagesSquare, "Decisions get buried", "Agreed on a call, confirmed in an email, changed in a Slack thread. Nobody can find the final version."],
  [RefreshCw, "Requirements change quietly", "A “small” request lands in a reply. Scope moves, and the deadline doesn’t."],
  [User, "People remember differently", "Two weeks later, everyone has a different version of what was promised."],
];
const STEPS = [
  ["01", "Connect", "Choose the threads, channels and notes Bracket may read. Nothing else."],
  ["02", "Remember", "Bracket builds memory — decisions, commitments, scope, people — each with its source."],
  ["03", "Notice", "When something changes, you get one grouped review, not ten notifications."],
  ["04", "Respond", "Ask anything, or reply with a draft that knows the whole story."],
];
const FEATURES = [
  {
    eyebrow: "Change review", title: "Review what changed. Don’t chase it.", img: "/marketing/feature-review.png", alt: "A change review showing Sarah’s email next to five proposed memory updates",
    body: "When a client asks for something new, Bracket shows what it would change across scope, deliverables and dates — together, with the message that triggered it.",
    checks: ["Accept, edit or dismiss each proposed update", "Low-confidence interpretations start unselected", "Every change is versioned and reversible"],
  },
  {
    eyebrow: "Ask Bracket", title: "Answers with receipts.", img: "/marketing/feature-ask.png", alt: "An Ask Bracket answer with numbered citations and an open source", flip: true, tone: "sidebar",
    body: "Ask anything about your work. Bracket answers from your memory and sources — and tells you what it isn’t sure about.",
    checks: ["Numbered citations open the exact message", "Uncertainty is stated, not hidden", "Says so when the answer isn’t in your sources"],
  },
  {
    eyebrow: "Context-aware replies", title: "Replies that know the whole story.", img: "/marketing/feature-reply.png", alt: "A drafted reply to Sarah grounded in scope, timeline and commitments",
    body: "Drafts use what was agreed, what changed and what’s due — and show what they’re based on. You edit and send.",
    checks: ["Grounded in scope, timeline and commitments", "Uncertain details are highlighted to check", "Send through Gmail or Slack, only when you say so"],
  },
];
export const USE_CASES = [
  ["Freelancers", "Three clients, one inbox.", ["Clients", "Scope", "Payments"]],
  ["Agencies", "Every client, every approval.", ["Deliverables", "Approvals", "Feedback"]],
  ["Startups", "Customers and decisions in one place.", ["Customers", "Issues", "Launches"]],
  ["Accounting firms", "Requests and filings, tracked.", ["Filings", "Documents", "Deadlines"]],
  ["Manufacturers", "Orders that change by email.", ["Orders", "Specs", "Deliveries"]],
];
const TRUST = [
  [Lock, "Reads only what you choose", "Pick the threads and channels. Direct messages are never read."],
  [Check, "Nothing changes without you", "Important updates wait for your review. Every one is reversible."],
  [Link2, "Every claim has a source", "Open the exact message, note or file behind any memory."],
  [Unlink, "Leave any time", "Disconnect a source and choose to keep or remove what was learned."],
];
const SHARED = ["Unlimited connected tools", "Living memory & change review", "Draft & send replies", "Ask Bracket with citations"];
export const PLAN_CARDS = [
  { id: "monthly", name: "Monthly", usd: 12, inr: 999, period: "/ month", desc: "For ongoing client work.", popular: true, features: ["Up to 10 active projects", ...SHARED] },
  { id: "project", name: "Per project", usd: 2, inr: 199, period: "/ project", desc: "For occasional, one-off projects.", features: ["One project, active for 60 days", ...SHARED] },
];
export const FAQS = [
  ["What exactly does Bracket do?", "It connects to Gmail, Slack and your notes, builds a living memory of what’s been agreed, flags when something changes, and helps you reply with the right context."],
  ["Does Bracket read my whole inbox?", "No. You choose the threads and channels it can read. You can change this or disconnect at any time."],
  ["Can Bracket send emails on its own?", "Never. It drafts; you review, edit and send."],
  ["Is my data used to train AI models?", "No. Your data is only used to build your workspace’s memory."],
  ["What’s the difference between the two plans?", "Monthly covers up to 10 active projects. Per project is a one-time payment for a single project, active for 60 days."],
];

export default function Landing() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const start = () => navigate(user ? "/app" : "/signup");
  return (
    <>
      <Seo title={null} description="Bracket connects your email, Slack and notes, remembers what was agreed, notices when it changes, and helps you respond with the right context." noindex={false} />

      {/* Hero — Figma 56:32 */}
      <section id="product" className="relative overflow-hidden bg-app">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[560px] bg-[radial-gradient(50%_60%_at_50%_0%,rgba(255,255,255,0.06),transparent)]" aria-hidden="true" />
        <div className="relative flex flex-col items-center px-4 pt-16 text-center md:px-8 md:pt-[112px]">
          <motion.div className="flex flex-col items-center" initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.07 } } }}>
            {[
              <p key="e" className="eyebrow">A memory for your business</p>,
              <h1 key="h" className="mt-6 text-[44px] font-semibold leading-[1.08] tracking-[-1.32px] md:mt-7 md:text-[72px] md:tracking-[-2.16px]">Your business, remembered.</h1>,
              <p key="s" className="mt-5 max-w-[720px] text-body-l text-fg-secondary md:mt-6 md:text-[18px] md:leading-[28px]">Bracket connects your email, Slack and notes, remembers what was agreed, notices when it changes, and helps you respond with the right context — with a source for every claim.</p>,
              <div key="c" className="mt-8 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
                <Button variant="primary" className="h-11" onClick={start}>{user ? "Open Bracket" : "Get started free"}</Button>
                <Button variant="secondary" className="h-11" onClick={() => document.getElementById("how")?.scrollIntoView({ behavior: "smooth" })}>See how it works</Button>
              </div>,
              <p key="n" className="mt-7 text-caption text-fg-tertiary">Free for 14 days · No card required · Set up in 5 minutes</p>,
            ].map((el) => (
              <motion.div key={el.key} className="flex w-full justify-center" variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE } } }}>{el}</motion.div>
            ))}
          </motion.div>
          <motion.div
            className="relative mt-12 w-full max-w-[1152px] md:mt-11"
            initial={{ opacity: 0, y: 32, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.8, ease: EASE, delay: 0.35 }}
          >
            <img src="/marketing/hero-overview.png" width={1152} height={680} alt="Bracket workspace overview for Acme Finance: needs attention, coming up, memory categories and recent timeline" className="block h-auto w-full rounded-t-xl border border-b-0 border-line" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-app to-transparent" aria-hidden="true" />
          </motion.div>
        </div>
      </section>

      {/* Learns from — 56:169 */}
      <section className="bg-app px-4 pb-6 pt-16 md:px-8">
        <Reveal className="flex flex-col items-center gap-4">
          <p className="eyebrow text-center">Learns from the tools you already use</p>
          <div className="flex flex-wrap justify-center gap-3">
            {TOOLS.map((t) => (
              <div key={t.l} className={cn("flex items-center gap-2 rounded-md border border-line py-2 pl-3 pr-4 text-body-s font-medium text-fg-secondary", t.soon && "opacity-55")}>
                {t.soon ? <span className="flex h-4 w-4 items-center justify-center rounded-[3px] bg-white/[0.06] text-[9px] font-bold text-fg">{t.soon}</span> : <SourceMark provider={t.p === "file" ? "meeting" : t.p} />}
                {t.l}
                {t.soon && <span className="text-caption text-fg-tertiary">Soon</span>}
              </div>
            ))}
          </div>
        </Reveal>
      </section>

      {/* Problem — 56:234 */}
      <Section eyebrow="The problem" title="Your business lives in a dozen places." sub="Every business already has the information it needs. It’s just scattered — and remembering it all has quietly become your job.">
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {PROBLEMS.map(([Icon, h, b], i) => (
            <Reveal key={h} delay={i * 0.06} className="flex flex-col gap-3 rounded-lg border border-line p-6">
              <Icon size={20} strokeWidth={1.75} className="text-fg-secondary" />
              <h3 className="text-title-m">{h}</h3>
              <p className="text-body-m text-fg-secondary">{b}</p>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* How it works — 56:260 */}
      <Section id="how" tone="sidebar" eyebrow="How it works" title="Connect once. Bracket keeps up.">
        <Reveal className="mt-12 grid overflow-hidden rounded-lg border border-line sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(([n, h, b], i) => (
            <div key={n} className={cn("flex flex-col gap-3 px-7 pb-8 pt-7 border-line", i > 0 && "border-t sm:border-t-0", i % 2 === 1 && "sm:border-l", i >= 2 && "sm:border-t lg:border-t-0", i === 2 && "lg:border-l")}>
              <p className="eyebrow">{n}</p>
              <h3 className="text-title-m">{h}</h3>
              <p className="text-body-m text-fg-secondary">{b}</p>
            </div>
          ))}
        </Reveal>
      </Section>

      {/* Features — 57:499 / 57:672 / 57:814 */}
      {FEATURES.map((f) => (
        <section key={f.eyebrow} className={cn("overflow-hidden px-4 py-16 md:px-8 lg:px-[120px] lg:py-24", f.tone === "sidebar" ? "bg-sidebar" : "bg-app")}>
          <div className={cn("mx-auto flex max-w-[1200px] flex-col gap-10 lg:flex-row lg:items-center lg:justify-between lg:gap-16", f.flip && "lg:flex-row-reverse")}>
            <Reveal className="flex max-w-[420px] flex-col gap-4">
              <p className="eyebrow">{f.eyebrow}</p>
              <h2 className="text-[30px] font-semibold leading-[1.1] tracking-[-0.9px] md:text-[36px] md:tracking-[-1.08px]">{f.title}</h2>
              <p className="text-body-l text-fg-secondary">{f.body}</p>
              <ul className="flex flex-col gap-3 pt-2">
                {f.checks.map((c) => (
                  <li key={c} className="flex gap-3 text-body-m text-fg-secondary"><Check size={16} strokeWidth={1.75} className="mt-0.5 shrink-0 text-fg" />{c}</li>
                ))}
              </ul>
            </Reveal>
            <Reveal y={24} delay={0.1} className="w-full lg:w-[680px] lg:shrink-0">
              <img src={f.img} alt={f.alt} width={680} height={520} loading="lazy" className="block h-auto w-full" />
            </Reveal>
          </div>
        </section>
      ))}

      {/* Use cases — 57:832 */}
      <Section tone="sidebar" eyebrow="For any business" title="Bracket learns what matters to yours." sub="There are no templates to set up. Bracket discovers the categories that fit your work from your own sources.">
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {USE_CASES.map(([h, b, tags], i) => (
            <Reveal key={h} delay={i * 0.05} className="flex flex-col gap-3 rounded-lg border border-line bg-app p-5 transition-colors hover:border-line-strong">
              <h3 className="text-title-s">{h}</h3>
              <p className="text-body-s text-fg-secondary">{b}</p>
              <div className="flex flex-wrap gap-x-2 gap-y-1.5 pt-2">{tags.map((t) => <Badge key={t}>{t}</Badge>)}</div>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* Trust — 57:903 */}
      <Section eyebrow="Trust" title="You stay in control.">
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {TRUST.map(([Icon, h, b], i) => (
            <Reveal key={h} delay={i * 0.05} className="flex flex-col gap-3 rounded-lg border border-line p-5">
              <Icon size={16} strokeWidth={1.75} className="text-fg-secondary" />
              <h3 className="text-title-s">{h}</h3>
              <p className="text-body-s text-fg-secondary">{b}</p>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* Pricing — 57:935 */}
      <Section id="pricing" tone="sidebar" eyebrow="Pricing" title="Simple, honest pricing." sub="Pay monthly for ongoing work, or once for a single project. Cancel anytime.">
        <PlanCards className="mt-12" onStart={start} />
        <Reveal className="mt-12 flex justify-center">
          <Link to="/pricing" className="group inline-flex items-center gap-1 text-body-s font-medium text-fg-secondary transition-colors hover:text-fg">
            Compare plans and FAQs <ArrowRight size={16} strokeWidth={1.75} className="transition-transform group-hover:translate-x-0.5" />
          </Link>
        </Reveal>
      </Section>

      {/* FAQ — 57:1026 */}
      <Section eyebrow="FAQ" title="Questions, answered.">
        <FaqList items={FAQS} className="mt-12" />
      </Section>

      {/* Final CTA — 57:1070 */}
      <section className="bg-sidebar px-4 py-20 text-center md:px-8 md:py-[120px]">
        <Reveal className="flex flex-col items-center">
          <h2 className="text-[32px] font-semibold leading-[1.1] tracking-[-0.96px] md:text-[52px] md:tracking-[-1.56px]">Stop re-explaining your business.</h2>
          <p className="mt-6 max-w-[460px] text-body-l text-fg-secondary">Connect one source and see what Bracket remembers in five minutes.</p>
          <Button variant="primary" className="mt-6 h-11" iconRight={ArrowRight} onClick={start}>{user ? "Open Bracket" : "Get started free"}</Button>
        </Reveal>
      </section>
    </>
  );
}

/* Figma › Plan card (55:557): popular = raised surface + control border + primary CTA */
export function PlanCards({ className, onStart, currency = "usd", ctaLabel = "Get started" }) {
  return (
    <div className={cn("mx-auto grid max-w-[824px] gap-6 md:grid-cols-2", className)}>
      {PLAN_CARDS.map((p, i) => (
        <Reveal key={p.id} delay={i * 0.08} className={cn("flex flex-col gap-5 rounded-lg border p-7 transition-colors", p.popular ? "border-line-control bg-raised" : "border-line bg-surface hover:border-line-strong")}>
          <div className="flex items-center gap-2">
            <h3 className="text-title-s">{p.name}</h3>
            <div className="flex-1" />
            {p.popular && <Badge>Most popular</Badge>}
          </div>
          <div className="flex items-end gap-2">
            <span className="text-[40px] font-semibold leading-[44px] tracking-[-0.4px]">{currency === "inr" ? `₹${p.inr}` : `$${p.usd}`}</span>
            <span className="text-body-m text-fg-tertiary">{p.period}</span>
          </div>
          <p className="text-body-s text-fg-secondary">{p.desc}{currency === "inr" ? " Includes GST." : ""}</p>
          <Button variant={p.popular ? "primary" : "secondary"} className="h-10 w-full" onClick={() => onStart?.(p.id)}>{ctaLabel}</Button>
          <div className="h-px bg-line" />
          <ul className="flex flex-col gap-3">
            {p.features.map((f) => (
              <li key={f} className="flex gap-3 text-body-s text-fg-secondary"><Check size={16} strokeWidth={1.75} className="shrink-0 text-success" />{f}</li>
            ))}
          </ul>
        </Reveal>
      ))}
    </div>
  );
}

/* Figma › FAQ row (55:572): whole row is a button with aria-expanded; + becomes × */
export function FaqList({ items, className, defaultOpen = 0 }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Reveal className={cn("mx-auto max-w-[720px]", className)}>
      {items.map(([q, a], i) => {
        const isOpen = open === i;
        return (
          <div key={q} className="border-b border-line">
            <button
              type="button"
              className="flex w-full items-center gap-4 py-5 text-left"
              aria-expanded={isOpen}
              aria-controls={`faq-${i}`}
              onClick={() => setOpen(isOpen ? -1 : i)}
            >
              <span className="flex-1 text-title-s">{q}</span>
              <motion.span animate={{ rotate: isOpen ? 45 : 0 }} transition={{ duration: 0.2, ease: EASE }} className="text-fg-secondary">
                <Plus size={16} strokeWidth={1.75} />
              </motion.span>
            </button>
            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div
                  id={`faq-${i}`}
                  initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.22, ease: EASE }}
                  className="overflow-hidden"
                >
                  <p className="pb-5 text-body-m text-fg-secondary">{a}</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </Reveal>
  );
}
