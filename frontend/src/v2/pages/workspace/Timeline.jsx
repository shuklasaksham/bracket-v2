import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Search, ChevronDown, X, ExternalLink, History, Settings2, Download, FileText, ListFilter, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { format, isToday, isYesterday } from "date-fns";
import { useWorkspace, refreshAll } from "../../lib/workspace";
import { v2 } from "../../lib/api2";
import { useResource } from "../../lib/data";
import { useIsMobile, useMedia } from "../../lib/useMedia";
import { Button, IconButton, Skeleton, Toggle } from "../../ui/primitives";
import { Dialog, Menu, MenuContent, MenuItem, MenuTrigger, Sheet } from "../../ui/overlays";
import { Chip } from "../../ui/patterns";
import { AnimatePresence, Stagger, StaggerItem, motion, t as T, useDelayed } from "../../ui/motion";
import { MobileSubHeader } from "../../shell/AppShell";
import { cn } from "../../../lib/utils";

/* Timeline — Figma › ✓ Timeline — Desktop 1440, Filter menu open, Sync event
   detail, Export audit log, Restore previous version (confirm), Version
   restored; Timeline / Timeline event / Restore — Mobile 390. */

const TYPES = [["all", "All events"], ["changes", "Changes detected"], ["memory", "Memory updates"], ["messages", "Messages read"], ["notes", "Notes & files"], ["sources", "Sources & syncs"]];
const SOURCES = [["all", "All sources"], ["gmail", "Gmail"], ["slack", "Slack"], ["notes", "Notes"]];
const RANGES = [["7d", "Last 7 days"], ["30d", "Last 30 days"], ["90d", "Last 90 days"], ["all", "All time"]];
const DOT = { warning: "bg-warning", success: "bg-success", info: "bg-info" };
const dayLabel = (iso) => {
  const d = new Date(iso);
  if (isToday(d)) return `Today · ${format(d, "EEE MMM d")}`;
  if (isYesterday(d)) return `Yesterday · ${format(d, "EEE MMM d")}`;
  return format(d, "EEE MMM d");
};

