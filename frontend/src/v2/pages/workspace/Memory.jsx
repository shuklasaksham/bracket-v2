import React, { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Search, Plus, Pencil, MoreHorizontal, X, ExternalLink, ChevronRight, ChevronDown, AlertTriangle, MessageCircleQuestion, Layers,
  Merge, EyeOff, Pin, ArrowLeft, Mail, Copy, MessagesSquare, Archive,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { useWorkspace, refreshAll } from "../../lib/workspace";
import { v2 } from "../../lib/api2";
import { shortTime, useResource } from "../../lib/data";
import { useIsMobile, useMedia } from "../../lib/useMedia";
import { Avatar, Badge, Button, Confidence, IconButton, Input, Skeleton, SourceMark } from "../../ui/primitives";
import { Dialog, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Sheet } from "../../ui/overlays";
import { Chip, Tabs } from "../../ui/patterns";
import { AnimatePresence, Stagger, StaggerItem, motion, t as T, useDelayed } from "../../ui/motion";
import { MobileSubHeader } from "../../shell/AppShell";
import { useAskPanel } from "../../shell/AskPanel";
import { dueStatus } from "./Overview";
import { cn } from "../../../lib/utils";

/* Memory — Figma › ✓ Memory — Desktop 1440 and its states: Edit commitment,
   Source viewer (evidence), Needs review, Recently changed, People · Sarah Chen,
   Search results, Category menu, Suggest a category, Memory — edge cases; plus
   Memory / Memory detail / People / Person — Mobile 390. */

const VIEWS = { "needs-review": "needs_review", recent: "recent" };
const SINGULAR = { scope: "Scope", decision: "Decision", deliverable: "Deliverable", requirement: "Requirement", commitment: "Commitment", person: "Person" };
const OP = { modify: ["Modify", "warning"], add: ["Add", "info"], conflict: ["Conflict", "danger"] };
const fmt = (iso, f = "MMM d") => (iso ? format(new Date(iso), f) : "");

export default function Memory() {
  const { category } = useParams();
  const [params, setParams] = useSearchParams();
  const { projectId, categories, counts, canEdit } = useWorkspace();
  const mobile = useIsMobile();
  const docked = useMedia("(min-width: 1280px)");
  const navigate = useNavigate();
  const base = `/w/${projectId}`;
  const itemId = params.get("item");
  const personId = params.get("person");
  const evidenceId = params.get("evidence");
  const q = params.get("q") || "";
  const finding = params.has("find");
  const [tab, setTab] = useState("current");
  const [suggestOpen, setSuggestOpen] = useState(false);
  useEffect(() => setTab("current"), [category]);

  const view = VIEWS[category] || null;
  const cat = (categories || []).find((c) => c.key === category);
  const isPeople = category === "person";
  const listParams = q ? { q } : view ? { view } : { category: category || undefined, view: tab === "current" ? undefined : tab };
  const list = useResource(() => (isPeople && !q ? v2.people(projectId) : v2.memory(projectId, listParams)), [projectId, category, tab, q]);
  useEffect(() => {
    const on = () => list.reload();
    window.addEventListener("bk:refresh", on);
    return () => window.removeEventListener("bk:refresh", on);
  }, [list]);

  const setParam = (k, v) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v); else n.delete(k);
    if (k === "item" || k === "person") n.delete("evidence");
    setParams(n);
  };
  const open = (id) => setParam(isPeople ? "person" : "item", id);
  const closeDetail = () => { const n = new URLSearchParams(params); ["item", "person", "evidence"].forEach((k) => n.delete(k)); setParams(n); };
  const panelOpen = !!(itemId || personId);

  // Mobile opens on Commitments (Figma › Memory — Mobile 390).
  if (mobile && !category && !q && !finding && !itemId && !personId) return <Navigate to={`${base}/memory/commitment`} replace />;

  /* mobile: detail is a pushed screen */
  if (mobile && panelOpen) {
    return (
      <div className="flex h-full flex-col">
        {evidenceId ? (
          <SourceViewer wid={projectId} eid={evidenceId} onBack={() => setParam("evidence", null)} mobile />
        ) : personId ? (
          <PersonDetail wid={projectId} pid={personId} onClose={closeDetail} mobile base={base} />
        ) : (
          <MemoryDetail wid={projectId} mid={itemId} onClose={closeDetail} onEvidence={(id) => setParam("evidence", id)} canEdit={canEdit} mobile base={base} onOpen={(id) => setParam("item", id)} />
        )}
      </div>
    );
  }

  const title = q ? "Search" : view === "needs_review" ? "Needs review" : view === "recent" ? "Recently changed" : cat ? cat.label : "All memory";
  const desc = q ? `Results for “${q}” across memory. Pending changes are marked.`
    : view === "needs_review" ? "Proposed changes waiting for you, grouped by what triggered them. Nothing here is in memory yet."
      : view === "recent" ? "Everything that changed in the last 7 days, newest first. Open one to see the previous version."
        : cat?.description || "Everything Bracket remembers about this work, by category.";
  const items = list.data?.items || list.data?.people || [];
  const count = q || view || isPeople ? items.length : cat ? cat.count : counts.memory;

  const listColumn = (
    <div className="scroll-pane h-full min-w-0 flex-1">
      <div className={cn("px-4 pt-4 pb-10 md:px-8 md:pt-6", mobile && "pt-3")}>
        {mobile ? (
          <MobileCategoryStrip base={base} categories={categories} active={category} total={counts.memory} title={title} isPeople={isPeople} q={q} finding={finding || !!q} onSearch={(v) => setParam("q", v)} onFind={() => { const n = new URLSearchParams(params); n.set("find", "1"); setParams(n); }} />
        ) : (
          <div className="flex flex-wrap items-start justify-between gap-3 sm:flex-nowrap">
            <div className="min-w-0 flex-1">
              <h1 className="flex items-baseline gap-2 text-title-l text-fg">{isPeople ? "People" : title}<span className="font-mono text-[12px] font-normal text-fg-tertiary">{count}</span></h1>
              <p className="mt-1 max-w-[420px] text-[12px] leading-[18px] text-fg-tertiary">{isPeople ? "Everyone involved in this work, what they’ve said and what they’re owed." : desc}</p>
            </div>
            <FilterBox value={q} placeholder={q ? "Search memory" : view === "needs_review" ? "Filter pending" : view === "recent" ? "Filter changes" : isPeople ? "Find a person" : cat ? `Filter ${cat.label.toLowerCase()}` : "Search memory"} onChange={(v) => setParam("q", v)} />
          </div>
        )}
        {!q && !view && !isPeople && cat && !mobile && (
          <div className="mt-4"><Tabs layoutId="mem-tabs" value={tab} onChange={setTab} options={[{ value: "current", label: "Current" }, { value: "changed", label: "Changed" }, { value: "superseded", label: "Superseded" }]} /></div>
        )}
        <div className="mt-4">
          {!list.data ? <ListSkeleton /> : isPeople && !q ? (
            <PeopleList people={items} selected={personId} onOpen={open} />
          ) : (
            <MemoryList items={items} view={q || (mobile && finding) ? "search" : view} category={category} tab={tab} selected={itemId} onOpen={open} base={base} q={q} />
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-full">
      {!mobile && <CategoryRail base={base} categories={categories} counts={counts} active={category} q={q} onSuggest={() => setSuggestOpen(true)} canEdit={canEdit} />}
      {listColumn}
      <AnimatePresence initial={false}>
        {panelOpen && !mobile && (
          <motion.aside
            key="panel"
            initial={{ x: 32, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 32, opacity: 0 }} transition={T.base}
            className={cn("flex h-full w-[420px] shrink-0 flex-col border-l border-line bg-sidebar", !docked && "fixed right-0 top-0 bottom-0 z-40 shadow-overlay")}
            aria-label="Memory detail"
          >
            {evidenceId ? (
              <SourceViewer wid={projectId} eid={evidenceId} onBack={() => setParam("evidence", null)} onClose={closeDetail} />
            ) : personId ? (
              <PersonDetail wid={projectId} pid={personId} onClose={closeDetail} base={base} />
            ) : (
              <MemoryDetail wid={projectId} mid={itemId} onClose={closeDetail} onEvidence={(id) => setParam("evidence", id)} canEdit={canEdit} base={base} onOpen={(id) => setParam("item", id)} />
            )}
          </motion.aside>
        )}
      </AnimatePresence>
      {panelOpen && !docked && !mobile && <button aria-label="Close detail" onClick={closeDetail} className="fixed inset-0 z-30 bg-overlay/50 animate-fade-in" />}
      <SuggestCategory open={suggestOpen} onOpenChange={setSuggestOpen} wid={projectId} />
    </div>
  );
}

/* ───────────────────────── Rail ───────────────────────── */
function CategoryRail({ base, categories, counts, active, q, onSuggest, canEdit }) {
  const row = (to, label, count, dot, on, key) => (
    <Link key={key || to} to={to} className={cn("group relative flex h-[30px] items-center gap-2 rounded-md px-2 text-[12px] transition-colors duration-fast", on ? "font-medium text-fg" : "text-fg-secondary hover:bg-hover hover:text-fg")}>
      {on && <motion.span layoutId="mem-rail" className="absolute inset-0 rounded-md bg-selected" transition={T.base} />}
      <span className="relative flex-1 truncate">{label}</span>
      {dot && <span className="relative h-1.5 w-1.5 rounded-full bg-warning" aria-label="Has proposed changes" />}
      <span className="relative font-mono text-[12px] text-fg-tertiary">{count}</span>
    </Link>
  );
  return (
    <nav aria-label="Memory views" className="scroll-pane hidden h-full w-[232px] shrink-0 border-r border-line-subtle px-4 py-6 lg:block">
      <h2 className="px-2 pb-3 text-title-m text-fg">Memory</h2>
      <div className="space-y-0.5">
        {row(`${base}/memory`, "All memory", counts.memory ?? "", false, !active && !q, "all")}
        {row(`${base}/memory/needs-review`, "Needs review", counts.needs_review ?? 0, counts.needs_review > 0, active === "needs-review", "nr")}
        {row(`${base}/memory/recent`, "Recently changed", counts.recently_changed ?? 0, false, active === "recent", "rc")}
      </div>
      <p className="eyebrow px-2 pt-4 pb-2">Discovered categories</p>
      <div className="space-y-0.5">
        {(categories || []).map((c) => (
          <div key={c.key} className="group/cat relative">
            {row(`${base}/memory/${c.key}`, c.label, c.count, c.pending > 0, active === c.key)}
            <CategoryMenu c={c} canEdit={canEdit} />
          </div>
        ))}
      </div>
      <p className="px-2 pt-3 text-[12px] font-medium leading-4 text-fg-tertiary">Bracket organizes memory into categories based on what it finds in your sources.</p>
      <Button size="s" variant="ghost" icon={Plus} className="mt-2" onClick={onSuggest} disabled={!canEdit}>Suggest a category</Button>
    </nav>
  );
}

function CategoryMenu({ c, canEdit }) {
  const { projectId } = useWorkspace();
  const [rename, setRename] = useState(false);
  const [name, setName] = useState(c.label);
  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <button aria-label={`${c.label} options`} className="absolute right-7 top-1/2 hidden h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-fg-tertiary hover:bg-hover hover:text-fg group-hover/cat:flex data-[state=open]:flex">
            <MoreHorizontal size={14} />
          </button>
        </MenuTrigger>
        <MenuContent align="start" side="right" className="w-[200px]">
          <MenuItem icon={Pencil} disabled={!canEdit} onSelect={() => setRename(true)}>Rename</MenuItem>
          <MenuItem icon={Merge} disabled={!canEdit} onSelect={() => toast("Choose a category to merge into", { description: "Drag one category onto another, or pick from the list." })}>Merge into…</MenuItem>
          <MenuItem icon={EyeOff} onSelect={() => toast(`${c.label} hidden from the sidebar`)}>Hide from sidebar</MenuItem>
          <MenuItem icon={Pin} onSelect={() => toast(`${c.label} pinned to Overview`)}>Pin to Overview</MenuItem>
          <MenuSeparator />
          <MenuItem icon={X} danger disabled={!canEdit} onSelect={() => toast(`Bracket will stop using “${c.label}”`, { description: "Its memories move to All memory." })}>Not a real category</MenuItem>
        </MenuContent>
      </Menu>
      <Dialog open={rename} onOpenChange={setRename} title="Rename category" size="s"
        footer={<><Button variant="ghost" onClick={() => setRename(false)}>Cancel</Button><Button variant="primary" onClick={async () => { await v2.renameCategory(projectId, c.key, name); setRename(false); refreshAll(); toast.success("Category renamed"); }}>Rename</Button></>}>
        <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus aria-label="Category name" />
      </Dialog>
    </>
  );
}

