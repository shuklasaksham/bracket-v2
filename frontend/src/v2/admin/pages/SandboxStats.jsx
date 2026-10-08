import React, { useEffect } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import { useResource, formatApiError } from "../../lib/data";
import { Banner, Button } from "../../ui/primitives";
import { Page } from "../../ui/motion";
import { admin } from "../api";
import { HBars, Kpi, KpiRow, Panel, PanelSkeleton, Table, fmtNum, signed } from "../ui";

/* Admin › Sandbox — Figma 208:1053. How people use the no-sign-up sandbox
   and where they drop out of the 5-step tour. */
export default function SandboxStats() {
  const { range, setUpdatedAt } = useOutletContext();
  const { data, error, reload } = useResource(() => admin.sandbox({ range }), [range]);
  useEffect(() => { if (data) setUpdatedAt(Date.now()); }, [data, setUpdatedAt]);
  if (error && !data) return <Banner tone="danger" title="Couldn’t load sandbox stats" action={<Button size="s" onClick={reload}>Try again</Button>}>{formatApiError(error)}</Banner>;
  const k = data?.kpis;
  const first = data?.steps[0]?.count || 1;
  const lockMax = data ? Math.max(...data.locked.map((l) => l.count), 1) : 1;
  const mins = k ? `${Math.floor(k.median_time_s / 60)}m ${String(k.median_time_s % 60).padStart(2, "0")}s` : "";

  return (
    <Page className="space-y-4">
      <KpiRow>
        <Kpi loading={!k} label="Sandbox sessions" value={fmtNum(k?.sessions.value)} delta={k?.sessions.delta_pct != null ? `${signed(k.sessions.delta_pct)}%` : null} good={(k?.sessions.delta_pct ?? 0) >= 0} compare={`vs previous ${range} days`} />
        <Kpi loading={!k} label="Finished the tour" value={k ? `${k.finished_tour.pct}%` : ""} compare={k && `${fmtNum(k.finished_tour.count)} sessions`} />
        <Kpi loading={!k} label="Sandbox → sign-up" value={k ? `${k.to_signup.pct}%` : ""} compare={k && `${fmtNum(k.to_signup.count)} sign-ups`} />
        <Kpi loading={!k} label="Median time in sandbox" value={mins} compare="per session" />
      </KpiRow>
      <div className="grid gap-4 lg:grid-cols-2">
        {!data ? <PanelSkeleton /> : (
          <Panel title="Where people stop" meta="tour step reached">
            <HBars strong items={data.steps.map((s) => ({ key: s.step, label: `${s.step} · ${s.label}`, value: `${fmtNum(s.count)} · ${Math.round((s.count / first) * 100)}%`, pct: (s.count / first) * 100 }))} />
          </Panel>
        )}
        {!data ? <PanelSkeleton /> : (
          <Panel title="Locked actions tapped" meta="each opens the trial prompt">
            <HBars items={data.locked.map((l) => ({ key: l.action, label: l.label, value: fmtNum(l.count), pct: (l.count / lockMax) * 100 }))} />
          </Panel>
        )}
      </div>
      {!data ? <PanelSkeleton h={220} /> : (
        <Panel title="Most-used sandbox actions" meta={data.live?.sessions ? `${data.live.sessions} live session${data.live.sessions === 1 ? "" : "s"} included` : "per session"}>
          <Table columns={[
            { key: "label", label: "Action" },
            { key: "per_session", label: "Avg per session", className: "font-mono text-[12px]" },
            { key: "pct", label: "Sessions using it", className: "font-mono text-[12px] text-fg-secondary", render: (r) => `${r.pct}%` },
          ]} rows={data.actions.map((a) => ({ ...a, id: a.key }))} />
        </Panel>
      )}
      <p className="text-body-s text-fg-tertiary">
        <Link to="/sandbox" target="_blank" className="inline-flex items-center gap-1 hover:text-fg">Open the sandbox <ExternalLink size={12} /></Link> in a new tab to see what visitors see.
      </p>
    </Page>
  );
}
