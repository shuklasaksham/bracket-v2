import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Check, ShieldCheck, Lock, Eye, Trash2, ServerCog, KeyRound, SearchX } from "lucide-react";
import { useAuth } from "../../../lib/AuthContext";
import { PLANS } from "../../lib/data";
import { Button, Segmented, EmptyState } from "../../ui/primitives";
import { Section } from "./Layout";
import { Faq } from "./Landing";
import { Seo } from "../../shell/Seo";
import { cn } from "../../../lib/utils";

/* ───────────────────────── Pricing ───────────────────────── */
export function Pricing() {
  const [currency, setCurrency] = useState("usd");
  const { user } = useAuth();
  const navigate = useNavigate();
  const price = (p) => (currency === "inr" ? `₹${p.inr}` : `$${p.usd}`);
  const rows = [
    ["Active projects", "Up to 10", "1 (60 days)"],
    ["Connected sources", "Unlimited", "Unlimited"],
    ["Living memory & history", "Included", "Included"],
    ["Change review & conflict detection", "Included", "Included"],
    ["Ask Bracket with citations", "Included", "Included"],
    ["Draft & send replies", "Included", "Included"],
    ["Notes, transcripts & files", "Included", "Included"],
    ["Project history after it ends", "Forever", "Read-only after 60 days"],
  ];
  return (
    <>
      <Seo title="Pricing" noindex={false} description="Simple, honest pricing. Monthly for ongoing work, or per project." />
      <Section eyebrow="Pricing" title="Simple, honest pricing." sub="Pay monthly for ongoing work, or once for a single project. Every plan starts with 14 days free.">
        <div className="mt-8 flex justify-center"><Segmented value={currency} onChange={setCurrency} options={[{ value: "usd", label: "$ USD" }, { value: "inr", label: "₹ INR" }]} /></div>
        <div className="mx-auto mt-10 grid max-w-[880px] gap-4 md:grid-cols-2">
          {Object.values(PLANS).map((p, i) => (
            <div key={p.id} className={cn("rounded-xl border p-6", i === 0 ? "border-line-strong bg-raised" : "border-line bg-surface")}>
              <div className="flex items-center justify-between">
                <p className="text-title-m">{p.name}</p>
                {i === 0 && <span className="rounded-sm border border-line px-1.5 py-0.5 text-caption text-fg-secondary">Most popular</span>}
              </div>
              <p className="mt-4"><span className="text-[44px] leading-none font-semibold tracking-[-1.5px] num">{price(p)}</span> <span className="text-body-m text-fg-tertiary">/ {p.per}</span></p>
              <p className="mt-2 text-body-m text-fg-tertiary">{p.blurb}</p>
              <Button variant={i === 0 ? "primary" : "secondary"} size="l" className="mt-6 w-full" onClick={() => navigate(user ? "/plan" : "/signup")}>Get started</Button>
              <ul className="mt-6 space-y-2.5 border-t border-line-subtle pt-6 text-body-m text-fg-secondary">
                {[p.limit, "Unlimited connected tools", "Living memory & change review", "Draft & send replies", "Ask Bracket with citations"].map((f) => <li key={f} className="flex items-center gap-2.5"><Check size={15} className="text-success" />{f}</li>)}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-6 text-center text-body-s text-fg-tertiary">Prices in ₹ include GST. USD prices shown exclude any local taxes. Cancel anytime — you keep access until the end of the period.</p>
      </Section>
      <Section className="border-t border-line-subtle" title="Compare plans">
        <div className="mx-auto mt-10 max-w-[880px] overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[520px] text-left">
            <thead><tr className="border-b border-line-subtle bg-surface"><th className="px-5 py-3 eyebrow font-semibold">Feature</th><th className="px-5 py-3 eyebrow font-semibold">Monthly</th><th className="px-5 py-3 eyebrow font-semibold">Per project</th></tr></thead>
            <tbody>
              {rows.map(([f, a, b]) => (
                <tr key={f} className="border-b border-line-subtle last:border-0">
                  <td className="px-5 py-3 text-body-m text-fg-secondary">{f}</td><td className="px-5 py-3 text-body-m">{a}</td><td className="px-5 py-3 text-body-m text-fg-secondary">{b}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      <Section className="border-t border-line-subtle" title="Questions">
        <div className="mx-auto mt-10 max-w-[760px]"><Faq /></div>
        <p className="mt-6 text-center text-body-s text-fg-tertiary">Still have questions? <a className="underline hover:text-fg" href="mailto:support@use-bracket.com">support@use-bracket.com</a></p>
      </Section>
    </>
  );
}

/* ───────────────────────── Legal (user-provided text) ───────────────────────── */
const PRIVACY = {
  title: "Privacy policy",
  short: ["Bracket reads only the sources, threads and channels you choose to connect.", "We never sell your data or use it to train general-purpose AI models.", "Deleted data is recoverable for 30 days, then removed from active systems."],
  sections: [
    ["Data retention and deletion", [
      "When you delete a workspace or your Bracket account, we will schedule the associated data for deletion. We may retain deleted data for up to 30 days to allow for recovery, security investigations, fraud prevention, dispute resolution, and compliance with legal obligations.",
      "After this period, the data will be deleted from our active systems. Residual copies may remain in encrypted backups for a limited period until those backups are automatically overwritten or expire.",
      "We may retain certain information for longer where required by law, necessary to enforce our agreements, prevent abuse, maintain financial or transaction records, or establish, exercise, or defend legal claims.",
    ]],
    ["AI and model training", [
      "Bracket processes information from the sources you choose to connect, including conversations, notes, files, and other business information, to provide features such as memory creation, information extraction, change detection, contextual answers, and suggested responses.",
      "We do not use your workspace content, connected-source content, files, conversations, notes, or Bracket Memory to train general-purpose AI models.",
      "Where Bracket uses third-party AI service providers to process information, we require those services to process the information for the purpose of providing Bracket’s functionality and subject to their applicable data-processing and security terms.",
    ]],
    ["Connected services", [
      "When you connect a third-party service such as Gmail, Slack, Figma, GitHub, or another supported integration, Bracket accesses only the information authorized through that connection and uses it to provide the features you request.",
      "You can disconnect an integration at any time. Disconnecting a service stops future synchronization from that service but does not automatically delete information that Bracket previously imported or derived from it.",
      "You can delete that information by deleting the relevant workspace or account, subject to the retention periods described above.",
    ]],
    ["Contact", ["Bracket Inc. · support@use-bracket.com"]],
  ],
};
const TERMS = {
  title: "Terms of service",
  short: ["You own your content; Bracket processes it only to run the service you use.", "AI-generated information can be wrong — review important details before relying on them.", "A failed payment starts a 7-day grace period. Nothing is deleted."],
  sections: [
    ["Subscription payments and failed payments", [
      "Paid subscriptions are billed according to the billing cycle and pricing displayed when you subscribe.",
      "If a payment fails, Bracket or its payment provider may automatically retry the payment. We may provide a grace period of up to 7 days following the failed payment.",
      "During the grace period, you may continue to access your account. If payment remains unsuccessful after the grace period, Bracket may pause synchronization with connected services and restrict access to paid functionality.",
      "We will not immediately delete your workspace solely because a subscription payment fails. Your information will remain subject to our data-retention and deletion policies.",
      "If payment is subsequently completed and your subscription is restored, synchronization and eligible paid functionality may resume.",
    ]],
    ["Your content", [
      "You retain ownership of the content and information you provide to Bracket or authorize Bracket to access.",
      "You grant Bracket a limited right to process, store, transmit, organize, analyze, and display that information only as reasonably necessary to operate, secure, maintain, and improve the Bracket service and provide the functionality you request.",
      "Using Bracket does not transfer ownership of your business information to Bracket.",
    ]],
    ["AI-generated information", [
      "Bracket uses automated and AI-based systems to extract, organize, summarize, interpret, and generate information.",
      "AI-generated information may occasionally be incomplete, inaccurate, or incorrectly interpreted. You are responsible for reviewing important information, suggested responses, detected changes, and actions before relying on them for significant business, financial, legal, or other decisions.",
      "Bracket should not be treated as a substitute for professional legal, financial, tax, medical, or other regulated professional advice.",
    ]],
    ["Account termination", [
      "You may stop using Bracket and delete your account in accordance with the controls provided by the service.",
      "We may suspend or terminate access where reasonably necessary because of violations of these Terms, unlawful activity, security risks, abuse of the service, or prolonged non-payment.",
      "Deletion of associated data will follow the retention practices described in our Privacy Policy.",
    ]],
  ],
};

function LegalPage({ doc }) {
  return (
    <div className="mx-auto grid max-w-[1100px] gap-10 px-4 py-16 md:grid-cols-[200px_1fr] md:px-8 md:py-20">
      <Seo title={doc.title} noindex={false} />
      <nav aria-label="Legal" className="text-body-m md:sticky md:top-24 md:self-start">
        <p className="eyebrow mb-3">Legal</p>
        {[["Privacy policy", "/privacy"], ["Terms of service", "/terms"], ["Security", "/security"]].map(([l, to]) => (
          <Link key={to} to={to} className={cn("block py-1.5", doc.title === l ? "text-fg" : "text-fg-tertiary hover:text-fg")}>{l}</Link>
        ))}
      </nav>
      <article className="min-w-0 max-w-[720px]">
        <h1 className="text-[32px] leading-[38px] font-semibold tracking-[-1px]">{doc.title}</h1>
        <p className="mt-2 text-body-s text-fg-tertiary">Last updated Oct 8, 2026</p>
        <div className="mt-8 rounded-xl border border-line bg-surface p-5">
          <p className="text-title-s">In short</p>
          <ul className="mt-3 space-y-2">{doc.short.map((s) => <li key={s} className="flex gap-2.5 text-body-m text-fg-secondary"><Check size={15} className="mt-0.5 shrink-0 text-success" />{s}</li>)}</ul>
        </div>
        {doc.sections.map(([h, ps], i) => (
          <section key={h} className="mt-10">
            <h2 className="text-title-l">{i + 1}. {h}</h2>
            <div className="mt-3 space-y-3">{ps.map((p) => <p key={p} className="text-body-l text-fg-secondary">{p}</p>)}</div>
          </section>
        ))}
      </article>
    </div>
  );
}
export const Privacy = () => <LegalPage doc={PRIVACY} />;
export const Terms = () => <LegalPage doc={TERMS} />;

/* ───────────────────────── Security ───────────────────────── */
export function Security() {
  const items = [
    [Eye, "Scoped access", "Bracket reads only the specific threads, channels, files and notes you select — never your whole inbox or workspace."],
    [ShieldCheck, "You approve every change", "Bracket proposes updates; nothing in memory changes and nothing is sent until you accept."],
    [Lock, "Encrypted", "Data is encrypted in transit and at rest. OAuth tokens are stored encrypted and refreshed automatically."],
    [ServerCog, "No model training", "Your business data is never used to train general-purpose AI models — ours or our providers’."],
    [Trash2, "Deletion you control", "Disconnect a source any time. Deleted workspaces are recoverable for 30 days, then removed from active systems; encrypted backups expire automatically."],
    [KeyRound, "Sign-in", "Google sign-in, one-time email codes, or a password. Sessions use secure, http-only cookies."],
  ];
  return (
    <>
      <Seo title="Security" noindex={false} />
      <Section eyebrow="Security" title="Your business data stays yours." sub="How Bracket protects the conversations you connect.">
        <div className="mx-auto mt-12 grid max-w-[980px] gap-4 md:grid-cols-2">
          {items.map(([I, t, d]) => (
            <div key={t} className="rounded-xl border border-line bg-surface p-6">
              <I size={18} className="text-fg-secondary" strokeWidth={1.75} />
              <p className="mt-4 text-title-m">{t}</p>
              <p className="mt-2 text-body-m text-fg-tertiary">{d}</p>
            </div>
          ))}
        </div>
        <p className="mt-10 text-center text-body-m text-fg-tertiary">Report a security issue: <a className="text-fg underline" href="mailto:support@use-bracket.com">support@use-bracket.com</a></p>
      </Section>
    </>
  );
}

/* ───────────────────────── 404 ───────────────────────── */
export function NotFound() {
  const navigate = useNavigate();
  return (
    <div className="mx-auto max-w-[600px] px-4 py-28">
      <Seo title="Page not found" />
      <EmptyState icon={SearchX} title="This page doesn’t exist" action={<><Button variant="primary" onClick={() => navigate("/")}>Go home</Button><Button variant="secondary" onClick={() => navigate("/app")}>Open Bracket</Button></>}>
        The link may be old, or the page may have moved.
      </EmptyState>
    </div>
  );
}
