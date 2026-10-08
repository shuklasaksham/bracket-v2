import React, { useEffect } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { useResource } from "../../lib/data";
import { Avatar, Banner, Button } from "../../ui/primitives";
import { Page, Stagger, StaggerItem } from "../../ui/motion";
import { admin } from "../api";
import { downloadCsv } from "../AdminApp";
import { Columns, HBars, Kpi, KpiRow, Panel, PanelSkeleton, ago, fmtMoney, fmtNum, signed } from "../ui";

/* Admin › Overview — Figma 205:58 */
export default function Overview() {
  const { range, currency, setUpdatedAt, setExport } = useOutletContext();
  const { data, error, loading, reload } = useResource(() => admin.overview({ range, currency }), [range, currency]);
  useEffect(() => { if (data) setUpdatedAt(Date.parse(data.updated_at)); }, [data, setUpdatedAt]);
  useEffect(() => {
    if (!data) return;
    setExport(() => downloadCsv("bracket-signups", [["date", "signups"], ...data.signups_series.map((d) => [d.date, d.signups])]));
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error && !data) return <Banner tone="danger" title="Couldn’t load the overview" action={<Button size="s" onClick={reload}>Try again</Button>}>Check the API is reachable, then try again.</Banner>;
  const k = data?.kpis;
  const top = data ? Math.max(...data.funnel.map((f) => f.value), 1) : 1;
  const srcMax = data ? Math.max(...data.sources.map((s) => s.count), 1) : 1;
  const per = range <= 1 ? "previous day" : `previous ${range} days`;

  return (
    <Page className="space-y-4">
      <KpiRow>
        <Kpi loading={!k} label="New signups" value={fmtNum(k?.signups.value)} delta={k?.signups.delta_pct != null ? `${signed(k.signups.delta_pct)}%` : null} good={(k?.signups.delta_pct ?? 0) >= 0} compare={`vs ${per}`} />
        <Kpi loading={!k} label="Active users" value={fmtNum(k?.active_users.wau)} unit="WAU" compare={k && `DAU ${fmtNum(k.active_users.dau)} · MAU ${fmtNum(k.active_users.mau)}`} />
        <Kpi loading={!k} label="MRR" value={fmtMoney(k?.mrr.value, currency, 0)} delta={k && signed(k.mrr.new, (n) => fmtMoney(n, currency, 0))} compare={k && (currency === "usd" ? `incl. ${fmtMoney(k.mrr.inr_value, "inr")} from India` : "new this period")} />
        <Kpi loading={!k} label="Trial → paid" value={k ? `${k.trial_to_paid.pct}%` : ""} compare={k && `${fmtNum(k.trial_to_paid.converted)} of ${fmtNum(k.trial_to_paid.trials)} trials`} />
        <Kpi loading={!k} label="Paying customers" value={fmtNum(k?.paying.value)} compare={k && `Monthly ${fmtNum(k.paying.monthly)} · Per project ${fmtNum(k.paying.project)}`} />
        <Kpi loading={!k} label="Churn" value={k ? `${k.churn.pct}%` : ""} unit="monthly" delta={k && `${k.churn.canceled} canceled`} good={false} compare="in the last 30 days" />
        <Kpi loading={!k} label="Active workspaces" value={fmtNum(k?.workspaces.active)} compare={k && `of ${fmtNum(k.workspaces.created)} created`} />
        <Kpi loading={!k} label="Failed payments" value={fmtNum(k?.failed_payments.value)} unit="in grace" delta={k && `${fmtMoney(k.failed_payments.at_risk, currency, 0)} at risk`} good={!k?.failed_payments.value} />
      </KpiRow>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        {!data ? <PanelSkeleton h={240} /> : (
          <Panel title="Signups per day" meta={`${data.signups_series.length} days · today highlighted`}>
            <Columns data={data.signups_series.map((d) => ({ label: d.date.slice(5), values: [d.signups] }))} height={160} highlightLast labels={{ aria: "Signups per day" }} />
            <div className="mt-2 flex justify-between font-mono text-[12px] text-fg-tertiary">
              <span>{data.signups_series[0]?.date}</span><span>{data.signups_series[data.signups_series.length - 1]?.date}</span>
            </div>
          </Panel>
        )}
        {!data ? <PanelSkeleton h={240} /> : (
          <Panel title="Conversion funnel" meta={`${range} days`}>
            <HBars strong items={data.funnel.map((f) => ({ key: f.key, label: f.label, value: `${fmtNum(f.value)}  ·  ${Math.round((f.value / top) * 1000) / 10}%`, pct: (f.value / top) * 100 }))} />
          </Panel>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {!data ? <PanelSkeleton /> : (
          <Panel title="Connected sources" meta="by provider">
            <HBars items={data.sources.map((s) => ({ key: s.provider, provider: s.provider, label: s.provider[0].toUpperCase() + s.provider.slice(1), value: fmtNum(s.count), pct: (s.count / srcMax) * 100 }))} />
          </Panel>
        )}
        {!data ? <PanelSkeleton /> : (
          <Panel title="Product health" meta="last 30 days">
            <dl className="space-y-3">
              {[
                ["Sync failures", `${fmtNum(data.health.sync_failures)} workspaces`, data.health.sync_failures ? "text-danger" : "text-success", "/admin/usage"],
                ["Review acceptance", `${data.health.review_acceptance_pct}% accepted`, "text-success"],
                ["Ask Bracket", `${fmtNum(data.health.asks_per_day)} questions / day`, "text-fg"],
                ["High-confidence answers", `${data.health.high_confidence_pct}%`, "text-success"],
                ["Replies sent", `${fmtNum(data.health.replies_per_day)} / day`, "text-fg"],
              ].map(([l, v, c, to]) => (
                <div key={l} className="flex items-center gap-2 text-body-m">
                  <dt className="flex-1 text-fg-secondary">{l}</dt>
                  <dd className={`font-medium ${c}`}>{to ? <Link to={to} className="hover:underline">{v}</Link> : v}</dd>
                </div>
              ))}
            </dl>
          </Panel>
        )}
        {!data ? <PanelSkeleton /> : (
          <Panel title="Latest signups" meta={<Link to="/admin/users?sort=signed_up" className="inline-flex items-center gap-1 hover:text-fg">View all <ArrowRight size={12} /></Link>}>
            <Stagger as="ul" className="space-y-1">
              {data.latest.map((u) => (
                <StaggerItem as="li" key={u.id}>
                  <Link to={`/admin/users/${u.id}`} className="-mx-2 flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-hover">
                    <Avatar name={u.name} size="s" />
                    <span className="min-w-0 flex-1"><span className="block truncate text-body-m text-fg">{u.name}</span><span className="block truncate text-body-s text-fg-tertiary">{u.email}{u.from_sandbox ? " · from sandbox" : ""}</span></span>
                    <span className="font-mono text-[12px] text-fg-tertiary">{ago(u.created_at)}</span>
                  </Link>
                </StaggerItem>
              ))}
            </Stagger>
          </Panel>
        )}
      </div>
      {loading && data && <span className="sr-only" role="status">Updating</span>}
    </Page>
  );
}