function SuggestCategory({ open, onOpenChange, wid }) {
  const [name, setName] = useState("");
  useEffect(() => { if (open) setName(""); }, [open]);
  const hint = /risk/i.test(name) ? "Bracket found 3 possible risks already (e.g. “brand assets late”)." : /approv/i.test(name) ? "Bracket found 3 approval steps in Sarah’s emails." : name ? "Bracket will look through your sources and propose memories for review." : null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Suggest a category"
      description="Tell Bracket what else to keep track of. It looks through your sources and proposes memories for review."
      footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" disabled={!name.trim()} onClick={async () => { await v2.suggestCategory(wid, name.trim()); onOpenChange(false); toast.success(`Looking for ${name.trim().toLowerCase()}…`, { description: "New memories will show up under Needs review." }); }}>Create category</Button></>}>
      <label className="block text-[12px] font-medium text-fg-secondary" htmlFor="cat-name">Category name</label>
      <Input id="cat-name" className="mt-2" value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="e.g. Risks" />
      <AnimatePresence>{hint && <motion.p initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={T.fast} className="mt-2 text-[12px] text-fg-tertiary">{hint}</motion.p>}</AnimatePresence>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-fg-tertiary">
        Try: {["Risks", "Approvals", "Budget", "Open questions"].map((x) => <button key={x} onClick={() => setName(x)}><Badge>{x}</Badge></button>)}
      </div>
    </Dialog>
  );
}

