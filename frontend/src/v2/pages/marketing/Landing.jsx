import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight, AlertTriangle, Plug, Layers, Bell, Reply, MessageCircleQuestion, ShieldCheck, Check, Clock, ChevronDown, Lock, History,
} from "lucide-react";
import { useAuth } from "../../../lib/AuthContext";
import { Badge, Button, EvidenceChip, Kbd, SourceMark } from "../../ui/primitives";
import { Section } from "./Layout";
import { Seo } from "../../shell/Seo";
import { cn } from "../../../lib/utils";

export default function Landing() {
  const { user } = useAuth();
  const navigate = useNavigate();
  return (
    <>
      <Seo title={null} description="Bracket connects your email, Slack and notes, remembers what was agreed, notices when it changes, and helps you respond with the right context." noindex={false} />
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-[radial-gradient(60%_50%_at_50%_0%,rgba(255,255,255,0.07),transparent)]" aria-hidden="true" />
        <div className="mx-auto max-w-[1200px] px-4 pt-20 text-center md:px-8 md:pt-28">
          <p className="eyebrow">A memory for your business</p>
          <h1 className="mx-auto mt-4 max-w-[860px] text-[40px] leading-[44px] md:text-[64px] md:leading-[68px] font-semibold tracking-[-2px]">Your business, remembered.</h1>
          <p className="mx-auto mt-5 max-w-[620px] text-body-l md:text-[18px] md:leading-[28px] text-fg-tertiary">
            Bracket connects your email, Slack and notes, remembers what was agreed, notices when it changes, and helps you respond with the right context — with a source for every claim.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button variant="primary" size="l" onClick={() => navigate(user ? "/app" : "/signup")} iconRight={ArrowRight}>{user ? "Open Bracket" : "Get started free"}</Button>
            <Button variant="secondary" size="l" onClick={() => document.getElementById("how")?.scrollIntoView({ behavior: "smooth" })}>See how it works</Button>
          </div>
          <p className="mt-4 text-body-s text-fg-tertiary">Free for 14 days · No card required · Set up in 5 minutes</p>
        </div>
        <div className="mx-auto mt-16 max-w-[1100px] px-4 md:px-8"><ProductMock /></div>
      </section>

      {/* Tools */}
      <div className="mx-auto max-w-[1200px] px-4 pt-16 md:px-8">
        <p className="text-center eyebrow">Learns from the tools you already use</p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {[["gmail", "Gmail"], ["slack", "Slack"], ["meeting", "Notes & transcripts"], ["figma", "Figma"], ["github", "GitHub"], ["notion", "Notion"]].map(([p, l]) => (
            <span key={p} className="inline-flex h-9 items-center gap-2 rounded-full border border-line px-3.5 text-body-m text-fg-secondary"><SourceMark provider={p} size={15} />{l}</span>
          ))}
        </div>
      </div>

      {/* Problem */}
      <Section id="product" eyebrow="The problem" title="Your business lives in a dozen places." sub="Every business already has the information it needs. It’s just scattered — and remembering it all has quietly become your job.">
        <div className="mt-14 grid gap-4 md:grid-cols-3">
          {[
            [Layers, "Decisions get buried", "Agreed on a call, confirmed in an email, changed in a Slack thread. Nobody can find the final version."],
            [AlertTriangle, "Requirements change quietly", "A “small” request lands in a reply. Scope moves, and the deadline doesn’t."],
            [History, "People remember differently", "Two weeks later, everyone has a different version of what was promised."],
          ].map(([I, t, d]) => (
            <div key={t} className="rounded-xl border border-line bg-surface p-6">
              <I size={18} className="text-fg-secondary" strokeWidth={1.75} />
              <p className="mt-5 text-title-m">{t}</p>
              <p className="mt-2 text-body-m text-fg-tertiary">{d}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* How */}
      <Section id="how" eyebrow="How it works" title="Connect once. Bracket keeps up." className="border-t border-line-subtle">
        <div className="mt-14 grid gap-px overflow-hidden rounded-xl border border-line bg-line md:grid-cols-4">
          {[
            ["01", Plug, "Connect", "Choose the threads, channels and notes Bracket may read. Nothing else."],
            ["02", Layers, "Remember", "Bracket builds memory — decisions, commitments, scope, people — each with its source."],
            ["03", Bell, "Notice", "When something changes, you get one grouped review, not ten notifications."],
            ["04", Reply, "Respond", "Ask anything, or reply with a draft that knows the whole story."],
          ].map(([n, I, t, d]) => (
            <div key={n} className="bg-surface p-6">
              <p className="font-mono text-mono-s text-fg-tertiary">{n}</p>
              <I size={18} className="mt-5 text-fg-secondary" strokeWidth={1.75} />
              <p className="mt-4 text-title-m">{t}</p>
              <p className="mt-2 text-body-m text-fg-tertiary">{d}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Features */}
      <Section className="border-t border-line-subtle" eyebrow="Built on trust" title="Humans stay in control of every important change.">
        <div className="mt-14 grid gap-4 md:grid-cols-3">
          <Feature icon={AlertTriangle} title="Change review" body="Bracket proposes; you accept, edit or dismiss. Low-confidence items are unselected by default. Undo is always one click away." />
          <Feature icon={Check} title="Every claim has evidence" body="Each memory links to the exact message it came from — sender, date and the words that matter." />
          <Feature icon={MessageCircleQuestion} title="Ask with citations" body="“Did we agree to a two-week deadline?” — a straight answer, with sources and what Bracket isn’t sure about." />
        </div>
      </Section>

      {/* Security */}
      <Section className="border-t border-line-subtle">
        <div className="grid items-center gap-10 md:grid-cols-2">
          <div>
            <p className="eyebrow">Security</p>
            <h2 className="mt-3 text-[30px] leading-[36px] md:text-[40px] md:leading-[46px] font-semibold tracking-[-1px]">Reads only what you choose.</h2>
            <p className="mt-4 text-body-l text-fg-tertiary">You pick the specific threads and channels. Bracket never sends, edits or deletes anything without your approval, and your business data is never used to train general AI models.</p>
            <Link to="/security" className="mt-6 inline-flex items-center gap-1.5 text-body-m text-fg hover:underline">How we protect your data <ArrowRight size={14} /></Link>
          </div>
          <ul className="space-y-3">
            {["Scoped access — only the sources you select", "Never sends without your approval", "Encrypted in transit and at rest", "Deleted data recoverable for 30 days, then removed", "Never used to train general AI models"].map((t) => (
              <li key={t} className="flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3 text-body-m text-fg-secondary"><Lock size={15} className="text-fg-tertiary" />{t}</li>
            ))}
          </ul>
        </div>
      </Section>

      {/* FAQ */}
      <Section className="border-t border-line-subtle" eyebrow="Questions" title="Frequently asked">
        <div className="mx-auto mt-12 max-w-[760px]"><Faq /></div>
      </Section>

      {/* CTA */}
      <section className="border-t border-line-subtle">
        <div className="mx-auto max-w-[1200px] px-4 py-24 text-center md:px-8">
          <h2 className="text-[30px] leading-[36px] md:text-[44px] md:leading-[50px] font-semibold tracking-[-1px]">Stop being the memory of your business.</h2>
          <div className="mt-8 flex justify-center gap-3">
            <Button variant="primary" size="l" onClick={() => navigate(user ? "/app" : "/signup")}>{user ? "Open Bracket" : "Get started free"}</Button>
            <Link to="/pricing"><Button variant="secondary" size="l">See pricing</Button></Link>
          </div>
        </div>
      </section>
    </>
  );
}

function Feature({ icon: I, title, body }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-6">
      <I size={18} className="text-fg-secondary" strokeWidth={1.75} />
      <p className="mt-5 text-title-m">{title}</p>
      <p className="mt-2 text-body-m text-fg-tertiary">{body}</p>
    </div>
  );
}

export const FAQS = [
  ["What does Bracket actually read?", "Only the specific Gmail threads, Slack channels, files and notes you select. It never browses your inbox or workspace on its own."],
  ["Will it send anything on my behalf?", "Never without you. Bracket drafts replies; you review, edit and choose to send."],
  ["What counts as a project?", "Each project is one workspace in Bracket — a client, engagement or business. Monthly covers up to 10 active projects; archived ones don’t count."],
  ["Is my data used to train AI?", "No. Your workspace content, connected sources, files, notes and Bracket Memory are never used to train general-purpose AI models — ours or our providers’."],
  ["Can I cancel anytime?", "Yes. You keep access until the end of the period, and your memory stays readable — nothing is deleted."],
];
export function Faq() {
  const [open, setOpen] = useState(0);
  return (
    <div className="divide-y divide-line-subtle rounded-xl border border-line bg-surface">
      {FAQS.map(([q, a], i) => (
        <div key={q}>
          <button className="flex w-full items-center gap-4 px-5 py-4 text-left" aria-expanded={open === i} onClick={() => setOpen(open === i ? -1 : i)}>
            <span className="flex-1 text-title-s">{q}</span>
            <ChevronDown size={16} className={cn("text-fg-tertiary transition-transform duration-base", open === i && "rotate-180")} />
          </button>
          {open === i && <p className="px-5 pb-5 -mt-1 text-body-m text-fg-tertiary animate-fade-in">{a}</p>}
        </div>
      ))}
    </div>
  );
}

/* Static product preview (rendered UI, not a screenshot) */
function ProductMock() {
  return (
    <div className="overflow-hidden rounded-xl border border-line-strong bg-app shadow-overlay" aria-label="Bracket product preview" role="img">
      <div className="flex h-11 items-center gap-2 border-b border-line-subtle px-4">
        <span className="inline-flex h-5 w-5 items-center justify-center rounded border border-line bg-raised text-[9px] font-semibold">AF</span>
        <span className="text-body-s text-fg-tertiary">Acme Finance /</span><span className="text-body-s">Fintech Landing Page Redesign</span>
        <span className="flex-1" />
        <span className="hidden sm:flex h-7 w-48 items-center gap-2 rounded-md border border-line px-2 text-body-s text-fg-tertiary">Search or jump to… <span className="flex-1" /><Kbd>⌘K</Kbd></span>
      </div>
      <div className="grid md:grid-cols-[200px_1fr]">
        <div className="hidden md:block border-r border-line-subtle bg-sidebar p-3 text-left">
          <p className="eyebrow px-2 pb-2">Workspace</p>
          {["Overview", "Memory", "Conversations", "Timeline"].map((l, i) => <p key={l} className={cn("rounded-md px-2 py-1.5 text-body-s", i === 0 ? "bg-selected text-fg" : "text-fg-tertiary")}>{l}</p>)}
          <p className="eyebrow px-2 pb-2 pt-4">Sources</p>
          {[["gmail", "Gmail"], ["slack", "Slack"], ["meeting", "Notes"]].map(([p, l]) => <p key={l} className="flex items-center gap-2 px-2 py-1.5 text-body-s text-fg-tertiary"><SourceMark provider={p} size={12} />{l}</p>)}
        </div>
        <div className="p-5 text-left md:p-6">
          <p className="text-title-m">Fintech Landing Page Redesign</p>
          <p className="text-body-s text-fg-tertiary">Acme Finance · 3 things need you</p>
          <p className="mt-5 text-title-s">Needs your attention</p>
          <div className="mt-2 rounded-lg border border-line bg-surface">
            <div className="flex flex-col gap-3 border-b border-line-subtle p-4 sm:flex-row sm:items-start">
              <div className="flex-1">
                <p className="text-body-s font-medium text-warning">Potential scope change · affects 5 memories</p>
                <p className="mt-1 text-title-s">Sarah asked to add tablet layouts while keeping the two-week timeline</p>
                <div className="mt-2"><EvidenceChip provider="gmail">Sarah Chen · 09:41</EvidenceChip></div>
              </div>
              <span className="inline-flex h-8 items-center rounded-md bg-inverse px-3 text-body-s font-medium text-fg-inverse">Review 5 changes</span>
            </div>
            <div className="flex items-start gap-3 p-4">
              <div className="flex-1">
                <p className="text-body-s font-medium text-fg-tertiary">Waiting on Acme Finance · 8 days</p>
                <p className="mt-1 text-title-s">Brand assets haven’t been received</p>
              </div>
              <span className="inline-flex h-8 items-center rounded-md border border-line px-3 text-body-s">Draft follow-up</span>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2 text-body-s text-fg-tertiary"><Clock size={12} /> Memory updated 2 min ago <Badge tone="info" className="ml-2">1 due</Badge></div>
        </div>
      </div>
    </div>
  );
}
