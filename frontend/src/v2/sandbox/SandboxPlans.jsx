import React, { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { ArrowRight, Check, RotateCcw } from "lucide-react";
import { cn } from "../../lib/utils";
import { Badge, Button } from "../ui/primitives";
import { Page, Stagger, StaggerItem } from "../ui/motion";
import { useIsMobile } from "../lib/useMedia";
import { Seo } from "../shell/Seo";
import { MobileSubHeader } from "../shell/AppShell";
import { CurrencyToggle, defaultCurrency } from "../pages/marketing/Pages";
import { useSandbox, SANDBOX_WID } from "./sandbox";

/* /w/:id/sandbox — tour step 5, "What you pay for".
   Figma › Sandbox · 7 Tour end (202:70418), mobile 203:2824. */
const ROWS = [
  ["Sources", "Sample Gmail, Slack and notes", "Your own Gmail, Slack, notes and files"],
  ["Updates", "When you press Play", "On their own, every few minutes"],
  ["Projects", "1 sample project", "Up to 10 on Monthly, or pay per project"],
  ["Replies", "Drafts only, never sent", "Drafts you approve, sent from your inbox"],
  ["Memory & history", "Resets when you leave", "Kept, with a full timeline and restore"],
  ["Team", "Just you", "Invite your team"],
];
const PLANS = [
  { id: "monthly", name: "Monthly", usd: 12, inr: 999, period: "/ month", desc: "For ongoing client work.", line: "Up to 10 active projects · everything you just tried", popular: true },
  { id: "project", name: "Per project", usd: 2, inr: 199, period: "/ project", desc: "For occasional, one-off projects.", line: "One project, active for 60 days" },
];

export default function SandboxPlans() {
  const sb = useSandbox();
  const navigate = useNavigate();
  const mobile = useIsMobile();
  const [currency, setCurrency] = useState(defaultCurrency);
  const { track } = sb;
  useEffect(() => { if (sb.active) track({ type: "tour_step", step: 5 }); }, [sb.active, track]);
  if (!sb.active) return <Navigate to=".." replace />;
  const price = (p) => (currency === "inr" ? `₹${p.inr}` : `$${p.usd}`);

  const plans = (
    <div className={cn("grid gap-3", mobile ? "grid-cols-2" : "")}>
      {PLANS.map((p) => (
        <StaggerItem key={p.id} className={cn("rounded-lg border p-4 md:p-5", p.popular ? "border-line-strong bg-raised" : "border-line-subtle bg-surface")}>
          <div className="flex items-center gap-2">
            <p className="text-title-m text-fg">{p.name}</p>
            {p.popular && !mobile && <Badge>Most popular</Badge>}
          </div>
          <p className="mt-1.5 flex items-baseline gap-1"><span className={cn("font-semibold text-fg", mobile ? "text-title-l" : "text-display-s")}>{price(p)}</span><span className="text-body-s text-fg-tertiary">{p.period}</span></p>
          {!mobile && <p className="mt-1 text-body-s text-fg-secondary">{p.desc}</p>}
          <p className={cn("mt-1 text-body-s", mobile ? "text-fg-secondary" : "font-medium text-fg")}>{p.line}</p>
        </StaggerItem>
      ))}
    </div>
  );
  const actions = (
    <>
      <Button variant="primary" icon={ArrowRight} className={mobile ? "h-11 w-full" : ""} onClick={() => sb.startTrial()}>Start 14-day free trial</Button>
      <Button variant="ghost" className={mobile ? "h-11 w-full" : ""} onClick={() => navigate(`/w/${SANDBOX_WID}`)}>Keep exploring</Button>
      {!mobile && <Button variant="ghost" icon={RotateCcw} onClick={sb.startTour}>Replay the tour</Button>}
    </>
  );

  if (mobile) {
    return (
      <div className="flex h-full flex-col">
        <Seo title="What you pay for" />
        <MobileSubHeader title="What you pay for" onBack={() => navigate(`/w/${SANDBOX_WID}`)} />
        <Page className="scroll-pane flex-1 px-4 pb-6 pt-4">
          <p className="eyebrow">Step 5 of 5</p>
          <h1 className="mt-2 text-title-l text-fg">Everything you just tried, on your own client work.</h1>
          <Stagger className="mt-4 overflow-hidden rounded-lg border border-line-subtle bg-surface">
            {ROWS.slice(0, 5).map(([k, s, w]) => (
              <StaggerItem key={k} className="border-b border-line-subtle px-3.5 py-2.5 last:border-b-0">
                <p className="text-body-s font-medium text-fg-tertiary">{k}</p>
                <p className="mt-0.5 flex gap-2 text-body-m text-fg"><Check size={16} className="mt-0.5 shrink-0 text-success" />{w}</p>
                <p className="text-body-s text-fg-tertiary">Sandbox: {s}</p>
              </StaggerItem>
            ))}
          </Stagger>
          <div className="mt-4 flex items-center justify-between"><p className="text-title-s text-fg">Plans</p><CurrencyToggle value={currency} onChange={setCurrency} /></div>
          <Stagger className="mt-3">{plans}</Stagger>
          <p className="mt-3 text-body-s text-fg-tertiary">{currency === "inr" ? "Prices include GST." : "Prices in USD."} No card needed for the 14-day trial.</p>
        </Page>
        <div className="flex flex-col gap-2 border-t border-line-subtle bg-app px-4 pb-4 pt-3 safe-bottom">{actions}</div>
      </div>
    );
  }

  return (
    <Page className="scroll-pane h-full px-8 pb-10 pt-8 xl:px-12">
      <Seo title="What you pay for" />
      <p className="eyebrow">Step 5 of 5 · That’s Bracket</p>
      <h1 className="mt-2 text-display-s text-fg">Here’s what you’d be paying for</h1>
      <p className="mt-2 text-body-l text-fg-secondary">Everything you just tried, running on your own client work instead of sample data.</p>
      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Stagger as="table" className="w-full overflow-hidden rounded-lg border border-line-subtle bg-surface text-left">
          <thead>
            <tr className="bg-raised">
              <th className="w-[170px] px-4 py-2.5"><span className="sr-only">What</span></th>
              <th className="eyebrow px-4 py-2.5">Sandbox</th>
              <th className="eyebrow px-4 py-2.5">Your workspace</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map(([k, s, w]) => (
              <StaggerItem as="tr" key={k} className="border-t border-line-subtle">
                <th scope="row" className="px-4 py-3 text-body-m font-medium text-fg">{k}</th>
                <td className="px-4 py-3 text-body-m text-fg-tertiary">{s}</td>
                <td className="px-4 py-3 text-body-m text-fg"><span className="flex gap-2"><Check size={16} className="mt-0.5 shrink-0 text-success" />{w}</span></td>
              </StaggerItem>
            ))}
          </tbody>
        </Stagger>
        <div>
          <Stagger delay={0.12}>{plans}</Stagger>
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-body-s text-fg-tertiary">{currency === "inr" ? "Prices include GST." : "Prices in USD."}</p>
            <CurrencyToggle value={currency} onChange={setCurrency} />
          </div>
        </div>
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        {actions}
        <p className="text-body-s text-fg-tertiary">No card needed for the trial. Your data is never used to train AI models.</p>
      </div>
    </Page>
  );
}