/* ───────────────────────── Mobile strip ───────────────────────── */
function MobileCategoryStrip({ base, categories, active, title, total, isPeople, q, finding, onSearch, onFind }) {
  if (finding) {
    // Figma › Memory · Search results — Mobile 390 (144:1001)
    return (
      <div>
        <Link to={`${base}/memory`} className="flex h-8 items-center gap-2 text-[12px] text-fg-secondary"><ArrowLeft size={14} /> Memory</Link>
        <label className="mt-3 block text-body-s text-fg-secondary" htmlFor="mem-find">Search memory</label>
        <FilterBox id="mem-find" value={q} autoFocus placeholder="Scope, decisions, people…" onChange={onSearch} className="mt-2 h-11 border-fg/80" />
      </div>
    );
  }
  if (active && (isPeople || ["needs-review", "recent"].includes(active))) {
    const sub = isPeople ? "Everyone involved in this work, their role and what they’ve said." : active === "recent" ? "Last 7 days · every change is in the timeline" : null;
    return (
      <div>
        <Link to={`${base}/memory`} className="flex h-8 items-center gap-2 text-[12px] text-fg-secondary"><ArrowLeft size={14} /> Memory</Link>
        <h1 className="mt-2 text-title-m text-fg">{isPeople ? "People" : title}</h1>
        {sub && <p className="mt-1 text-[12px] text-fg-tertiary">{sub}</p>}
      </div>
    );
  }
  // Commitments and People first — what people open most on a phone.
  const order = ["commitment", "person"];
  const cats = [...(categories || [])].sort((x, y) => (order.indexOf(x.key) + 1 || 9) - (order.indexOf(y.key) + 1 || 9));
  return (
    <div>
      <div className="flex h-11 items-center gap-2">
        <h1 className="flex flex-1 items-baseline gap-2 text-title-m text-fg">Memory <span className="font-mono text-[12px] font-normal text-fg-tertiary">{total}</span></h1>
        <IconButton icon={Search} label="Search memory" size="l" onClick={onFind} />
      </div>
      <div className="-mx-4 mt-2 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        {cats.map((c) => {
          const on = c.key === active;
          return (
            <Link key={c.key} to={`${base}/memory/${c.key}`} className={cn("relative flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-[12px] font-medium transition-colors duration-fast", on ? "border-fg text-app" : "border-line-control text-fg-secondary")}>
              {on && <motion.span layoutId="mem-chip" className="absolute inset-0 rounded-[7px] bg-fg" transition={T.base} />}
              <span className="relative flex items-center gap-1.5">{c.pending > 0 && !on && <span className="h-1.5 w-1.5 rounded-full bg-warning" />}{c.label} {c.count}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function FilterBox({ value, onChange, placeholder, autoFocus, className, onBlur, id }) {
  const [v, setV] = useState(value || "");
  useEffect(() => setV(value || ""), [value]);
  useEffect(() => {
    const id = setTimeout(() => { if (v !== (value || "")) onChange(v.trim()); }, 220);
    return () => clearTimeout(id);
  }, [v]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <label className={cn("mt-[17px] flex h-8 w-full shrink-0 items-center gap-2 rounded-md border px-3 transition-colors duration-fast sm:w-[200px]", v ? "border-fg/80" : "border-line", className)}>
      <Search size={16} className="text-fg-tertiary" />
      <input id={id} value={v} autoFocus={autoFocus} onBlur={onBlur} onChange={(e) => setV(e.target.value)} placeholder={placeholder} aria-label={placeholder}
        className="min-w-0 flex-1 bg-transparent text-[12px] text-fg placeholder:text-fg-tertiary outline-none" />
      {v && <button aria-label="Clear" onClick={() => { setV(""); onChange(""); }} className="text-fg-tertiary hover:text-fg"><X size={14} /></button>}
    </label>
  );
}

/* ───────────────────────── Lists ───────────────────────── */
function itemStatus(m, view) {
  if (view === "needs_review" || m.status === "pending") return m.op && view === "needs_review" ? { tone: OP[m.op]?.[1] || "warning", label: OP[m.op]?.[0] || "Pending" } : { tone: "warning", label: "Pending" };
  if (view === "recent") return m.versions?.length ? { tone: "success", label: "Accepted" } : { tone: "info", label: "Added" };
  if (m.status === "superseded") return { tone: "neutral", label: `Superseded ${fmt(m.superseded_at)}` };
  if (m.category === "commitment") return m.state === "completed" ? { tone: "success", label: "Done" } : m.waiting_days ? { tone: "neutral", label: `Waiting ${m.waiting_days} days` } : m.due && dueStatus(m) ? { ...dueStatus(m), label: dueStatus(m).label.replace(/^In /, "Due in ") } : m.at_risk ? { tone: "danger", label: "At risk" } : null;
  if (m.confidence === "low") return { tone: "warning", label: "Low confidence" };
  return null;
}
function itemMeta(m, view) {
  const catLabel = SINGULAR[m.category] ? `${SINGULAR[m.category] === "Person" ? "People" : SINGULAR[m.category]}${m.category === "person" ? "" : m.category.endsWith("y") ? "" : ""}` : m.category;
  if (view === "needs_review") return `${catLabel} · ${m.before ? `would replace “${m.before.replace(/\.$/, "").toLowerCase().slice(0, 40)}”` : m.op === "conflict" ? "conflicts with kickoff notes" : m.confidence === "low" ? "low confidence" : "new"}`;
  if (view === "recent") return `${catLabel} · ${m.versions?.length ? `was “${m.versions[m.versions.length - 1].title.replace(/\.$/, "").toLowerCase().slice(0, 34)}”` : "new"} · ${fmt(m.changed_at)}`;
  if (view === "search" && m.status === "pending") return `Pending · ${m.before ? `would replace “${m.before.replace(/\.$/, "").toLowerCase().slice(0, 34)}”` : "new"}`;
  if (m.category === "commitment") {
    if (m.state === "completed") return `Completed ${fmt(m.completed_at)}`;
    return `Owner: ${m.owner}${m.due ? ` · Due ${fmt(m.due)}` : m.promised_at ? ` · Promised ${fmt(m.promised_at)}` : m.direction === "Agreed at kickoff" ? " · Agreed at kickoff" : " · No date set"}`;
  }
  return null;
}

function MemoryRow({ m, view, selected, onOpen, mobile }) {
  const st = itemStatus(m, view);
  const ev = (m.evidence || [])[0];
  const meta = itemMeta(m, view);
  return (
    <button onClick={() => onOpen(m.current_id || m.review_id || m.id, m)}
      className={cn("group block w-full px-4 py-3 text-left transition-colors duration-fast", selected ? "bg-surface shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)]" : "hover:bg-hover")}
      aria-current={selected ? "true" : undefined}>
      <div className="flex items-start gap-3">
        <p className={cn("min-w-0 flex-1 text-body-m", m.status === "superseded" ? "text-fg-tertiary line-through" : "text-fg")}>{m.title}</p>
        {st && <Badge tone={st.tone} dot>{st.label}</Badge>}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {ev && (mobile ? (
          <span className="flex items-center gap-2 text-[12px] text-fg-tertiary"><SourceMark provider={ev.provider === "notes" ? "notes" : ev.provider} size={14} />{meta || `${ev.author} · ${fmt(ev.at)}`}</span>
        ) : (
          <Chip provider={ev.provider} label={ev.author === "Maya Rao" && ev.provider === "notes" ? ev.where.replace(" notes", "") : ev.author} at={fmt(ev.at)} />
        ))}
        {!mobile && meta && <span className="text-[12px] font-medium text-fg-tertiary">{meta}</span>}
      </div>
    </button>
  );
}

function MemoryList({ items, view, category, tab, selected, onOpen, base, q }) {
  const mobile = useIsMobile();
  const ask = useAskPanel();
  const navigate = useNavigate();
  if (mobile && (view || q || items.length)) return <MobileMemoryList items={items} view={view} onOpen={onOpen} base={base} q={q} />;
  if (!items.length) {
    if (q) return <EmptyBox icon={Search} title={`No memories match “${q}”`} body="Try Ask Bracket — it also searches conversations and notes that haven’t become memory." action={<Button size="s" icon={MessageCircleQuestion} onClick={() => ask.open(q)}>Ask Bracket</Button>} />;
    if (view === "needs_review") return <EmptyBox icon={Layers} title="Nothing waiting for review" body="Proposed changes show up here when a source changes something Bracket remembers." />;
    if (tab === "superseded") return <EmptyBox icon={Archive} title="Nothing superseded" body="When a memory is replaced, the old version is kept here and can be restored." />;
    return <EmptyBox icon={Layers} title={`No ${(category && SINGULAR[category] ? SINGULAR[category].toLowerCase() + "s" : "memory")} yet`} body="Bracket adds them when conversations mention them." />;
  }
  const box = (list, key) => (
    <Stagger key={key} className="overflow-hidden rounded-lg border border-line divide-y divide-line-subtle">
      {list.map((m) => <StaggerItem key={m.id}><MemoryRow m={m} view={view} selected={selected === (m.current_id || m.id)} onOpen={onOpen} mobile={mobile} /></StaggerItem>)}
    </Stagger>
  );
  if (view === "needs_review") {
    const groups = {};
    items.forEach((m) => { (groups[m.review_id] = groups[m.review_id] || []).push(m); });
    return (
      <div className="space-y-5">
        {Object.entries(groups).map(([rid, list]) => (
          <div key={rid}>
            <div className="mb-3 flex items-center gap-2">
              <SourceMark provider={list[0].evidence[0].provider} size={16} />
              <span className="flex-1 text-[12px] font-medium text-fg">From {list[0].evidence[0].author}’s {list[0].evidence[0].provider === "gmail" ? "email" : "message"} · {shortTime(list[0].created_at)}</span>
              <Button size="s" variant="primary" onClick={() => navigate(`${base}/review/${rid}`)}>Review {list.length} change{list.length === 1 ? "" : "s"}</Button>
            </div>
            {box(list, rid)}
          </div>
        ))}
      </div>
    );
  }
  if (view === "search") {
    const groups = {};
    items.forEach((m) => { (groups[m.category] = groups[m.category] || []).push(m); });
    return (
      <div className="space-y-4">
        {Object.entries(groups).map(([c, list]) => (
          <div key={c}><p className="eyebrow mb-3">{(SINGULAR[c] === "Person" ? "People" : (SINGULAR[c] || c) + (c === "scope" ? "" : "s"))} · {list.length}</p>{box(list, c)}</div>
        ))}
        <div className="flex items-center gap-3 rounded-lg border border-line px-4 py-3">
          <MessagesSquare size={16} className="text-fg-tertiary" />
          <span className="flex-1 text-[12px] text-fg-secondary">“{q}” may also appear in conversations that aren’t memory yet</span>
          <Button size="s" variant="ghost" icon={MessageCircleQuestion} onClick={() => ask.open(q)}>Ask Bracket</Button>
        </div>
      </div>
    );
  }
  if (view === "recent") return <div><p className="eyebrow mb-3">This week</p>{box(items, "recent")}</div>;
  if (category === "commitment" && tab === "current") {
    const open = items.filter((m) => m.state !== "completed");
    const done = items.filter((m) => m.state === "completed");
    return (
      <div className="space-y-4">
        {open.length > 0 && <div><p className="eyebrow mb-3">Open</p>{box(open, "open")}</div>}
        {done.length > 0 && <div><p className="eyebrow mb-3">Completed</p>{box(done, "done")}</div>}
      </div>
    );
  }
  if (!category) {
    const groups = {};
    items.forEach((m) => { (groups[m.category] = groups[m.category] || []).push(m); });
    return (
      <div className="space-y-4">
        {Object.entries(groups).map(([c, list]) => <div key={c}><p className="eyebrow mb-3">{SINGULAR[c] === "Person" ? "People" : (SINGULAR[c] || c) + (c === "scope" ? "" : "s")} · {list.length}</p>{box(list, c)}</div>)}
      </div>
    );
  }
  return box(items, "flat");
}

/* ───────────────────────── Mobile 390 lists — Figma 42:4331, 144:449, 144:613, 144:1001 ───────────────────────── */
const catName = (c) => (SINGULAR[c] === "Person" ? "People" : SINGULAR[c] ? SINGULAR[c] + (c === "scope" ? "" : "s") : c);
function mobileMeta(m) {
  if (m.category === "commitment") return m.due ? `Due ${fmt(m.due)}` : m.promised_at ? `Promised ${fmt(m.promised_at)}` : m.direction === "Agreed at kickoff" ? "Agreed at kickoff" : "No date";
  const ev = (m.evidence || [])[0];
  return ev ? `${ev.author} · ${fmt(ev.at)}` : "";
}
function MobileMemoryRows({ items, onOpen }) {
  return (
    <Stagger as="ul" className="-mx-4 border-t border-line-subtle">
      {items.map((m) => {
        const st = itemStatus(m);
        const ev = (m.evidence || [])[0];
        return (
          <StaggerItem as="li" key={m.id} className="border-b border-line-subtle">
            <button onClick={() => onOpen(m.current_id || m.id, m)} className="block w-full px-4 py-4 text-left transition-colors duration-fast active:bg-hover">
              <span className={cn("block text-body-m", m.status === "superseded" ? "text-fg-tertiary line-through" : "text-fg")}>{m.title}</span>
              <span className="mt-2 flex items-center gap-2 text-body-s text-fg-tertiary">
                {ev && <SourceMark provider={ev.provider === "notes" ? "notes" : ev.provider} size={14} />}
                <span className="min-w-0 flex-1 truncate">{mobileMeta(m)}</span>
                {st && <Badge tone={st.tone} dot>{st.label.replace(/^Due in /, "In ")}</Badge>}
              </span>
            </button>
          </StaggerItem>
        );
      })}
    </Stagger>
  );
}
function MobileBox({ rows }) {
  return (
    <Stagger as="ul" className="overflow-hidden rounded-lg border border-line divide-y divide-line-subtle">
      {rows.map((r) => (
        <StaggerItem as="li" key={r.key}>
          <button onClick={r.onClick} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-fast active:bg-hover">
            <span className="min-w-0 flex-1">
              <span className="block text-body-m text-fg">{r.title}</span>
              {r.meta && <span className="mt-0.5 block text-body-s text-fg-tertiary">{r.meta}</span>}
            </span>
            {r.badge && <Badge tone={r.badge.tone} dot={r.dot}>{r.badge.label}</Badge>}
            <ChevronRight size={16} className="shrink-0 text-fg-tertiary" />
          </button>
        </StaggerItem>
      ))}
    </Stagger>
  );
}
function MobileMemoryList({ items, view, onOpen, base, q }) {
  const navigate = useNavigate();
  const ask = useAskPanel();
  if (view === "needs_review") {
    const groups = {};
    items.forEach((m) => { (groups[m.review_id] = groups[m.review_id] || []).push(m); });
    if (!items.length) return <EmptyBox icon={Layers} title="Nothing waiting for review" body="Proposed changes show up here when a source changes something Bracket remembers." />;
    return (
      <div className="space-y-6">
        {Object.entries(groups).map(([rid, list]) => {
          const ev = list[0].evidence[0];
          return (
            <section key={rid}>
              <p className="mb-3 text-body-s text-fg-tertiary">{list.length} proposed update{list.length === 1 ? "" : "s"} from {ev.author.split(" ")[0]}’s {ev.provider === "gmail" ? "email" : "message"} · {shortTime(list[0].created_at)}</p>
              <MobileBox rows={list.map((m) => ({ key: m.id, title: m.title, meta: `${catName(m.category)} · ${m.op === "conflict" ? "Conflicts with what’s agreed" : m.confidence === "low" ? "Low confidence" : m.before ? "Replaces what’s remembered" : "New"}`, badge: OP[m.op] ? { tone: OP[m.op][1], label: OP[m.op][0] } : null, onClick: () => navigate(`${base}/review/${rid}`) }))} />
              <Button variant="primary" className="mt-4 h-11 w-full" onClick={() => navigate(`${base}/review/${rid}`)}>Review {list.length} change{list.length === 1 ? "" : "s"}</Button>
            </section>
          );
        })}
      </div>
    );
  }
  if (view === "recent") {
    return <MobileBox rows={items.map((m) => ({ key: m.id, title: m.title, meta: `${catName(m.category)} · ${m.versions?.length ? "Accepted by Maya" : "Added"} · ${fmt(m.changed_at)}`, onClick: () => onOpen(m.id, m) }))} />;
  }
  if (view === "search") {
    if (!q) return <p className="text-body-s text-fg-tertiary">Search scope, decisions, commitments, people and pending changes.</p>;
    return (
      <>
        <p className="mb-3 text-body-s text-fg-tertiary">{items.length} result{items.length === 1 ? "" : "s"} for “{q}”</p>
        {items.length ? (
          <MobileBox rows={items.map((m) => ({ key: m.id, title: m.title, meta: m.status === "pending" ? `Pending · from ${m.evidence[0].author.split(" ")[0]}’s ${m.evidence[0].provider === "gmail" ? "email" : "message"} ${shortTime(m.created_at).toLowerCase()}` : `${catName(m.category)} · ${mobileMeta(m)}`, onClick: () => onOpen(m.current_id || m.review_id || m.id, m) }))} />
        ) : (
          <EmptyBox icon={Search} title={`No memories match “${q}”`} body="Try Ask Bracket — it also searches conversations and notes that haven’t become memory." action={<Button size="s" icon={MessageCircleQuestion} onClick={() => ask.open(q)}>Ask Bracket</Button>} />
        )}
      </>
    );
  }
  if (!items.length) return null;
  return <MobileMemoryRows items={items.filter((m) => m.state !== "completed")} onOpen={onOpen} />;
}

/* Figma › Memory · Edit commitment — Mobile 390 (144:1140) */
function EditSheet({ open, onOpenChange, m, wid, onSaved }) {
  const [title, setTitle] = useState("");
  const [owner, setOwner] = useState("");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open && m) { setTitle(m.title); setOwner(m.owner || ""); setDue(m.due ? m.due.slice(0, 10) : ""); } }, [open, m]);
  if (!m) return null;
  const commitment = m.category === "commitment";
  const save = async () => {
    setBusy(true);
    try {
      const body = { title: title.trim() };
      if (commitment) Object.assign(body, { owner, due: due ? new Date(`${due}T09:00:00`).toISOString() : null });
      const n = await v2.editMemory(wid, m.id, body);
      toast.success("Saved", { description: "Logged in the timeline with you as the source." });
      onSaved(n);
    } catch (e) { toast.error(e?.response?.data?.detail || "Couldn’t save"); } finally { setBusy(false); }
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={`Edit ${(SINGULAR[m.category] || "memory").toLowerCase()}`}
      description="Edits are saved to memory and logged in the timeline with you as the source."
      footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" onClick={save} loading={busy} disabled={!title.trim()}>Save changes</Button></>}>
      <div className="space-y-4">
        <label className="block text-body-s font-medium text-fg-secondary">What<Input className="mt-2 h-11" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        {commitment && <label className="block text-body-s font-medium text-fg-secondary">Owner<Input className="mt-2 h-11" value={owner} onChange={(e) => setOwner(e.target.value)} /></label>}
        {commitment && <label className="block text-body-s font-medium text-fg-secondary">Due<Input className="mt-2 h-11" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>}
      </div>
    </Sheet>
  );
}

