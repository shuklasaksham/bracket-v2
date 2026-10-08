import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { MessageCircleQuestion, Mail, User, Lock, CheckCircle2 } from "lucide-react";
import { useAuth } from "../../../lib/AuthContext";
import { Badge, Button, Field, Input, Textarea } from "../../ui/primitives";
import { Reveal } from "./Layout";
import { Seo } from "../../shell/Seo";
import { v2 } from "../../lib/api2";
import { AnimatePresence, motion, EASE } from "../../ui/motion";
import { cn } from "../../../lib/utils";

/* Page header shared by Use cases / Changelog / About — left aligned, padding 96/120 */
function PageHead({ eyebrow, title, sub, titleClass }) {
  return (
    <Reveal className="flex flex-col">
      <p className="eyebrow">{eyebrow}</p>
      <h1 className={cn("mt-6 text-[36px] font-semibold leading-[1.1] tracking-[-1.08px] md:text-[52px] md:tracking-[-1.56px]", titleClass)}>{title}</h1>
      {sub && <p className="mt-6 max-w-[680px] text-body-l text-fg-secondary">{sub}</p>}
    </Reveal>
  );
}
const Wrap = ({ children, className }) => <div className={cn("mx-auto max-w-[1200px] px-4 pt-16 md:px-8 md:pt-24 xl:px-0", className)}>{children}</div>;

/* ───────────────────────── Use cases — Figma 110:2721 ───────────────────────── */
const CASES = [
  ["Freelancers", "Three clients, one inbox, no project manager.", ["Clients", "Scope", "Payments", "Feedback"], "A client adds “just one more page” in an email — Bracket flags it as scope, not a favour.", "Which invoices are still unpaid?"],
  ["Agencies", "Every client, every approval, every change.", ["Deliverables", "Approvals", "Requirements", "Commitments"], "An approval in Slack and a contradiction in email surface as one conflict to resolve.", "What did the client approve for the homepage?"],
  ["Startups", "Customers, decisions and launches in one place.", ["Customers", "Product decisions", "Issues", "Launches"], "A customer call note turns into a requirement and links to the GitHub issue.", "Why did we drop SSO from the launch?"],
  ["Accounting firms", "Requests, filings and deadlines per client.", ["Clients", "Filings", "Documents", "Deadlines"], "A client’s reply with missing documents updates the checklist and the deadline risk.", "Which clients haven’t sent Q3 statements?"],
  ["Manufacturers", "Orders that change by email.", ["Orders", "Specifications", "Deliveries", "Payments"], "A buyer raises quantity and adds a colour — Bracket checks capacity and drafts a split-shipment reply.", "Can we hold $6.40 if we add Coral?"],
];

