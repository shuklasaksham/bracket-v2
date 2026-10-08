import React, { useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { Check } from "lucide-react";
import { useAuth } from "../../../lib/AuthContext";
import { Button } from "../../ui/primitives";
import { Reveal } from "./Layout";
import { FaqList, PlanCards } from "./Landing";
import { Seo } from "../../shell/Seo";
import { motion } from "../../ui/motion";
import { cn } from "../../../lib/utils";

/* ───────────────────────── Pricing — Figma 58:1389 ───────────────────────── */
const COMPARE = [
  ["Active projects", "Up to 10", "1 (60 days)"],
  ["Connected sources", "Unlimited", "Unlimited"],
  ["Living memory & history", "Included", "Included"],
  ["Change review & conflict detection", "Included", "Included"],
  ["Ask Bracket with citations", "Included", "Included"],
  ["Draft & send replies", "Included", "Included"],
  ["Notes, transcripts & files", "Included", "Included"],
  ["Project history after it ends", "Forever", "Read-only after 60 days"],
  ["Priority support", "Included", null],
];
const PRICING_FAQ = [
  ["What’s the difference between the two plans?", "Monthly covers up to 10 active projects for ongoing work. Per project is a one-time payment for a single project, active for 60 days."],
  ["What counts as a workspace?", "One client, project or business, with its own sources and memory."],
  ["Can I switch plans?", "Yes. Upgrading applies immediately; per-workspace payments are credited toward your first month."],
  ["Can I cancel anytime?", "Yes. You keep access until the end of the billing period, and can export your memory and history."],
  ["Is my data private?", "Bracket reads only what you choose, never sends without approval, and doesn’t use your data to train models."],
];

export function CurrencyToggle({ value, onChange }) {
  return (
    <div role="radiogroup" aria-label="Currency" className="inline-flex gap-0.5 rounded-md border border-line-control p-1">
      {[["usd", "$ USD"], ["inr", "₹ INR"]].map(([v, l]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)} className={cn("relative rounded px-4 py-2 text-body-s font-medium transition-colors", value === v ? "text-fg" : "text-fg-secondary hover:text-fg")}>
          {value === v && <motion.span layoutId="currency-pill" className="absolute inset-0 rounded bg-white/[0.06]" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
          <span className="relative">{l}</span>
        </button>
      ))}
    </div>
  );
}

export const defaultCurrency = () => {
  try { const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; return tz.startsWith("Asia/Calcutta") || tz.startsWith("Asia/Kolkata") ? "inr" : "usd"; } catch { return "usd"; }
};