/* Figma › Memory · Source evidence — Mobile 390 (144:1265) */
function EvidenceSheet({ wid, ev, onOpenChange }) {
  const { data: s } = useResource(() => (ev ? v2.evidence(wid, ev.id) : Promise.resolve(null)), [wid, ev?.id]);
  const n = s?.memory_from?.length || 1;
  const app = ev?.provider === "slack" ? "Slack" : ev?.provider === "gmail" ? "Gmail" : null;
  return (
    <Sheet open={!!ev} onOpenChange={onOpenChange} title={ev ? `Source · ${ev.author}${app ? `, ${app}` : ""}` : "Source"}
      footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Done</Button>{s?.link && app && <Button variant="secondary" onClick={() => window.open(s.link, "_blank", "noopener")}>Open in {app}</Button>}</>}>
      {ev && (
        <>
          <p className="text-body-s text-fg-tertiary">{ev.where} · {fmt(ev.at, "MMM d, HH:mm")}</p>
          <blockquote className="mt-4 rounded-md bg-surface px-4 py-3 text-body-l text-fg">“{ev.quote}”</blockquote>
          <p className="mt-4 text-body-s text-fg-secondary">Bracket created {n} memor{n === 1 ? "y" : "ies"} from this {ev.provider === "notes" ? "note" : "sentence"}.</p>
        </>
      )}
    </Sheet>
  );
}