export function UseCases() {
  const { user } = useAuth();
  const navigate = useNavigate();
  return (
    <>
      <Seo title="Use cases" noindex={false} description="One memory model for any business — freelancers, agencies, startups, accounting firms and manufacturers." />
      <Wrap>
        <PageHead eyebrow="Use cases" title="One memory model. Any business." sub="Bracket doesn’t ship templates. It learns the categories that matter from your own sources — here’s what that looks like for five kinds of work." />
        <div className="mt-6">
          {CASES.map(([h, sub, tags, notice, ask]) => (
            <Reveal key={h} className="flex flex-col gap-6 border-t border-line-subtle py-7 lg:flex-row lg:gap-12">
              <div className="lg:w-[360px] lg:shrink-0">
                <h2 className="text-title-l">{h}</h2>
                <p className="mt-2 text-body-m text-fg-secondary">{sub}</p>
                <div className="mt-2 flex flex-wrap gap-2 pt-2">{tags.map((t) => <Badge key={t}>{t}</Badge>)}</div>
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-3">
                <div className="rounded-lg border border-line px-4 py-3">
                  <p className="text-caption text-fg-tertiary">What Bracket notices</p>
                  <p className="mt-1 text-body-m text-fg">{notice}</p>
                </div>
                <div className="flex items-center gap-3 rounded-lg bg-surface px-4 py-3 text-body-m text-fg-secondary">
                  <MessageCircleQuestion size={16} strokeWidth={1.75} className="shrink-0 text-fg-tertiary" />
                  “{ask}”
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </Wrap>
      <div className="mx-auto flex max-w-[1200px] gap-3 px-4 pb-24 pt-12 md:px-8 xl:px-0">
        <Button variant="primary" onClick={() => navigate(user ? "/app" : "/signup")}>{user ? "Open Bracket" : "Get started free"}</Button>
        <Link to="/contact"><Button variant="secondary">Talk to us</Button></Link>
      </div>
    </>
  );
}

/* ───────────────────────── Changelog — Figma 110:2927 ───────────────────────── */
const ENTRIES = [
  ["2025-10-06", "Oct 6, 2025", "Resolve conflicts", "When sources disagree, Bracket now shows both sides and asks you to decide — then updates memory and drafts the reply.", ["Memory", "Review"]],
  ["2025-09-29", "Sep 29, 2025", "Slack channels", "Connect Slack channels alongside Gmail. Direct messages are never read.", ["Sources"]],
  ["2025-09-15", "Sep 15, 2025", "Ask with citations", "Every answer links to the exact message, note or file it came from — and says when it isn’t sure.", ["Ask"]],
];

export function Changelog() {
  return (
    <>
      <Seo title="Changelog" noindex={false} description="What’s new in Bracket." />
      <Wrap className="pb-24">
        <PageHead eyebrow="Changelog" title="What’s new in Bracket" />
        <ol className="mt-6">
          {ENTRIES.map(([iso, date, h, body, tags]) => (
            <Reveal as="li" key={h} className="flex flex-col gap-3 border-t border-line-subtle py-7 md:flex-row md:gap-12">
              <time dateTime={iso} className="font-mono text-mono-s text-fg-tertiary md:w-[160px] md:shrink-0">{date}</time>
              <article className="min-w-0 flex-1">
                <h2 className="text-title-l">{h}</h2>
                <p className="mt-3 text-body-l text-fg-secondary">{body}</p>
                <div className="mt-3 flex flex-wrap gap-2">{tags.map((t) => <Badge key={t}>{t}</Badge>)}</div>
              </article>
            </Reveal>
          ))}
        </ol>
      </Wrap>
    </>
  );
}

/* ───────────────────────── About — Figma 110:3011 ───────────────────────── */
export function About() {
  return (
    <>
      <Seo title="About" noindex={false} description="Businesses shouldn’t have to keep re-explaining themselves." />
      <Wrap>
        <PageHead eyebrow="About" title="Businesses shouldn’t have to keep re-explaining themselves." titleClass="max-w-[900px]" />
        <Reveal className="mt-6 flex max-w-[760px] flex-col gap-6 text-body-l text-fg-secondary">
          <p>Every business already has the information it needs — in emails, chats, notes and files. What it doesn’t have is memory: one place that knows what was agreed, notices when it changes, and can prove where it came from.</p>
          <p>
            We’re building Bracket so that knowing what’s true about your work stops being someone’s second job. Bracket Inc. ·{" "}
            <a href="mailto:support@use-bracket.com" className="hover:text-fg">support@use-bracket.com</a> ·{" "}
            <a href="https://www.linkedin.com/company/bracket-app/" target="_blank" rel="noopener noreferrer" className="hover:text-fg">linkedin.com/company/bracket-app</a>
          </p>
        </Reveal>
      </Wrap>
      <div className="mx-auto max-w-[1200px] px-4 pb-24 pt-[104px] md:px-8 xl:px-0">
        <Reveal as="h2" className="text-title-l">What we believe</Reveal>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {[["Evidence over magic", "Every claim links to its source."], ["People decide", "Bracket proposes; humans accept."], ["Quiet by default", "Only interrupt for what matters."]].map(([h, b], i) => (
            <Reveal key={h} delay={i * 0.06} className="rounded-lg border border-line p-5">
              <h3 className="text-title-s">{h}</h3>
              <p className="mt-2 text-body-m text-fg-secondary">{b}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </>
  );
}

/* ───────────────────────── Contact + Sent — Figma 72:2524 / 72:2629 ───────────────────────── */
export function Contact() {
  const { user } = useAuth();
  const [form, setForm] = useState({ name: user?.name || "", email: user?.email || "", company: "", message: "" });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(null);
  useEffect(() => {
    if (user) setForm((f) => ({ ...f, name: f.name || user.name || "", email: f.email || user.email || "" }));
  }, [user]);
  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setErrors((x) => ({ ...x, [k]: null, form: null })); };

  const submit = async (e) => {
    e.preventDefault();
    const next = {};
    if (!form.name.trim()) next.name = "Enter your name.";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) next.email = "Enter a valid email address.";
    if (!form.message.trim()) next.message = "Tell us how we can help.";
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      await v2.contact({ ...form, name: form.name.trim(), email: form.email.trim() });
      setSent({ first: form.name.trim().split(/\s+/)[0], email: form.email.trim() });
    } catch (err) {
      const d = err?.response?.data;
      if (d?.field) setErrors({ [d.field]: d.detail || d.message });
      else setErrors({ form: d?.detail || d?.message || "Couldn’t send your message. Check your connection and try again." });
    } finally { setBusy(false); }
  };

  const ways = [
    [Mail, "support@use-bracket.com", "Product help and billing", "mailto:support@use-bracket.com"],
    [User, "Book a 20-minute demo", "See Bracket on your own sources", "mailto:support@use-bracket.com?subject=Demo%20request"],
    [Lock, "support@use-bracket.com", "Security and data questions", "mailto:support@use-bracket.com?subject=Security%20question"],
  ];

  return (
    <>
      <Seo title="Contact" noindex={false} description="Talk to a human. We reply within one business day." />
      <div className="mx-auto flex max-w-[1200px] flex-col gap-12 px-4 pb-24 pt-16 md:px-8 md:pt-24 lg:flex-row lg:gap-24 xl:px-0">
        <Reveal className="lg:w-[460px] lg:shrink-0">
          <p className="eyebrow">Contact</p>
          <h1 className="mt-5 text-[36px] font-semibold leading-[1.1] tracking-[-1.08px] md:text-[48px] md:tracking-[-1.44px]">Talk to a human.</h1>
          <p className="mt-5 text-body-l text-fg-secondary">Questions about Bracket, a demo for your team, or help with your workspace — we reply within one business day.</p>
          <ul className="mt-5 flex flex-col gap-5">
            {ways.map(([Icon, h, sub, href]) => (
              <li key={sub}>
                <a href={href} className="group flex items-center gap-3">
                  <Icon size={16} strokeWidth={1.75} className="shrink-0 text-fg-secondary" />
                  <span>
                    <span className="block text-body-m text-fg group-hover:underline">{h}</span>
                    <span className="block text-caption font-normal text-fg-tertiary">{sub}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </Reveal>

        <div className="w-full lg:max-w-[520px]">
          <AnimatePresence mode="popLayout" initial={false}>
            {sent ? (
              <motion.div key="sent" role="status" className="rounded-lg border border-line bg-surface p-7" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.25, ease: EASE }}>
                <motion.span initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.1, type: "spring", stiffness: 400, damping: 20 }} className="inline-flex">
                  <CheckCircle2 size={20} strokeWidth={1.75} className="text-success" />
                </motion.span>
                <h2 className="mt-3 text-title-m">Thanks, {sent.first} — message received.</h2>
                <p className="mt-3 text-body-m text-fg-secondary">We’ll reply to {sent.email} within one business day.</p>
                <Link to="/" className="mt-4 inline-block"><Button variant="secondary">Back to home</Button></Link>
              </motion.div>
            ) : (
              <motion.form key="form" noValidate onSubmit={submit} className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-7" exit={{ opacity: 0, scale: 0.98 }} transition={{ duration: 0.15 }}>
                <Field label="Name" htmlFor="c-name" error={errors.name}>
                  <Input id="c-name" autoComplete="name" value={form.name} onChange={set("name")} invalid={!!errors.name} className="h-9" />
                </Field>
                <Field label="Work email" htmlFor="c-email" error={errors.email}>
                  <Input id="c-email" type="email" autoComplete="email" value={form.email} onChange={set("email")} invalid={!!errors.email} className="h-9" />
                </Field>
                <Field label="Company (optional)" htmlFor="c-company">
                  <Input id="c-company" autoComplete="organization" value={form.company} onChange={set("company")} className="h-9" />
                </Field>
                <Field label="How can we help?" htmlFor="c-msg" error={errors.message}>
                  <Textarea id="c-msg" rows={5} value={form.message} onChange={set("message")} invalid={!!errors.message} placeholder="We’re a 6-person agency — can Bracket handle 15 client workspaces?" className="min-h-[120px]" />
                </Field>
                {errors.form && <p role="alert" className="text-body-s text-danger">{errors.form}</p>}
                <Button type="submit" variant="primary" className="h-11 w-full" loading={busy}>{busy ? "Sending…" : "Send message"}</Button>
                <p className="text-caption font-normal text-fg-tertiary">We’ll only use your email to reply.</p>
              </motion.form>
            )}
          </AnimatePresence>
        </div>
      </div>
    </>
  );
}