export default function Timeline() {
  const { eid } = useParams();
  const { projectId, canEdit } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const mobile = useIsMobile();
  const docked = useMedia("(min-width: 1280px)");
  const navigate = useNavigate();
  const base = `/w/${projectId}`;
  const type = params.get("type") || "all";
  const source = params.get("source") || "all";
  const range = params.get("range") || "30d";
  const memOnly = params.get("memory") === "1";
  const [q, setQ] = useState(params.get("q") || "");
  const [exportOpen, setExportOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const qp = { type, source, range: range === "all" ? undefined : range, memory_only: memOnly ? "1" : undefined, q: params.get("q") || undefined };
  const list = useResource(() => v2.timeline(projectId, qp), [projectId, type, source, range, memOnly, params.get("q")]);
  useEffect(() => {
    const id = setTimeout(() => { const n = new URLSearchParams(params); if (q) n.set("q", q); else n.delete("q"); if ((params.get("q") || "") !== q) setParams(n, { replace: true }); }, 250);
    return () => clearTimeout(id);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const on = () => list.reload();
    window.addEventListener("bk:refresh", on);
    return () => window.removeEventListener("bk:refresh", on);
  }, [list]);

  const set = (k, v, def) => { const n = new URLSearchParams(params); if (v === def || !v) n.delete(k); else n.set(k, v); setParams(n); };
  const open = (id) => navigate(`${base}/timeline/${id}${window.location.search}`);
  const close = () => navigate(`${base}/timeline${window.location.search}`);
  const groups = useMemo(() => {
    const g = [];
    (list.data?.events || []).forEach((e) => {
      const k = dayLabel(e.at);
      const last = g[g.length - 1];
      if (last && last.k === k) last.items.push(e); else g.push({ k, items: [e] });
    });
    return g;
  }, [list.data]);
  const counts = list.data?.counts || {};

  if (mobile && eid) return <EventDetail wid={projectId} eid={eid} base={base} onClose={close} canEdit={canEdit} mobile />;

  return (
    <div className="flex h-full">
      <div className="scroll-pane min-w-0 flex-1">
        <div className="px-4 pt-4 pb-12 md:px-8 md:pt-6">
          {mobile ? (
            <div className="flex h-11 items-center">
              <h1 className="flex-1 text-title-m text-fg">Timeline</h1>
              <span className="relative">
                <IconButton icon={ListFilter} label="Filter timeline" size="l" onClick={() => setFiltersOpen(true)} />
                {(type !== "all" || source !== "all" || range !== "30d" || memOnly || q) && <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-info" />}
              </span>
            </div>
          ) : (<>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-title-l text-fg">Timeline</h1>
              <p className="mt-1 text-[12px] text-fg-tertiary">Everything Bracket saw and did in this workspace — what happened, where it came from, and what it changed.</p>
            </div>
            {!mobile && <Button icon={Download} onClick={() => setExportOpen(true)}>Export</Button>}
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <label className="flex h-8 w-full items-center gap-2 rounded-md border border-line px-3 sm:w-[180px]">
              <Search size={16} className="text-fg-tertiary" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search history" aria-label="Search history" className="min-w-0 flex-1 bg-transparent text-[12px] text-fg placeholder:text-fg-tertiary outline-none" />
            </label>
            <FilterMenu value={type} options={TYPES} counts={counts} onChange={(v) => set("type", v, "all")} />
            <FilterMenu value={source} options={SOURCES} onChange={(v) => set("source", v, "all")} />
            <FilterMenu value={range} options={RANGES} onChange={(v) => set("range", v, "30d")} />
            <span className="flex-1" />
            <span className="flex items-center gap-2"><Toggle checked={memOnly} onChange={(v) => set("memory", v ? "1" : null)} label="Memory changes only" /><span className="text-[12px] text-fg-secondary" aria-hidden="true">Memory changes only</span></span>
          </div>
          </>)}

          <div className="mt-6">
            {!list.data ? <TimelineSkel /> : groups.length === 0 ? (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-lg border border-line px-4 py-6 text-center">
                <p className="text-body-m text-fg">No events match these filters</p>
                <button onClick={() => { setQ(""); setParams({}); }} className="mt-2 text-[12px] font-medium text-fg-secondary hover:text-fg">Clear filters</button>
              </motion.div>
            ) : (
              <div className="space-y-6">
                {groups.map((g) => (
                  <section key={g.k}>
                    <p className="eyebrow mb-3">{g.k}</p>
                    {mobile ? (
                      <Stagger as="ol">
                        {g.items.map((e) => (
                          <StaggerItem as="li" key={e.id}>
                            <button onClick={() => open(e.id)} className="flex w-full items-start gap-3 py-2.5 text-left active:bg-hover">
                              <span className="w-[44px] shrink-0 pt-px font-mono text-[12px] text-fg-tertiary">{format(new Date(e.at), "HH:mm")}</span>
                              <span className={cn("mt-[5px] h-[7px] w-[7px] shrink-0 rounded-full", e.dot ? DOT[e.dot] : "bg-white/20")} aria-hidden="true" />
                              <span className="min-w-0 flex-1">
                                <span className="block text-body-s text-fg">{e.title}</span>
                                <span className="block text-body-s text-fg-tertiary">{[e.actor && ["gmail", "slack"].includes(e.actor.provider) && !e.actor.label.startsWith("#") ? (e.actor.provider === "gmail" ? "Gmail" : "Slack") : null, e.actor && !["manual", "bracket"].includes(e.actor.provider) ? e.actor.label : null, e.meta].filter(Boolean).join(" · ")}</span>
                              </span>
                            </button>
                          </StaggerItem>
                        ))}
                      </Stagger>
                    ) : (
                    <Stagger as="ol" className="space-y-1">
                      {g.items.map((e) => (
                        <StaggerItem as="li" key={e.id}>
                          <button onClick={() => open(e.id)} aria-current={eid === e.id ? "true" : undefined}
                            className={cn("flex w-full items-start gap-3 rounded-lg border px-3 py-3 text-left transition-colors duration-fast", eid === e.id ? "border-line-strong bg-surface" : "border-transparent hover:bg-hover")}>
                            <span className="w-[44px] shrink-0 pt-px font-mono text-[12px] text-fg-tertiary">{format(new Date(e.at), "HH:mm")}</span>
                            <span className={cn("mt-[5px] h-[7px] w-[7px] shrink-0 rounded-full", e.dot ? DOT[e.dot] : "border border-white/25")} aria-hidden="true" />
                            <span className="min-w-0 flex-1">
                              <span className="block text-[12px] text-fg">{e.title}</span>
                              <span className="mt-2 flex flex-wrap items-center gap-2">
                                {e.actor && <Chip provider={e.actor.provider === "manual" ? "notes" : e.actor.provider} label={e.actor.label} />}
                                <span className="text-[12px] text-fg-tertiary">{e.meta}</span>
                              </span>
                            </span>
                          </button>
                        </StaggerItem>
                      ))}
                    </Stagger>
                    )}
                  </section>
                ))}
                {list.data.has_more && <Button variant="ghost" className="w-full" onClick={() => set("range", "90d", "30d")}>Load older events</Button>}
              </div>
            )}
          </div>
        </div>
      </div>
      <AnimatePresence initial={false}>
        {eid && !mobile && (
          <motion.aside key="ev" initial={{ x: 32, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 32, opacity: 0 }} transition={T.base}
            className={cn("flex h-full w-[400px] shrink-0 flex-col border-l border-line bg-sidebar", !docked && "fixed right-0 top-0 bottom-0 z-40 shadow-overlay")} aria-label="Event detail">
            <EventDetail wid={projectId} eid={eid} base={base} onClose={close} canEdit={canEdit} />
          </motion.aside>
        )}
      </AnimatePresence>
      {eid && !docked && !mobile && <button aria-label="Close detail" onClick={close} className="fixed inset-0 z-30 bg-overlay/50 animate-fade-in" />}
      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} wid={projectId} range={range} />
      {mobile && (
        <Sheet open={filtersOpen} onOpenChange={setFiltersOpen} title="Filter timeline"
          footer={<><Button variant="ghost" onClick={() => { setQ(""); setParams({}); setFiltersOpen(false); }}>Clear filters</Button><Button variant="primary" onClick={() => setFiltersOpen(false)}>Show events</Button></>}>
          <label className="flex h-11 items-center gap-2 rounded-md border border-line-control px-3">
            <Search size={16} className="text-fg-tertiary" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search history" aria-label="Search history" className="min-w-0 flex-1 bg-transparent text-body-m text-fg placeholder:text-fg-tertiary outline-none" />
          </label>
          {[["Events", TYPES, type, (v) => set("type", v, "all"), counts], ["Sources", SOURCES, source, (v) => set("source", v, "all")], ["Period", RANGES, range, (v) => set("range", v, "30d")]].map(([label, opts, val, on, cnt]) => (
            <div key={label} className="mt-5">
              <p className="eyebrow mb-2">{label}</p>
              <div className="flex flex-wrap gap-2">
                {opts.map(([k, l]) => (
                  <button key={k} onClick={() => on(k)} className={cn("h-9 rounded-lg border px-3 text-[12px] font-medium transition-colors duration-fast", val === k ? "border-fg bg-fg text-app" : "border-line-control text-fg-secondary")}>
                    {l}{cnt?.[k] != null ? <span className="ml-1.5 opacity-70">{cnt[k]}</span> : null}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="mt-5 flex items-center justify-between"><span className="text-body-m text-fg">Memory changes only</span><Toggle checked={memOnly} onChange={(v) => set("memory", v ? "1" : null)} label="Memory changes only" /></div>
        </Sheet>
      )}
    </div>
  );
}

function FilterMenu({ value, options, counts, onChange }) {
  const label = options.find(([k]) => k === value)?.[1] || options[0][1];
  return (
    <Menu>
      <MenuTrigger asChild>
        <button className="flex h-8 items-center gap-2 rounded-md border border-line px-3 text-[12px] text-fg-secondary transition-colors duration-fast hover:text-fg data-[state=open]:border-line-strong data-[state=open]:text-fg">
          {label}<ChevronDown size={14} />
        </button>
      </MenuTrigger>
      <MenuContent align="start" className="w-[220px]">
        {options.map(([k, l]) => (
          <MenuItem key={k} onSelect={() => onChange(k)} className="pl-1">
            <span className="flex w-full items-center gap-2"><span className="w-4">{value === k ? "✓" : ""}</span><span className="flex-1">{l}</span>{counts?.[k] != null && <span className="font-mono text-[12px] text-fg-tertiary">{counts[k]}</span>}</span>
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}

function EventDetail({ wid, eid, base, onClose, canEdit, mobile }) {
  const { data: e, setData } = useResource(() => v2.event(wid, eid), [wid, eid]);
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [restored, setRestored] = useState(null);
  useEffect(() => { setRestored(null); }, [eid]);
  useEffect(() => {
    const onKey = (ev) => { if (ev.key === "Escape" && !confirm) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, confirm]);
  const d = e?.detail;
  const restore = async () => {
    setBusy(true);
    try {
      const res = await v2.restoreEvent(wid, eid);
      setConfirm(false);
      refreshAll();
      if (mobile) setRestored(res);
      else toast.success(`Previous version restored · ${res.updated} memories updated`, { duration: 10000, action: { label: "Undo", onClick: async () => { await v2.undoRestore(wid, res.event.id); refreshAll(); toast("Restore undone"); } } });
      setData({ ...e });
    } catch (err) { toast.error(err?.response?.data?.detail || "Couldn’t restore"); } finally { setBusy(false); }
  };
  const openSource = () => {
    if (e.review_id) navigate(`${base}/review/${e.review_id}`);
    else if (d?.source_id) navigate(`${base}/sources/${d.source_id}`);
    else if (e.memory_id) navigate(`${base}/memory?item=${e.memory_id}`);
    else navigate(`${base}/conversations`);
  };
  const header = mobile ? <MobileSubHeader title={d?.eyebrow || "Event"} onBack={onClose} /> : (
    <div className="flex h-[68px] shrink-0 items-center px-6 pt-1"><p className="eyebrow flex-1">{d?.eyebrow || "Event"}</p><IconButton icon={X} label="Close (Esc)" onClick={onClose} /></div>
  );
  return (
    <div className="flex h-full flex-col">
      {header}
      <div className={cn("scroll-pane min-h-0 flex-1 px-6 pb-6", mobile && "px-4 pt-4")}>
        {!e ? <div className="space-y-3"><Skeleton className="h-5 w-2/3" /><Skeleton className="h-24 w-full rounded-lg" /></div> : (
          <motion.div key={e.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={T.base} className="space-y-6">
            <AnimatePresence initial={false}>
              {restored && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={T.base} className="overflow-hidden">
                  <div role="status" className="flex items-start gap-3 rounded-lg border border-success/70 bg-success-bg px-4 py-3">
                    <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-success" />
                    <div><p className="text-body-m text-fg">Previous version restored</p><p className="text-body-s text-fg-secondary">{d.changes?.[0]?.before ? `${d.changes[0].category.replace(/s$/, "")} is “${d.changes[0].before.replace(/\.$/, "")}” again. ` : ""}Restored by you · just now.</p></div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            <h2 className="text-title-m text-fg">{d.heading}</h2>
            <dl className="space-y-3">
              {(d.rows || [["When", d.when], d.accepted_by && ["Accepted by", d.accepted_by], d.triggered_by && ["Triggered by", d.triggered_by]].filter(Boolean)).map(([k, v]) => (
                <div key={k} className="flex gap-4 text-[12px]"><dt className="w-[110px] shrink-0 text-fg-tertiary">{k}</dt><dd className="text-fg">{k === "When" ? format(new Date(v), "EEE MMM d, HH:mm") : v}</dd></div>
              ))}
            </dl>
            {d.changes?.length > 0 && (
              <section>
                <p className="eyebrow mb-3">What changed · {d.changes.length} memor{d.changes.length === 1 ? "y" : "ies"}</p>
                <div className="space-y-3">
                  {d.changes.map((c, i) => (
                    <div key={i} className="rounded-md border border-line bg-surface p-3">
                      <p className="text-[12px] text-fg-tertiary">{c.category}</p>
                      {c.before && <p className="mt-1 text-[12px] text-fg-tertiary line-through">{c.before}</p>}
                      <p className="mt-1 text-[12px] text-fg">{c.after}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}
            {d.result?.length > 0 && (
              <section>
                <p className="eyebrow mb-3">Result</p>
                {d.result.map((r, i) => <div key={i} className="border-l border-line pl-3"><p className="text-[12px] text-fg-tertiary">{r.category}</p><p className="text-[12px] text-fg">{r.text}</p></div>)}
              </section>
            )}
            {d.source && (
              <section>
                <p className="eyebrow mb-3">Source</p>
                <div className="rounded-md border border-line bg-surface p-3">
                  <Chip provider={d.source.provider === "manual" ? "notes" : d.source.provider} label={d.source.label} />
                  {d.source.quote && <p className="mt-2 text-[12px] text-fg-secondary">“{d.source.quote}”</p>}
                </div>
              </section>
            )}
            {!mobile && <div className="flex flex-wrap gap-2">
              <Button size="s" icon={e.review_id ? FileText : ExternalLink} onClick={openSource}>{e.review_id ? "Open review" : "Open source"}</Button>
              {d.restorable && <Button size="s" variant="ghost" icon={History} onClick={() => setConfirm(true)} disabled={!canEdit}>Restore previous version</Button>}
              {d.kind === "sync" && <Button size="s" variant="ghost" icon={Settings2} onClick={() => navigate(`${base}/sources/${d.source_id}`)}>Sync settings</Button>}
            </div>}
            {d.restorable && !mobile && <p className="text-[12px] text-fg-tertiary">Restoring creates a new event; history is never deleted.</p>}
          </motion.div>
        )}
      </div>
      {mobile && e && (
        <div className="flex shrink-0 gap-3 border-t border-line-subtle px-4 pt-3 pb-3 safe-bottom">
          <Button size="l" className="flex-1" icon={e.review_id ? FileText : ExternalLink} onClick={openSource}>{e.review_id ? "Open review" : "Open source"}</Button>
          {restored ? (
            <Button size="l" className="flex-1" icon={History} onClick={async () => { await v2.undoRestore(wid, restored.event.id); setRestored(null); refreshAll(); toast("Restore undone"); }}>Undo restore</Button>
          ) : d?.restorable ? (
            <Button size="l" className="flex-1" icon={History} disabled={!canEdit} onClick={() => setConfirm(true)}>Restore</Button>
          ) : null}
        </div>
      )}
      <Dialog open={confirm} onOpenChange={setConfirm} title={mobile ? "Restore previous version?" : "Restore the previous version?"}
        description={d?.changes?.length ? `${d.changes.length} memories go back to how they were before ${format(new Date(d.when), "MMM d")}. The current version stays in history.` : ""}
        footer={<><Button variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button><Button variant="primary" icon={mobile ? undefined : History} loading={busy} onClick={restore}>{mobile ? "Restore previous version" : "Restore"}</Button></>}>
        <div className="space-y-2">
          {(d?.changes || []).map((c, i) => (
            <div key={i} className="rounded-md border border-line p-3 text-[12px]">
              <p className="text-fg-tertiary">{c.category}</p>
              <p className="mt-1 text-fg-tertiary line-through">{c.after}</p>
              <p className="mt-1 text-fg">{c.before}</p>
            </div>
          ))}
          <p className="text-[12px] text-fg-tertiary">If this conflicts with a newer message, Bracket will flag it in Needs your attention.</p>
        </div>
      </Dialog>
    </div>
  );
}

function ExportDialog({ open, onOpenChange, wid, range }) {
  const [fmt, setFmt] = useState("csv");
  const [r, setR] = useState(range);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setR(range); }, [open, range]);
  const opts = [["csv", "CSV", "One row per event · opens in any spreadsheet"], ["json", "JSON", "Includes sources, diffs and versions · for audits and tools"], ["pdf", "PDF", "Readable report for clients or compliance"]];
  const go = async () => {
    setBusy(true);
    try {
      const res = await v2.exportTimeline(wid, { format: fmt, range: r });
      onOpenChange(false);
      toast.success(`Exporting ${res.rows} events as ${fmt.toUpperCase()}`, { description: `We’ll email ${res.email} when it’s ready.` });
    } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Export timeline"
      description="A complete, timestamped record of what Bracket read, proposed and changed — with who accepted each change."
      footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" icon={Download} loading={busy} onClick={go}>Export {fmt.toUpperCase()}</Button></>}>
      <div role="radiogroup" className="space-y-3">
        {opts.map(([k, l, d]) => {
          const on = fmt === k;
          return (
            <button key={k} role="radio" aria-checked={on} onClick={() => setFmt(k)} className={cn("flex w-full items-start gap-3 rounded-md border p-4 text-left transition-colors duration-fast", on ? "border-fg bg-surface" : "border-line-control hover:border-line-strong")}>
              <span className={cn("mt-0.5 flex h-4 w-4 items-center justify-center rounded-full border", on ? "border-fg" : "border-line-control")}>{on && <motion.span layoutId="exp-dot" className="h-2 w-2 rounded-full bg-fg" transition={T.fast} />}</span>
              <span><span className="block text-body-m font-medium text-fg">{l}</span><span className="block text-[12px] text-fg-secondary">{d}</span></span>
            </button>
          );
        })}
      </div>
      <div className="mt-4 flex items-center justify-between">
        <span className="text-[12px] text-fg-secondary">Date range</span>
        <FilterMenu value={r} options={RANGES} onChange={setR} />
      </div>
    </Dialog>
  );
}

function TimelineSkel() {
  const show = useDelayed(300);
  if (!show) return null;
  return <div className="space-y-4">{[0, 1, 2, 3].map((i) => <div key={i} className="flex gap-3"><Skeleton className="h-3 w-10" /><div className="flex-1"><Skeleton className="h-3 w-2/3" /><Skeleton className="mt-2 h-5 w-48" /></div></div>)}</div>;
}