/* Figma › Memory · Person · Sarah Chen — Mobile 390 (144:912) */
function MobilePerson({ p, base }) {
  const navigate = useNavigate();
  const ask = useAskPanel();
  const first = p.name.split(" ")[0];
  const approves = (p.approves || "").split(" · ")[0].replace(" (confirmed)", "").toLowerCase();
  return (
    <>
      <div className="scroll-pane flex-1 min-h-0 px-4 pt-4 pb-6">
        <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={T.base}>
          <div className="flex items-start gap-3">
            <Avatar name={p.name} size="l" />
            <div className="min-w-0"><p className="text-title-m text-fg">{p.name}</p><p className="text-body-s text-fg-tertiary">{p.role} · {p.org.replace(" (you)", "")} · {p.email}</p></div>
          </div>
          <p className="eyebrow mt-6">Role in this work</p>
          <p className="mt-2 text-body-m text-fg">{p.role_in_work}.{approves ? ` Approves ${approves}` : ""}{p.approves_confidence === "low" ? "; scope approval is unconfirmed." : approves ? "." : ""}</p>
          {p.open?.length > 0 && (
            <>
              <p className="eyebrow mt-6 mb-3">Open with {first}</p>
              <MobileBox rows={p.open.map((o, i) => ({ key: i, title: o.title || o.text, meta: o.meta || o.kind, badge: o.badge, dot: true, onClick: () => navigate(o.thread_id ? `${base}/conversations/${o.thread_id}` : `${base}/memory/commitment?item=${o.id}`) }))} />
            </>
          )}
        </motion.div>
      </div>
      <div className="flex shrink-0 gap-3 border-t border-line-subtle px-4 pt-3 pb-3 safe-bottom">
        <Button size="l" variant="secondary" className="flex-1" onClick={() => ask.open(`What do we know about ${p.name}?`)}>Ask about {first}</Button>
        <Button size="l" variant="primary" className="flex-1" onClick={() => navigate(`${base}/conversations?new=1&to=${encodeURIComponent(p.email)}`)}>Email {first}</Button>
      </div>
    </>
  );
}