export function Pricing() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [currency, setCurrency] = useState(defaultCurrency);
  const start = (plan) => navigate(user ? `/settings/billing?plan=${plan}` : `/signup?plan=${plan}`);
  return (
    <>
      <Seo title="Pricing" noindex={false} description="Simple, honest pricing. Monthly for ongoing work, or per project." />
      <section className="flex flex-col items-center gap-5 px-4 pb-12 pt-16 text-center md:px-8 md:pt-24">
        <Reveal className="flex flex-col items-center gap-5">
          <p className="eyebrow">Pricing</p>
          <h1 className="text-[40px] font-semibold leading-[1.1] tracking-[-1.2px] md:text-[56px] md:tracking-[-1.68px]">Simple, honest pricing.</h1>
          <p className="max-w-[640px] text-body-l text-fg-secondary">Pay monthly for ongoing work, or once for a single project. Every plan starts with 14 days free.</p>
          <CurrencyToggle value={currency} onChange={setCurrency} />
        </Reveal>
        <PlanCards className="w-full text-left" currency={currency} onStart={start} />
        <p className="max-w-[824px] text-caption text-fg-tertiary">Prices in ₹ include GST. USD prices shown exclude any local taxes. Cancel anytime — you keep access until the end of the period.</p>
      </section>

      <section className="flex flex-col items-center gap-6 px-4 py-16 md:px-8">
        <Reveal as="h2" className="text-[28px] font-semibold leading-[1.1] tracking-[-0.84px] md:text-[32px] md:tracking-[-0.96px]">Compare plans</Reveal>
        <Reveal className="w-full max-w-[824px] overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[520px] text-body-s">
            <thead>
              <tr className="border-b border-line-subtle bg-surface text-left">
                {["Feature", "Monthly", "Per project"].map((h, i) => <th key={h} scope="col" className={cn("px-5 py-3 text-eyebrow uppercase text-fg-tertiary", i > 0 && "w-[180px]")}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {COMPARE.map(([f, a, b]) => (
                <tr key={f} className="border-b border-line-subtle transition-colors last:border-0 hover:bg-white/[0.02]">
                  <th scope="row" className="px-5 py-3 text-left font-normal text-fg">{f}</th>
                  <td className="px-5 py-3 text-fg-secondary">{a}</td>
                  <td className={cn("px-5 py-3", b ? "text-fg-secondary" : "text-fg-disabled")}>{b || <><span aria-hidden="true">—</span><span className="sr-only">Not included</span></>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Reveal>
      </section>

      <section className="flex flex-col items-center gap-6 px-4 pb-24 pt-16 md:px-8">
        <Reveal as="h2" className="text-[28px] font-semibold leading-[1.1] tracking-[-0.84px] md:text-[32px] md:tracking-[-0.96px]">Questions</Reveal>
        <FaqList items={PRICING_FAQ} className="w-full max-w-[824px]" />
        <p className="text-body-s text-fg-tertiary">Still stuck? Email <a href="mailto:support@use-bracket.com" className="text-fg-secondary hover:text-fg">support@use-bracket.com</a></p>
      </section>
    </>
  );
}

/* ───────────────────────── Legal — Figma 72:2438 / 110:3079 / 110:3173 ───────────────────────── */
const LEGAL_NAV = [
  ["Privacy policy", "/privacy"],
  ["Terms of service", "/terms"],
  ["Security", "/security"],
  ["Data processing (DPA)", "mailto:support@use-bracket.com?subject=DPA%20request"],
  ["Subprocessors", "mailto:support@use-bracket.com?subject=Subprocessor%20list"],
];

const PRIVACY = {
  title: "Privacy policy",
  short: [
    "Bracket reads only the sources, threads and channels you choose to connect.",
    "We never sell your data or use it to train general-purpose AI models.",
    "Deleted data is recoverable for 30 days, then removed from active systems.",
  ],
  sections: [
    ["1. Data retention and deletion", [
      "When you delete a workspace or your Bracket account, we will schedule the associated data for deletion. We may retain deleted data for up to 30 days to allow for recovery, security investigations, fraud prevention, dispute resolution, and compliance with legal obligations.",
      "After this period, the data will be deleted from our active systems. Residual copies may remain in encrypted backups for a limited period until those backups are automatically overwritten or expire.",
      "We may retain certain information for longer where required by law, necessary to enforce our agreements, prevent abuse, maintain financial or transaction records, or establish, exercise, or defend legal claims.",
    ]],
    ["2. AI and model training", [
      "Bracket processes information from the sources you choose to connect, including conversations, notes, files, and other business information, to provide features such as memory creation, information extraction, change detection, contextual answers, and suggested responses.",
      "We do not use your workspace content, connected-source content, files, conversations, notes, or Bracket Memory to train general-purpose AI models.",
      "Where Bracket uses third-party AI service providers to process information, we require those services to process the information for the purpose of providing Bracket’s functionality and subject to their applicable data-processing and security terms.",
    ]],
    ["3. Connected services", [
      "When you connect a third-party service such as Gmail, Slack, Figma, GitHub, or another supported integration, Bracket accesses only the information authorized through that connection and uses it to provide the features you request.",
      "You can disconnect an integration at any time. Disconnecting a service stops future synchronization from that service but does not automatically delete information that Bracket previously imported or derived from it.",
      "You can delete that information by deleting the relevant workspace or account, subject to the retention periods described above.",
    ]],
    ["4. Contact", [<>Bracket Inc. · <a href="mailto:support@use-bracket.com" className="text-fg hover:underline">support@use-bracket.com</a></>]],
  ],
};

const TERMS = {
  title: "Terms of service",
  short: [
    "You own your content; Bracket processes it only to run the service you use.",
    "AI-generated information can be wrong — review important details before relying on them.",
    "A failed payment starts a 7-day grace period. Nothing is deleted.",
  ],
  sections: [
    ["1. Subscription payments and failed payments", [
      "Paid subscriptions are billed according to the billing cycle and pricing displayed when you subscribe.",
      "If a payment fails, Bracket or its payment provider may automatically retry the payment. We may provide a grace period of up to 7 days following the failed payment.",
      "During the grace period, you may continue to access your account. If payment remains unsuccessful after the grace period, Bracket may pause synchronization with connected services and restrict access to paid functionality.",
      "We will not immediately delete your workspace solely because a subscription payment fails. Your information will remain subject to our data-retention and deletion policies.",
      "If payment is subsequently completed and your subscription is restored, synchronization and eligible paid functionality may resume.",
    ]],
    ["2. Your content", [
      "You retain ownership of the content and information you provide to Bracket or authorize Bracket to access.",
      "You grant Bracket a limited right to process, store, transmit, organize, analyze, and display that information only as reasonably necessary to operate, secure, maintain, and improve the Bracket service and provide the functionality you request.",
      "Using Bracket does not transfer ownership of your business information to Bracket.",
    ]],
    ["3. AI-generated information", [
      "Bracket uses automated and AI-based systems to extract, organize, summarize, interpret, and generate information.",
      "AI-generated information may occasionally be incomplete, inaccurate, or incorrectly interpreted. You are responsible for reviewing important information, suggested responses, detected changes, and actions before relying on them for significant business, financial, legal, or other decisions.",
      "Bracket should not be treated as a substitute for professional legal, financial, tax, medical, or other regulated professional advice.",
    ]],
    ["4. Account termination", [
      "You may stop using Bracket and delete your account in accordance with the controls provided by the service.",
      "We may suspend or terminate access where reasonably necessary because of violations of these Terms, unlawful activity, security risks, abuse of the service, or prolonged non-payment.",
      "Deletion of associated data will follow the retention practices described in our Privacy Policy.",
    ]],
  ],
};

const SECURITY = {
  title: "Security",
  short: [
    "Encrypted in transit (TLS 1.2+) and at rest (AES-256).",
    "Least-privilege OAuth scopes; tokens stored encrypted.",
    "Every memory change is logged with who, when and why.",
  ],
  sections: [
    ["Access", ["Role-based access per workspace: Owner, Editor, Viewer."]],
    ["Infrastructure", ["Hosted with a major cloud provider. Daily encrypted backups."]],
    ["Disclosure", [<>Report issues to <a href="mailto:support@use-bracket.com" className="text-fg hover:underline">support@use-bracket.com</a>.</>]],
  ],
};

function LegalPage({ doc }) {
  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-10 px-4 pb-24 pt-10 md:px-8 md:pt-20 lg:flex-row lg:gap-16 lg:px-0">
      <Seo title={doc.title} noindex={false} />
      <nav aria-label="Legal" className="lg:sticky lg:top-[112px] lg:w-[240px] lg:shrink-0 lg:self-start">
        <p className="eyebrow">Legal</p>
        <ul className="mt-3 flex gap-4 overflow-x-auto lg:flex-col lg:gap-3">
          {LEGAL_NAV.map(([l, to]) => (
            <li key={l} className="shrink-0">
              {to.startsWith("mailto") ? (
                <a href={to} className="text-body-s text-fg-tertiary transition-colors hover:text-fg">{l}</a>
              ) : (
                <NavLink to={to} className={({ isActive }) => cn("text-body-s transition-colors hover:text-fg", isActive ? "text-fg" : "text-fg-tertiary")}>{l}</NavLink>
              )}
            </li>
          ))}
        </ul>
      </nav>
      <motion.article className="min-w-0 max-w-[720px] flex-1" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
        <h1 className="text-[36px] font-semibold leading-[48px] tracking-[-1.08px] md:text-[44px] md:tracking-[-1.32px]">{doc.title}</h1>
        <p className="mt-5 text-caption text-fg-tertiary">Last updated Oct 8, 2026</p>
        <div className="mt-5 rounded-lg border border-line bg-surface px-5 py-4">
          <p className="text-title-s">In short</p>
          <ul className="mt-3 flex flex-col gap-3">
            {doc.short.map((s) => <li key={s} className="flex gap-3 text-body-m text-fg-secondary"><Check size={16} strokeWidth={1.75} className="mt-0.5 shrink-0 text-success" />{s}</li>)}
          </ul>
        </div>
        {doc.sections.map(([h, paras]) => (
          <section key={h} className="mt-5">
            <h2 className="text-title-m">{h}</h2>
            {paras.map((p, i) => <p key={i} className="mt-5 text-body-l text-fg-secondary">{p}</p>)}
          </section>
        ))}
      </motion.article>
    </div>
  );
}

export const Privacy = () => <LegalPage doc={PRIVACY} />;
export const Terms = () => <LegalPage doc={TERMS} />;
export const Security = () => <LegalPage doc={SECURITY} />;

/* ───────────────────────── 404 — Figma 110:3265 ───────────────────────── */
export function NotFound() {
  return (
    <div className="flex flex-col items-center gap-6 px-4 pb-[200px] pt-24 text-center md:pt-[160px]">
      <Seo title="Page not found" />
      <Reveal className="flex flex-col items-center gap-6">
        <p className="font-mono text-mono-s text-fg-tertiary">404</p>
        <h1 className="text-[36px] font-semibold leading-[1.1] tracking-[-0.9px] md:text-[52px] md:tracking-[-1.3px]">This page wandered off.</h1>
        <p className="text-body-l text-fg-secondary">Bracket remembers a lot — but not this URL.</p>
        <div className="flex gap-3">
          <Link to="/"><Button variant="primary">Go home</Button></Link>
          <Link to="/contact"><Button variant="secondary">Contact us</Button></Link>
        </div>
      </Reveal>
    </div>
  );
}
