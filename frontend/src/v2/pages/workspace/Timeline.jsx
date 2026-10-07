import React, { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Search, X, History, ArrowRight, Download } from "lucide-react";
import { useWorkspace } from "../../lib/workspace";
import { catSingular, clock, dayKey, longDate } from "../../lib/data";
import { Badge, Button, Card, EmptyState, EvidenceChip, IconButton, Input, Segmented, Skeleton, providerLabel } from "../../ui/primitives";
import { SidePanel } from "../../ui/overlays";
import { HistoryIcon } from "./Overview";
import { useMedia } from "../../lib/useMedia";
import { cn } from "../../../lib/utils";

/* Timeline — every change Bracket saw or made, newest first.
   GET /projects/:id/history (source events + memory item history). */
const FILTERS = [
  { value: "all", label: "All events" },
  { value: "changes", label: "Changes" },
  { value: "sources", label: "Sources" },
  { value: "edits", label: "Your edits" },
];
const KIND_GROUP = {
  CHANGE_ACCEPTED: "changes", STATUS_CHANGE: "changes", CREATED: "changes", REMOVED: "edits", EDITED: "edits",
  SOURCE_CONNECTED: "sources", SOURCE_DISCONNECTED: "sources", SOURCE_UPDATED: "sources", SOURCE_EVENT: "sources",
};
const KIND_LABEL = {
  CHANGE_ACCEPTED: "Change accepted", STATUS_CHANGE: "Status change", CREATED: "Added", REMOVED: "Removed", EDITED: "Edited",
  SOURCE_CONNECTED: "Source connected", SOURCE_DISCONNECTED: "Source disconnected", SOURCE_UPDATED: "Source updated",
};

export default function Timeline() {
  const { history, projectId, project } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const wide = useMedia("(min-width: 1280px)");
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const selId = params.get("e");

  const list = useMemo(() => {
    let l = history || [];
    if (filter !== "all") l = l.filter((e) => (KIND_GROUP[e.kind] || "changes") === filter);
    if (q.trim()) { const s = q.toLowerCase(); l = l.filter((e) => `${e.title} ${e.detail} ${e.source_label}`.toLowerCase().includes(s)); }
    return l;
  }, [history, filter, q]);
  const groups = useMemo(() => {
    const g = [];
    for (const e of list) {
      const k = dayKey(e.at);
      if (!g.length || g[g.length - 1].k !== k) g.push({ k, items: [] });
      g[g.length - 1].items.push(e);
    }
    return g;
  }, [list]);
  const sel = (history || []).find((e) => e.id === selId) || null;
  const select = (id) => { const n = new URLSearchParams(params); id ? n.set("e", id) : n.delete("e"); setParams(n, { replace: true }); };

  const exportCsv = () => {
    const rows = [["When", "Event", "Title", "Detail", "Source", "Category"], ...(history || []).map((e) => [e.at, KIND_LABEL[e.kind] || e.kind, e.title, e.detail, e.source_label, e.category || ""])];
    const csv = rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `${(project?.name || "bracket").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-timeline.csv`;
    a.click();
  };

  if (!history) return <div className="p-8 space-y-3" aria-busy="true"><Skeleton className="h-8 w-60" /><Skeleton className="h-12" /><Skeleton className="h-12" /><Skeleton className="h-12" /></div>;

  const detail = sel && <EventDetail e={sel} onOpenMemory={(id) => navigate(`/w/${projectId}/memory?item=${id}`)} />;

  return (
    <div className="flex h-full min-h-0">
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="border-b border-line-subtle px-4 py-4 md:px-8">
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <h1 className="text-title-l">Timeline</h1>
              <p className="mt-0.5 text-body-s text-fg-tertiary">Everything Bracket saw, and every change it made — with the reason.</p>
            </div>
            <Button size="s" variant="secondary" icon={Download} onClick={exportCsv} className="hidden sm:inline-flex">Export</Button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="-mx-1 overflow-x-auto px-1"><Segmented size="s" value={filter} onChange={setFilter} options={FILTERS} /></div>
            <div className="relative ml-auto w-full sm:w-64">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-tertiary" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter events" className="h-8 pl-8" aria-label="Filter events" />
            </div>
          </div>
        </div>
        <div className="scroll-pane flex-1 px-4 py-4 md:px-8">
          {groups.length === 0 ? (
            <EmptyState icon={History} title={q || filter !== "all" ? "No matching events" : "Nothing yet"}>
              Events appear here as Bracket reads your sources and you accept changes.
            </EmptyState>
          ) : groups.map((g) => (
            <div key={g.k} className="mb-6">
              <p className="eyebrow mb-2">{g.k}</p>
              <Card className="overflow-hidden">
                {g.items.map((e) => (
                  <button key={e.id} onClick={() => select(e.id)} className={cn("flex w-full items-start gap-3 border-b border-line-subtle px-4 py-3 text-left last:border-0 hover:bg-hover", selId === e.id && "bg-selected")}>
                    <span className="w-11 shrink-0 pt-0.5 font-mono text-mono-s text-fg-tertiary">{clock(e.at)}</span>
                    <HistoryIcon kind={e.kind} provider={e.provider} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-body-m text-fg">{e.title}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-2">
                        {e.source_label && <EvidenceChip provider={e.provider}>{e.source_label}</EvidenceChip>}
                        {e.detail && <span className="truncate text-body-s text-fg-tertiary">{e.detail}</span>}
                      </span>
                    </span>
                  </button>
                ))}
              </Card>
            </div>
          ))}
        </div>
      </section>
      {wide ? (
        sel && (
          <aside className="w-[400px] shrink-0 border-l border-line-subtle">
            <div className="flex h-12 items-center justify-between border-b border-line-subtle px-5">
              <p className="eyebrow">{KIND_LABEL[sel.kind] || "Event"}</p>
              <IconButton icon={X} label="Close" onClick={() => select(null)} />
            </div>
            <div className="scroll-pane px-5 py-5">{detail}</div>
          </aside>
        )
      ) : (
        <SidePanel open={!!sel} onOpenChange={(o) => !o && select(null)} title={sel ? KIND_LABEL[sel.kind] || "Event" : "Event"}>{detail}</SidePanel>
      )}
    </div>
  );
}

function EventDetail({ e, onOpenMemory }) {
  return (
    <div>
      <h2 className="text-title-l text-fg">{e.title}</h2>
      <dl className="mt-5 space-y-3">
        <Row label="When">{longDate(e.at)} · {clock(e.at)}</Row>
        {e.category && <Row label="Category">{catSingular(e.category)}</Row>}
        {e.source_label && <Row label="Source"><EvidenceChip provider={e.provider}>{e.source_label || providerLabel(e.provider)}</EvidenceChip></Row>}
      </dl>
      {e.detail && (
        <div className="mt-6">
          <p className="eyebrow mb-2">What changed</p>
          <p className="rounded-lg border border-line bg-surface p-3 text-body-m text-fg-secondary whitespace-pre-wrap">{e.detail}</p>
        </div>
      )}
      {e.memory_id && (
        <Button className="mt-6" variant="secondary" iconRight={ArrowRight} onClick={() => onOpenMemory(e.memory_id)}>Open in memory</Button>
      )}
    </div>
  );
}
function Row({ label, children }) {
  return (
    <div className="flex items-center gap-4">
      <dt className="w-24 shrink-0 text-body-s text-fg-tertiary">{label}</dt>
      <dd className="min-w-0 text-body-m text-fg">{children}</dd>
    </div>
  );
}