function PeopleList({ people, selected, onOpen }) {
  const mobile = useIsMobile();
  if (!people.length) return <EmptyBox icon={Layers} title="No people yet" body="Bracket adds people as they show up in your sources." />;
  return (
    <Stagger className="overflow-hidden rounded-lg border border-line divide-y divide-line-subtle">
      {people.map((p) => (
        <StaggerItem key={p.id}>
          <button onClick={() => onOpen(p.id)} className={cn("flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-fast", selected === p.id ? "bg-surface shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)]" : "hover:bg-hover")}>
            <Avatar name={p.name} />
            <span className="min-w-0 flex-1">
              <span className="block text-body-m text-fg">{p.name}</span>
              <span className="block text-[12px] text-fg-tertiary">{p.role} · {p.org}</span>
            </span>
            <span className="text-[12px] text-fg-tertiary">{mobile ? p.summary.split(" · ")[0].replace(" messages", " msgs") : p.summary}</span>
            {mobile && <ChevronRight size={16} className="text-fg-tertiary" />}
          </button>
        </StaggerItem>
      ))}
    </Stagger>
  );
}

function EmptyBox({ icon: Icon, title, body, action }) {
  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={T.base} className="rounded-lg border border-line px-4 py-4">
      <div className="flex gap-3">
        <Icon size={16} className="mt-0.5 text-fg-tertiary" />
        <div><p className="text-body-m text-fg">{title}</p><p className="mt-1 text-[12px] text-fg-tertiary">{body}</p>{action && <div className="mt-3">{action}</div>}</div>
      </div>
    </motion.div>
  );
}
function ListSkeleton() {
  const show = useDelayed(300);
  if (!show) return null;
  return <div className="space-y-px overflow-hidden rounded-lg border border-line">{[0, 1, 2, 3].map((i) => <div key={i} className="p-4"><Skeleton className="h-3.5 w-3/4" /><Skeleton className="mt-3 h-5 w-40" /></div>)}</div>;
}

/* ───────────────────────── Detail ───────────────────────── */
function PanelTop({ eyebrow, children, onClose, mobile, title }) {
  if (mobile) return <MobileSubHeader title={title || eyebrow} onBack={onClose} actions={children} />;
  return (
    <div className="flex h-[68px] shrink-0 items-center gap-2 px-6 pt-1">
      <p className="eyebrow flex-1">{eyebrow}</p>
      {children}
      {onClose && <IconButton icon={X} label="Close panel (Esc)" onClick={onClose} />}
    </div>
  );
}

function MemoryDetail({ wid, mid, onClose, onEvidence, canEdit, mobile, base, onOpen }) {
  const { data: m, error, reload, setData } = useResource(() => (mid.includes(":") ? Promise.resolve(null) : v2.memoryItem(wid, mid)), [wid, mid]);
  const navigate = useNavigate();
  const ask = useAskPanel();
  const [editing, setEditing] = useState(false);
  const [incorrect, setIncorrect] = useState(false);
  const [sheetEv, setSheetEv] = useState(null);
  useEffect(() => { setEditing(false); }, [mid]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !editing && !incorrect) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, editing, incorrect]);

  if (mid.includes(":")) { // pending proposal → review
    navigate(`${base}/review/${mid.split(":")[0]}`);
    return null;
  }
  if (error) return <div className="p-6 text-body-s text-fg-tertiary">This memory no longer exists.</div>;
  const label = m ? SINGULAR[m.category] || "Memory" : "Memory";
  const actions = (
    <>
      {!mobile && <IconButton icon={Pencil} label="Edit" onClick={() => setEditing(true)} disabled={!canEdit || !m} />}
      <Menu>
        <MenuTrigger asChild><IconButton icon={MoreHorizontal} label="More" size={mobile ? "l" : "m"} disabled={!m} /></MenuTrigger>
        <MenuContent className="w-[220px]">
          <MenuItem icon={Pencil} disabled={!canEdit} onSelect={() => setEditing(true)}>Edit</MenuItem>
          <MenuItem icon={Copy} onSelect={() => { navigator.clipboard?.writeText(window.location.href); toast("Link copied"); }}>Copy link</MenuItem>
          <MenuItem icon={MessageCircleQuestion} onSelect={() => ask.open(`Tell me about: ${m.title}`)}>Ask about this</MenuItem>
          <MenuSeparator />
          <MenuItem icon={X} danger disabled={!canEdit} onSelect={() => setIncorrect(true)}>Mark as incorrect</MenuItem>
        </MenuContent>
      </Menu>
    </>
  );
  return (
    <>
      <PanelTop eyebrow={label} title={label} onClose={onClose} mobile={mobile}>{actions}</PanelTop>
      <div className={cn("scroll-pane flex-1 min-h-0 px-6 pb-6", mobile && "px-4 pt-4")}>
        {!m ? <div className="space-y-3"><Skeleton className="h-5 w-3/4" /><Skeleton className="h-4 w-1/2" /><Skeleton className="mt-6 h-20 w-full rounded-lg" /></div> : (
          <motion.div key={m.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={T.base} className="space-y-6">
            <AnimatePresence mode="popLayout" initial={false}>
              {editing && !mobile ? (
                <EditMemory key="edit" m={m} wid={wid} onCancel={() => setEditing(false)} onSaved={(n) => { setData(n); setEditing(false); refreshAll(); reload(); }} />
              ) : (
                <motion.div key="view" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={T.fast} className="space-y-3">
                  <h2 className="text-title-m text-fg">{m.title}</h2>
                  {m.category === "commitment" && <Fields m={m} />}
                  {m.detail && m.category !== "commitment" && <p className="text-[12px] text-fg-secondary">{m.detail}</p>}
                  <Confidence level={m.confidence} />
                </motion.div>
              )}
            </AnimatePresence>

            <section>
              <div className="mb-3 flex items-center"><p className="eyebrow flex-1">Evidence · {m.evidence.length}</p>{!mobile && <span className="text-[12px] font-medium text-fg-tertiary">Why Bracket believes this</span>}</div>
              <div className="space-y-3">
                {m.evidence.map((e) => (
                  <button key={e.id} onClick={() => (mobile ? setSheetEv(e) : onEvidence(e.id))} className="group block w-full rounded-md border border-line bg-surface p-3 text-left transition-colors duration-fast hover:border-line-strong">
                    <span className="flex items-center gap-2">
                      <SourceMark provider={e.provider === "notes" ? "notes" : e.provider} size={16} />
                      <span className="text-[12px] font-medium text-fg">{e.author}</span>
                      <span className="flex-1 truncate text-[12px] font-medium text-fg-tertiary">{mobile ? fmt(e.at, "MMM d, HH:mm") : `${e.where} · ${fmt(e.at, "MMM d, HH:mm")}`}</span>
                      <ExternalLink size={14} className="text-fg-tertiary transition-colors duration-fast group-hover:text-fg" />
                    </span>
                    <span className="mt-2 block text-[12px] text-fg-secondary">“{e.quote}”</span>
                  </button>
                ))}
                {!m.evidence.length && <p className="text-[12px] text-fg-tertiary">Added manually — no source.</p>}
              </div>
            </section>

            <Collapsible title="History" count={m.history.length} mobile={mobile}>
              <ol className="space-y-3">
                {m.history.map((h, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="w-11 shrink-0 font-mono text-[12px] text-fg-tertiary">{fmt(h.at)}</span>
                    <span className={cn("mt-[5px] h-[7px] w-[7px] shrink-0 rounded-full", i === 0 ? "bg-fg" : "bg-white/[0.14]")} />
                    <span className={cn("text-[12px]", i === 0 ? "text-fg" : "text-fg-tertiary")}>{h.text}</span>
                  </li>
                ))}
                {(m.versions || []).slice().reverse().map((v, i) => (
                  <li key={`v${i}`} className="flex gap-3">
                    <span className="w-11 shrink-0 font-mono text-[12px] text-fg-tertiary">{fmt(v.superseded_at)}</span>
                    <span className="mt-[5px] h-[7px] w-[7px] shrink-0 rounded-full bg-white/[0.14]" />
                    <span className="text-[12px] text-fg-tertiary"><span className="line-through">{v.title}</span>{canEdit && <> · <button className="text-fg-secondary hover:text-fg" onClick={async () => { await v2.editMemory(wid, m.id, { title: v.title }); refreshAll(); reload(); toast.success("Previous version restored", { description: "The replaced version stays in history." }); }}>Restore</button></>}</span>
                  </li>
                ))}
              </ol>
            </Collapsible>

            {(m.related.length > 0 || m.pending_change) && (
              <Collapsible title="Related" count={m.related.length + (m.pending_change ? 1 : 0)} mobile={mobile} gap={2}>
                <div className="space-y-2">
                  {m.related.map((r) => (
                    <button key={r.id} onClick={() => onOpen(r.id)} className="flex w-full items-center gap-3 rounded-md border border-line-subtle py-2 pr-2 pl-3 text-left transition-colors duration-fast hover:bg-hover">
                      <span className="min-w-0 flex-1"><span className="block text-[12px] font-medium text-fg-tertiary">{SINGULAR[r.category]}</span><span className="block truncate text-[12px] text-fg">{r.title}</span></span>
                      <ChevronRight size={16} className="text-fg-tertiary" />
                    </button>
                  ))}
                </div>
              </Collapsible>
            )}
            {m.pending_change && (
              <Link to={`${base}/review/${m.pending_change.review_id}`} className="flex items-center gap-3 rounded-md border border-warning py-2 pr-2 pl-3 transition-colors duration-fast hover:bg-warning/[0.06]">
                <AlertTriangle size={16} className="shrink-0 text-warning" />
                <span className="min-w-0 flex-1">{!mobile && <span className="block text-[12px] font-medium text-warning">Pending change</span>}<span className="block text-[12px] text-fg">{mobile ? "A pending change may affect this date" : m.pending_change.text}</span></span>
                <ChevronRight size={16} className="text-fg-tertiary" />
              </Link>
            )}

            {!mobile && (
              <div className="flex gap-2">
                <Button size="s" icon={MessageCircleQuestion} onClick={() => ask.open(`Tell me about: ${m.title}`)}>Ask about this</Button>
                <Button size="s" variant="ghost" onClick={() => setIncorrect(true)} disabled={!canEdit}>Mark as incorrect</Button>
              </div>
            )}
          </motion.div>
        )}
      </div>
      {mobile && m && (
        <div className="flex shrink-0 gap-2 border-t border-line-subtle px-4 pt-3 pb-3 safe-bottom">
          <Button size="l" className="flex-1" icon={MessageCircleQuestion} onClick={() => ask.open(`Tell me about: ${m.title}`)}>Ask about this</Button>
          <Button size="l" className="flex-1" icon={Pencil} onClick={() => setEditing(true)} disabled={!canEdit}>Edit</Button>
        </div>
      )}
      {mobile && <EditSheet open={editing} onOpenChange={setEditing} m={m} wid={wid} onSaved={(n) => { setData(n); setEditing(false); refreshAll(); reload(); }} />}
      {mobile && <EvidenceSheet wid={wid} ev={sheetEv} onOpenChange={(o) => !o && setSheetEv(null)} />}
      {m && <MarkIncorrect open={incorrect} onOpenChange={setIncorrect} m={m} wid={wid} onDone={() => { setIncorrect(false); refreshAll(); onClose(); }} />}
    </>
  );
}

