import React, { useEffect } from "react";
import { useOutletContext } from "react-router-dom";
import { useResource, formatApiError } from "../../lib/data";
import { Badge, Banner, Button, SourceMark } from "../../ui/primitives";
import { Page } from "../../ui/motion";
import { admin } from "../api";
import { HBars, Kpi, KpiRow, Panel, PanelSkeleton, Table, ago, fmtNum } from "../ui";

/* Admin › Usage & health — Figma 208:764 */
const cap = (s) => s[0].toUpperCase() + s.slice(1);

export default function Usage() {
  const { range, setUpdatedAt } = useOutletContext();
  const { data, error, reload } = useResource(() => admin.usage({ range }), [range]);
  useEffect(() => { if (data) setUpdatedAt(Date.now()); }, [data, setUpdatedAt]);
  if (error && !data) return <Banner tone="danger" title="Couldn’t load usage" action={<Button size="s" onClick={reload}>Try again</Button>}>{formatApiError(error)}</Banner>;
  const k = data?.kpis;
  const srcMax = data ? Math.max(...data.sources.map((s) => s.count), 1) : 1;

  return (
    <Page className="space-y-4">
      <KpiRow>
        <Kpi loading={!k} label="Review acceptance" value={k ? `${k.review_acceptance.pct}%` : ""} compare={k && `${fmtNum(k.review_acceptance.reviewed)} changes reviewed`} />
        <Kpi loading={!k} label="Ask Bracket" value={fmtNum(k?.asks.per_day)} unit="per day" compare={k && `${k.asks.high_confidence_pct}% high-confidence answers`} />
        <Kpi loading={!k} label="Replies sent" value={fmtNum(k?.replies.per_day)} unit="per day" compare="from drafts users approved" />
        <Kpi loading={!k} label="Sync failures" value={fmtNum(k?.sync_failures.value)} unit="workspaces" delta={k?.sync_failures.value ? "needs attention" : "all healthy"} good={!k?.sync_failures.value} />
      </KpiRow>
      <div className="grid gap-4 lg:grid-cols-2">
        {!data ? <PanelSkeleton /> : (
          <Panel title="Connected sources" meta="by provider">
            <HBars items={data.sources.map((s) => ({ key: s.provider, provider: s.provider, label: cap(s.provider), value: `${fmtNum(s.count)} · ${s.pct}% of workspaces`, pct: (s.count / srcMax) * 100 }))} />
          </Panel>
        )}
        {!data ? <PanelSkeleton /> : (
          <Panel title="Feature use" meta="share of weekly active users">
            <HBars strong items={data.features.map((f) => ({ key: f.key, label: f.label, value: `${f.pct}%`, pct: f.pct }))} />
          </Panel>
        )}
      </div>
      {!data ? <PanelSkeleton h={220} /> : (
        <Panel title="Sync failures" meta={<Badge tone={data.sync_failures.length ? "danger" : "success"} dot>{data.sync_failures.length ? `${data.sync_failures.reduce((a, r) => a + r.workspaces, 0)} open` : "None"}</Badge>}>
          <Table empty="Every source is syncing."
            columns={[
              { key: "provider", label: "Source", render: (r) => <span className="flex items-center gap-2"><SourceMark provider={r.provider} />{cap(r.provider)}</span> },
              { key: "error", label: "Error", className: "text-fg-secondary" },
              { key: "workspaces", label: "Workspaces", className: "font-mono text-[12px]" },
              { key: "since", label: "Since", className: "font-mono text-[12px] text-fg-secondary", render: (r) => ago(r.since) },
            ]}
            rows={data.sync_failures.map((r) => ({ ...r, id: r.provider + r.error }))} />
          <p className="mt-3 text-body-s text-fg-tertiary">Users with a failed source see a reconnect banner in their workspace. We email them after 24 hours.</p>
        </Panel>
      )}
    </Page>
  );
}
