import React, { useEffect } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { useResource, formatApiError } from "../../lib/data";
import { Badge, Banner, Button } from "../../ui/primitives";
import { Page } from "../../ui/motion";
import { admin } from "../api";
import { downloadCsv } from "../AdminApp";
import { Columns, HBars, Kpi, KpiRow, Panel, PanelSkeleton, Table, fmtMoney, fmtNum, shortDate, signed } from "../ui";

/* Admin › Revenue — Figma 208:433 */
export default function Revenue() {
  const { range, currency, setUpdatedAt, setExport } = useOutletContext();
  const { data, error, reload } = useResource(() => admin.revenue({ range, currency }), [range, currency]);
  useEffect(() => { if (data) setUpdatedAt(Date.now()); }, [data, setUpdatedAt]);
  useEffect(() => {
    if (!data) return;
    setExport(() => downloadCsv("bracket-mrr", [["month", `usd_customers_${currency}`, `inr_customers_${currency}`], ...data.months.map((m) => [m.month, m.usd, m.inr])]));
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error && !data) return <Banner tone="danger" title="Couldn’t load revenue" action={<Button size="s" onClick={reload}>Try again</Button>}>{formatApiError(error)}</Banner>;
  const k = data?.kpis;
  const mixMax = data ? Math.max(...data.mix.map((m) => m.count), 1) : 1;
  const money = (n, d) => fmtMoney(n, currency, d);

  return (
    <Page className="space-y-4">
      <KpiRow>
        <Kpi loading={!k} label={`MRR (all currencies, in ${currency.toUpperCase()})`} value={money(k?.mrr.value, 0)} delta={k && signed(k.mrr.net_new, (n) => money(n, 0))} good={(k?.mrr.net_new ?? 0) >= 0} compare={`net new, last ${range} days`} />
        <Kpi loading={!k} label="India (INR)" value={fmtMoney(k?.inr.value, "inr")} compare="monthly, GST included" />
        <Kpi loading={!k} label="Avg. revenue per customer" value={money(k?.arpa.value, 2)} compare="per month" />
        <Kpi loading={!k} label="Per-project purchases" value={fmtNum(k?.per_project.count)} compare={k && `${money(k.per_project.amount, 0)} one-time`} />
      </KpiRow>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        {!data ? <PanelSkeleton h={260} /> : (
          <Panel title="MRR by month" meta="Last 12 months">
            <Columns data={data.months.map((m) => ({ label: m.month, values: [m.usd, m.inr] }))} height={170} highlightLast labels={{ show: true, aria: "Monthly recurring revenue by month" }} format={(n) => money(n, 0)} />
            <div className="mt-3 flex gap-4 text-body-s text-fg-tertiary">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-white/35" />USD customers</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-info" />INR customers (converted)</span>
            </div>
          </Panel>
        )}
        {!data ? <PanelSkeleton h={260} /> : (
          <Panel title="Plan mix" meta="paying customers">
            <HBars strong items={data.mix.map((m) => ({ key: m.key, label: m.label, value: `${fmtNum(m.count)} · ${fmtMoney(m.amount, m.currency)}`, pct: (m.count / mixMax) * 100 }))} />
            <p className="mt-4 text-body-s text-fg-tertiary">Monthly customers stay {data.avg_tenure_months} months on average. Per-project counts are purchases in the last {range} days.</p>
          </Panel>
        )}
      </div>
      {!data ? <PanelSkeleton h={240} /> : (
        <Panel title="Failed payments" meta={<Badge tone={data.failed_payments.length ? "warning" : "success"} dot>{data.failed_payments.length ? `${data.failed_payments.length} in grace` : "None"}</Badge>}>
          <Table empty="No failed payments right now."
            columns={[
              { key: "name", label: "Customer", render: (r) => <Link to={`/admin/users/${r.user_id}`} className="hover:underline">{r.name}</Link> },
              { key: "amount", label: "Amount", className: "font-mono text-[12px]", render: (r) => fmtMoney(r.amount, r.currency) },
              { key: "attempt", label: "Attempt", className: "font-mono text-[12px] text-fg-secondary", render: (r) => `${r.attempt} of ${r.of}` },
              { key: "next", label: "Next retry", className: "font-mono text-[12px] text-fg-secondary", render: (r) => (r.next_retry_at ? shortDate(r.next_retry_at) : "—") },
              { key: "grace", label: "Grace ends", className: "font-mono text-[12px] text-fg-secondary", render: (r) => shortDate(r.grace_ends_at) },
              { key: "status", label: "Status", render: (r) => <Badge tone={r.attempt >= r.of ? "danger" : "warning"}>{r.attempt >= r.of ? "Final retry failed" : "Retrying"}</Badge> },
            ]}
            rows={data.failed_payments.map((r) => ({ ...r, id: r.user_id }))} />
          <p className="mt-3 text-body-s text-fg-tertiary">Payments are retried 3 times over 7 days, then the workspace gets a 7-day grace period before it turns read-only.</p>
        </Panel>
      )}
    </Page>
  );
}