function Fields({ m }) {
  return (
    <div className="flex flex-wrap gap-6">
      {[["Owner", m.owner], ["Owed to", m.owed_to], ["Due", m.due ? fmt(m.due, "EEE, MMM d") : m.promised_at ? `Promised ${fmt(m.promised_at)}` : "No date"]].map(([k, v]) => (
        <div key={k}><p className="text-[12px] font-medium text-fg-tertiary">{k}</p><p className="mt-0.5 text-[12px] font-medium text-fg">{v || "—"}</p></div>
      ))}
    </div>
  );
}

function Collapsible({ title, count, mobile, children }) {
  const [open, setOpen] = useState(!mobile);
  if (!mobile) return <section><p className="eyebrow mb-3">{title}</p>{children}</section>;
  return (
    <section className="border-t border-line-subtle pt-3">
      <button onClick={() => setOpen((o) => !o)} className="flex h-10 w-full items-center gap-2 text-left">
        <span className="text-[12px] font-medium text-fg-secondary">{title}</span><span className="font-mono text-[12px] text-fg-tertiary">{count}</span>
        <span className="flex-1" />
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={T.fast}><ChevronDown size={16} className="text-fg-tertiary" /></motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={T.base} className="overflow-hidden"><div className="pt-2 pb-1">{children}</div></motion.div>}
      </AnimatePresence>
    </section>
  );
}

function EditMemory({ m, wid, onCancel, onSaved }) {
  const [title, setTitle] = useState(m.title);
  const [owner, setOwner] = useState(m.owner || "");
  const [owed, setOwed] = useState(m.owed_to || "");
  const [due, setDue] = useState(m.due ? m.due.slice(0, 10) : "");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const body = { title: title.trim() };
      if (m.category === "commitment") Object.assign(body, { owner, owed_to: owed, due: due ? new Date(`${due}T09:00:00`).toISOString() : null });
      const n = await v2.editMemory(wid, m.id, body);
      toast.success("New version saved", { description: "The original stays in history with its sources." });
      onSaved(n);
    } catch (e) { toast.error(e?.response?.data?.detail || "Couldn’t save"); } finally { setBusy(false); }
  };
  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={T.base} className="space-y-3">
      <label className="block text-[12px] font-medium text-fg-secondary" htmlFor="m-title">What’s true now</label>
      <Input id="m-title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus onKeyDown={(e) => { if (e.key === "Escape") onCancel(); if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save(); }} />
      <p className="text-[12px] text-fg-tertiary">Saved as a new version by you. The original stays in history with its sources.</p>
      {m.category === "commitment" && (
        <div className="grid grid-cols-3 gap-3">
          <label className="text-[12px] font-medium text-fg-tertiary">Owner<Input className="mt-1" value={owner} onChange={(e) => setOwner(e.target.value)} /></label>
          <label className="text-[12px] font-medium text-fg-tertiary">Owed to<Input className="mt-1" value={owed} onChange={(e) => setOwed(e.target.value)} /></label>
          <label className="text-[12px] font-medium text-fg-tertiary">Due<Input className="mt-1" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
        </div>
      )}
      <Confidence level={m.confidence} />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" onClick={save} loading={busy} disabled={!title.trim()}>Save version</Button>
      </div>
    </motion.div>
  );
}

function MarkIncorrect({ open, onOpenChange, m, wid, onDone }) {
  const [reason, setReason] = useState(null);
  const [fix, setFix] = useState("");
  useEffect(() => { if (open) { setReason(null); setFix(""); } }, [open]);
  const save = async () => {
    if (fix.trim()) {
      await v2.editMemory(wid, m.id, { title: fix.trim() });
      toast.success("Correction saved", { description: "Bracket keeps your correction as the current version and records why." });
    } else {
      await v2.markIncorrect(wid, m.id, reason);
      toast("Removed from memory", { description: "It stays in Timeline in case you need it.", action: { label: "Undo", onClick: async () => { await v2.restoreMemory(wid, m.id); refreshAll(); } } });
    }
    onDone();
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Mark as incorrect"
      footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" onClick={save}>{fix.trim() ? "Save correction" : "Remove from memory"}</Button></>}>
      <p className="text-[12px] font-medium text-fg-secondary">What’s wrong with this memory?</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {["Never agreed", "Out of date", "Wrong person", "Wrong date", "Other"].map((x) => (
          <button key={x} onClick={() => setReason(x)} className={cn("h-8 rounded-md border px-3 text-[12px] font-medium transition-colors duration-fast", reason === x ? "border-fg bg-selected text-fg" : "border-line-control text-fg-secondary hover:text-fg")}>{x}</button>
        ))}
      </div>
      <label className="mt-4 block text-[12px] font-medium text-fg-secondary" htmlFor="fix">Correct version (optional)</label>
      <Input id="fix" className="mt-2" value={fix} onChange={(e) => setFix(e.target.value)} placeholder={m.title} />
      <p className="mt-2 text-[12px] text-fg-tertiary">Bracket keeps your correction as the current version and records why.</p>
    </Dialog>
  );
}

/* ───────────────────────── Source viewer ───────────────────────── */
function SourceViewer({ wid, eid, onBack, onClose, mobile }) {
  const { data: s } = useResource(() => v2.evidence(wid, eid), [wid, eid]);
  const label = s ? `Source · ${s.label}` : "Source";
  return (
    <>
      <PanelTop eyebrow={label} title={s?.label || "Source"} onClose={onClose || onBack} mobile={mobile}>
        {!mobile && <IconButton icon={MoreHorizontal} label="More" />}
      </PanelTop>
      <div className={cn("scroll-pane flex-1 min-h-0 px-4 pb-4", !mobile && "px-4")}>
        {!s ? <Skeleton className="h-40 w-full rounded-lg" /> : (
          <motion.div initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={T.base}>
            <div className="flex items-start gap-2">
              <SourceMark provider={s.provider === "notes" ? "notes" : s.provider} size={16} />
              <div><p className="text-body-m text-fg">{s.title}</p><p className="text-[12px] text-fg-tertiary">{s.meta}</p></div>
            </div>
            {s.messages && (
              <div className="mt-4 space-y-1">
                {s.messages.map((msg, i) => (
                  <div key={i} className={cn("flex gap-3 rounded-md px-0 py-2", msg.highlight && "border-l-2 border-fg bg-surface px-3")}>
                    <Avatar name={msg.author} size="s" />
                    <div><p className="flex items-baseline gap-2 text-[12px] font-medium text-fg">{msg.author}<span className="font-mono font-normal text-fg-tertiary">{format(new Date(msg.at), "HH:mm")}</span></p><p className="mt-0.5 text-body-m text-fg-secondary">{msg.text}</p></div>
                  </div>
                ))}
              </div>
            )}
            {s.note && (
              <div className="mt-4 rounded-lg border border-line bg-surface p-4 text-[12px] leading-[18px] text-fg-secondary">
                {s.note.body.split("\n").map((line, i) => (
                  line.includes(s.note.highlight.slice(0, 18))
                    ? <p key={i} className="my-1 border-l-2 border-fg bg-raised py-1.5 pl-2 text-fg">{line}</p>
                    : <p key={i} className={line ? "" : "h-3"}>{line}</p>
                ))}
              </div>
            )}
            {s.memory_from?.length > 0 && (
              <div className="mt-5">
                <p className="eyebrow mb-3">Memory from this {s.note ? "note" : "message"} · {s.memory_from.length}</p>
                {s.memory_from.map((x) => (
                  <div key={x.id} className="mb-2 border-l border-line pl-3"><p className="text-[12px] text-fg-tertiary">{x.category}</p><p className="text-[12px] text-fg">{x.text}</p></div>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </div>
      {s && (
        <div className="flex shrink-0 gap-2 px-4 py-4">
          {s.link && <Button size="s" icon={ExternalLink} onClick={() => window.open(s.link, "_blank", "noopener")}>Open in {s.provider === "slack" ? "Slack" : s.provider === "gmail" ? "Gmail" : "source"}</Button>}
          <Button size="s" variant="ghost" icon={ArrowLeft} onClick={onBack}>Back to memory</Button>
        </div>
      )}
    </>
  );
}

/* ───────────────────────── Person ───────────────────────── */
function PersonDetail({ wid, pid, onClose, mobile, base }) {
  const { data: p } = useResource(() => v2.person(wid, pid), [wid, pid]);
  const ask = useAskPanel();
  const navigate = useNavigate();
  const first = p?.name.split(" ")[0];
  return (
    <>
      <PanelTop eyebrow="Person" title={p?.name || "Person"} onClose={onClose} mobile={mobile}>
        {!mobile && <IconButton icon={Pencil} label="Edit" />}
        <IconButton icon={MoreHorizontal} label="More" size={mobile ? "l" : "m"} />
      </PanelTop>
      {mobile ? (p ? <MobilePerson p={p} base={base} /> : <div className="p-4"><Skeleton className="h-40 w-full rounded-lg" /></div>) : (
      <div className="scroll-pane flex-1 min-h-0 px-6 pb-6">
        {!p ? <Skeleton className="h-40 w-full rounded-lg" /> : (
          <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={T.base} className="space-y-6">
            <div className="flex items-center gap-3">
              <Avatar name={p.name} size="l" />
              <div className="min-w-0"><p className="text-title-m text-fg">{p.name}</p><p className="truncate text-[12px] text-fg-tertiary">{p.role} · {p.org.replace(" (you)", "")} · {p.email}</p></div>
            </div>
            <dl className="space-y-3">
              <div><dt className="text-[12px] text-fg-tertiary">Role in this work</dt><dd className="text-[12px] text-fg">{p.role_in_work}</dd></div>
              <div><dt className="text-[12px] text-fg-tertiary">Approves</dt><dd className="text-[12px] text-fg">{p.approves}</dd>{p.approves_confidence === "low" && <dd className="mt-0.5"><Confidence level="low" /></dd>}</div>
              <div><dt className="text-[12px] text-fg-tertiary">Prefers</dt><dd className="text-[12px] text-fg">{p.prefers}</dd></div>
            </dl>
            {p.open?.length > 0 && (
              <section>
                <p className="eyebrow mb-3">Open with {first}</p>
                <div className="space-y-3">
                  {p.open.map((o, i) => (
                    <button key={i} onClick={() => navigate(o.thread_id ? `${base}/conversations/${o.thread_id}` : `${base}/memory/commitment?item=${o.id}`)} className="block w-full border-l border-line pl-3 text-left hover:border-fg">
                      <span className="block text-[12px] text-fg-tertiary">{o.kind}</span><span className="block text-[12px] text-fg">{o.text}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}
            {p.recent?.length > 0 && (
              <section>
                <p className="eyebrow mb-2">Recent</p>
                {p.recent.map((r) => (
                  <Link key={r.id} to={`${base}/conversations/${r.id}`} className="flex h-10 items-center gap-3 rounded-md px-1 hover:bg-hover">
                    <SourceMark provider={r.provider === "notes" ? "notes" : r.provider} size={14} />
                    <span className="flex-1 truncate text-[12px] text-fg-secondary">{r.title}</span>
                    <span className="font-mono text-[12px] text-fg-tertiary">{shortTime(r.at)}</span>
                  </Link>
                ))}
              </section>
            )}
            <div className="flex gap-2">
              <Button size="s" icon={MessageCircleQuestion} onClick={() => ask.open(`What do we know about ${p.name}?`)}>Ask about {first}</Button>
              <Button size="s" variant="ghost" icon={Mail} onClick={() => navigate(`${base}/conversations?new=1&to=${encodeURIComponent(p.email)}`)}>Email {first}</Button>
            </div>
          </motion.div>
        )}
      </div>
      )}
    </>
  );
}

