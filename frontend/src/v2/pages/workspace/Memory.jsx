import React, { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Search, Plus, Pencil, Trash2, MoreHorizontal, Check, X, Reply, MessageCircleQuestion, Layers, Copy, Mail, ExternalLink, ArrowLeft,
} from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "../../lib/workspace";
import {
  api, formatApiError, CATEGORIES, CATEGORY, catLabel, catSingular, STATUS, isPending, shortTime, longDate, timeAgo, toDate,
} from "../../lib/data";
import {
  Badge, Button, Card, EmptyState, EvidenceChip, Field, IconButton, Input, NativeSelect, Segmented, Skeleton, Textarea, providerLabel,
} from "../../ui/primitives";
import { Dialog, Menu, MenuTrigger, MenuContent, MenuItem, MenuSeparator, SidePanel } from "../../ui/overlays";
import { useMedia, useIsMobile } from "../../lib/useMedia";
import { cn } from "../../../lib/utils";

const VIEWS = [
  { key: "all", label: "All memory" },
  { key: "needs", label: "Needs review" },
  { key: "recent", label: "Recently changed" },
];

export default function Memory() {
  const ws = useWorkspace();
  const { memory, items, pending, projectId, refresh } = ws;
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const wide = useMedia("(min-width: 1280px)");
  const mobile = useIsMobile();
  const cat = params.get("cat") || "";
  const view = params.get("view") || (cat ? "" : "all");
  const itemId = params.get("item");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("current"); // current | proposed | dismissed? (current incl. confirmed+context)
  const [adding, setAdding] = useState(false);

  const setParam = (patch) => {
    const n = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k)));
    setParams(n, { replace: true });
  };

  const week = Date.now() - 7 * 864e5;
  const list = useMemo(() => {
    let l = items;
    if (cat) l = l.filter((m) => m.display_category === cat);
    if (view === "needs") l = l.filter(isPending);
    else if (view === "recent") l = l.filter((m) => toDate(m.updated_at)?.getTime() > week);
    else if (cat) l = status === "proposed" ? l.filter(isPending) : l.filter((m) => !isPending(m));
    if (q.trim()) {
      const s = q.toLowerCase();
      l = l.filter((m) => `${m.title} ${m.detail} ${m.requested_by} ${m.source_label}`.toLowerCase().includes(s));
    }
    return [...l].sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
  }, [items, cat, view, status, q, week]);

  const selected = items.find((m) => m.id === itemId) || null;
  const recentCount = items.filter((m) => toDate(m.updated_at)?.getTime() > week).length;
  const heading = cat ? catLabel(cat) : VIEWS.find((v) => v.key === view)?.label || "All memory";

  if (!memory) {
    return <div className="p-8 space-y-3" aria-busy="true"><Skeleton className="h-8 w-60" /><Skeleton className="h-14" /><Skeleton className="h-14" /><Skeleton className="h-14" /></div>;
  }

  const nav = (
    <nav aria-label="Memory views" className="space-y-0.5">
      {VIEWS.map((v) => (
        <NavRow key={v.key} active={!cat && view === v.key} onClick={() => setParam({ view: v.key === "all" ? "" : v.key, cat: "", item: "" })} label={v.label}
          count={v.key === "all" ? memory.total : v.key === "needs" ? pending.length : recentCount} dot={v.key === "needs" && pending.length > 0} />
      ))}
      <p className="eyebrow px-2 pt-5 pb-1.5">Discovered categories</p>
      {CATEGORIES.filter((c) => (memory.counts?.[c.key] || 0) > 0).map((c) => (
        <NavRow key={c.key} active={cat === c.key} onClick={() => setParam({ cat: c.key, view: "", item: "" })} label={c.label}
          count={memory.counts[c.key]} dot={(memory.grouped?.[c.key] || []).some(isPending)} />
      ))}
      <p className="px-2 pt-4 text-body-s text-fg-tertiary">Bracket organizes memory into categories based on what it finds in your sources.</p>
      <button onClick={() => setAdding(true)} className="mt-2 flex h-8 w-full items-center gap-2 rounded-md px-2 text-body-m text-fg-secondary hover:bg-hover hover:text-fg">
        <Plus size={14} /> Add to memory
      </button>
    </nav>
  );

  const detail = selected && (
    <MemoryDetail item={selected} onClose={() => setParam({ item: "" })} onChanged={() => refresh("memory", "history")} projectId={projectId} />
  );

  return (
    <div className="flex h-full min-h-0">
      {/* Category nav */}
      <aside className="hidden lg:block w-[240px] shrink-0 scroll-pane border-r border-line-subtle px-2 py-5">
        <h1 className="px-2 pb-3 text-title-m">Memory</h1>
        {nav}
      </aside>

      {/* List */}
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="border-b border-line-subtle px-4 py-4 md:px-6">
          <div className="flex items-center gap-3">
            <h2 className="text-title-l text-fg flex-1 truncate">{heading} <span className="num text-body-m text-fg-tertiary">{list.length}</span></h2>
            <Button size="s" variant="secondary" icon={Plus} onClick={() => setAdding(true)} className="lg:hidden">Add</Button>
          </div>
          {cat && <p className="mt-0.5 text-body-s text-fg-tertiary">{CATEGORY_HELP[cat] || ""}</p>}
          {/* mobile category chips */}
          <div className="lg:hidden -mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1">
            {[{ key: "", label: "All", count: memory.total }, { key: "needs", label: "Needs review", count: pending.length }, ...CATEGORIES.filter((c) => memory.counts?.[c.key]).map((c) => ({ key: c.key, label: c.label, count: memory.counts[c.key], isCat: true }))].map((c) => {
              const active = c.isCat ? cat === c.key : !cat && (c.key === "needs" ? view === "needs" : view !== "needs" && view !== "recent");
              return (
                <button key={c.label} onClick={() => setParam(c.isCat ? { cat: c.key, view: "" } : { cat: "", view: c.key })}
                  className={cn("inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-body-s", active ? "border-line-strong bg-selected text-fg" : "border-line text-fg-secondary")}>
                  {c.label} <span className="num text-fg-tertiary">{c.count}</span>
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {cat && (
              <Segmented size="s" value={status} onChange={setStatus}
                options={[{ value: "current", label: "Current" }, { value: "proposed", label: "Proposed", count: (memory.grouped?.[cat] || []).filter(isPending).length }]} />
            )}
            <div className="relative ml-auto w-full sm:w-64">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-tertiary" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Filter ${heading.toLowerCase()}`} className="h-8 pl-8" aria-label="Filter memory" />
            </div>
          </div>
        </div>
        <div className="scroll-pane flex-1 min-h-0">
          {list.length === 0 ? (
            <EmptyState icon={Layers} title={q ? "No matches" : view === "needs" ? "Nothing needs review" : "Nothing here yet"}
              action={!q && <Button icon={Plus} onClick={() => setAdding(true)}>Add to memory</Button>}>
              {q ? "Try a different word, or clear the filter." : "Bracket fills this in as it reads your connected sources. You can also add something yourself — a phone call, a hallway decision."}
            </EmptyState>
          ) : (
            <ul>
              {list.map((m) => (
                <li key={m.id}>
                  <button onClick={() => setParam({ item: m.id })} className={cn("w-full border-b border-line-subtle px-4 py-3 text-left hover:bg-hover md:px-6", m.id === itemId && "bg-selected")}>
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        {!cat && <p className="eyebrow mb-0.5">{catSingular(m.display_category)}</p>}
                        <p className="text-body-m text-fg">{m.title}</p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-body-s text-fg-tertiary">
                          <EvidenceChip provider={m.provider}>{[m.source_label || providerLabel(m.provider), shortTime(m.created_at)].filter(Boolean).join(" · ")}</EvidenceChip>
                          {m.requested_by && <span className="truncate">From {m.requested_by}</span>}
                        </div>
                      </div>
                      {isPending(m) ? <Badge tone="warning" dot>{m.is_scope_change ? "Scope change" : "Proposed"}</Badge>
                        : m.status === "context" ? <Badge>Context</Badge> : null}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Detail */}
      {wide ? (
        selected && <aside className="w-[400px] shrink-0 border-l border-line-subtle">{detail}</aside>
      ) : (
        <SidePanel open={!!selected} onOpenChange={(o) => !o && setParam({ item: "" })} title={selected ? catSingular(selected.display_category) : "Memory"}>
          {selected && <MemoryDetailBody item={selected} onClose={() => setParam({ item: "" })} onChanged={() => refresh("memory", "history")} projectId={projectId} />}
        </SidePanel>
      )}

      <AddMemoryDialog open={adding} onOpenChange={setAdding} projectId={projectId} defaultCat={cat} onAdded={() => refresh("memory", "history")} />
    </div>
  );
}

const CATEGORY_HELP = {
  scope: "What’s included in this work — and what isn’t.",
  decision: "Choices that were made, by whom, and when.",
  deliverable: "What you’ve promised to hand over.",
  requirement: "Conditions the work has to meet.",
  deadline: "Dates someone has agreed to.",
  timeline: "Milestones and sequencing.",
  question: "Things still waiting on an answer.",
};

function NavRow({ label, count, active, onClick, dot }) {
  return (
    <button onClick={onClick} className={cn("flex h-8 w-full items-center gap-2 rounded-md px-2 text-body-m transition-colors", active ? "bg-selected text-fg" : "text-fg-secondary hover:bg-hover hover:text-fg")}>
      <span className="flex-1 truncate text-left">{label}</span>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-warning" aria-label="Has proposed changes" />}
      <span className="num text-body-s text-fg-tertiary">{count}</span>
    </button>
  );
}

/* ───────── Detail ───────── */
function MemoryDetail(props) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-line-subtle px-5">
        <p className="eyebrow">{catSingular(props.item.display_category)}</p>
        <IconButton icon={X} label="Close" onClick={props.onClose} />
      </div>
      <div className="scroll-pane flex-1 px-5 py-5"><MemoryDetailBody {...props} /></div>
    </div>
  );
}

function MemoryDetailBody({ item, onChanged, onClose, projectId }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null);
  const st = STATUS[item.status] || STATUS.confirmed;

  const act = async (action, msg) => {
    setBusy(action);
    try {
      await api.post(`/connect/memory/${item.id}/action`, { action });
      toast.success(msg);
      onChanged();
    } catch (e) { toast.error(formatApiError(e)); } finally { setBusy(null); }
  };
  const remove = async () => {
    setBusy("delete");
    try {
      await api.delete(`/connect/memory/${item.id}`);
      toast.success("Removed from memory");
      onClose();
      onChanged();
    } catch (e) { toast.error(formatApiError(e)); } finally { setBusy(null); }
  };
  const suggest = async () => {
    setBusy("reply");
    try {
      const { data } = await api.post(`/connect/memory/${item.id}/suggest-reply`);
      setDraft(data);
    } catch (e) { toast.error(formatApiError(e)); } finally { setBusy(null); }
  };

  const history = [...(item.history || [])].reverse();
  return (
    <div>
      <div className="flex items-start gap-2">
        <h3 className="flex-1 text-title-l text-fg">{item.title}</h3>
        <Menu>
          <MenuTrigger asChild><IconButton icon={MoreHorizontal} label="More actions" /></MenuTrigger>
          <MenuContent>
            <MenuItem icon={Pencil} onSelect={() => setEditing(true)}>Edit</MenuItem>
            {item.status !== "context" && <MenuItem onSelect={() => act("context", "Kept as context")}>Keep as context only</MenuItem>}
            {isPending(item) && <MenuItem onSelect={() => act("not_a_change", "Marked as not a change")}>Not a change</MenuItem>}
            <MenuSeparator />
            <MenuItem icon={Trash2} danger onSelect={remove}>Remove from memory</MenuItem>
          </MenuContent>
        </Menu>
      </div>
      {item.detail && <p className="mt-2 text-body-m text-fg-secondary whitespace-pre-wrap">{item.detail}</p>}

      <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        <Meta label="Status"><Badge tone={st.tone} dot>{st.label}</Badge></Meta>
        {item.requested_by && <Meta label="From">{item.requested_by}</Meta>}
        <Meta label="Added">{longDate(item.created_at)}</Meta>
      </dl>

      {isPending(item) && (
        <div className="mt-5 flex gap-2">
          <Button variant="primary" icon={Check} loading={busy === "confirm"} onClick={() => act("confirm", "Confirmed — memory updated")}>Confirm</Button>
          <Button variant="secondary" icon={X} loading={busy === "dismiss"} onClick={() => act("dismiss", "Dismissed")}>Dismiss</Button>
        </div>
      )}

      <div className="mt-7">
        <p className="eyebrow mb-2">Evidence</p>
        <Card className="p-3">
          <div className="flex items-center gap-2">
            <EvidenceChip provider={item.provider}>{item.source_label || providerLabel(item.provider)}</EvidenceChip>
            <span className="text-body-s text-fg-tertiary">{timeAgo(item.occurred_at || item.created_at)}</span>
          </div>
          {item.connection_id && !["manual", "bracket"].includes(item.connection_id) && (
            <button onClick={() => navigate(`/w/${projectId}/conversations?c=${item.connection_id}`)} className="mt-2 inline-flex items-center gap-1 text-body-s text-fg-tertiary hover:text-fg">
              Open conversation <ExternalLink size={12} />
            </button>
          )}
        </Card>
      </div>

      {history.length > 0 && (
        <div className="mt-7">
          <p className="eyebrow mb-2">History</p>
          <ol className="relative space-y-3 border-l border-line pl-4">
            {history.map((h, i) => (
              <li key={i} className="text-body-s">
                <span className="absolute -left-[3.5px] mt-1.5 h-1.5 w-1.5 rounded-full bg-fg-tertiary" aria-hidden="true" />
                <span className="font-mono text-mono-s text-fg-tertiary">{shortTime(h.at)}</span>
                <span className="ml-2 text-fg-secondary">{describeHistory(h)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="mt-7 flex flex-wrap gap-2 border-t border-line-subtle pt-4">
        <Button variant="secondary" icon={MessageCircleQuestion} onClick={() => navigate(`/w/${projectId}/ask?q=${encodeURIComponent(`Tell me about: ${item.title}`)}`)}>Ask about this</Button>
        <Button variant="ghost" icon={Reply} loading={busy === "reply"} onClick={suggest}>Draft a reply</Button>
      </div>

      <EditMemoryDialog open={editing} onOpenChange={setEditing} item={item} onSaved={onChanged} />
      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)} title="Draft reply" description="Written by Bracket from this memory · not sent"
        footer={draft && (
          <>
            <Button variant="ghost" icon={Copy} onClick={() => { navigator.clipboard.writeText(draft.reply || ""); toast.success("Copied"); }}>Copy</Button>
            <Button variant="primary" icon={Mail} onClick={() => window.open(draft.deep_links?.gmail_web, "_blank", "noopener")}>Open in Gmail</Button>
          </>
        )}>
        {draft && <DraftBody draft={draft} />}
      </Dialog>
    </div>
  );
}

function DraftBody({ draft }) {
  return (
    <div>
      <div className="rounded-lg border border-line bg-surface p-4 text-body-m text-fg whitespace-pre-wrap">{draft.reply}</div>
      {(draft.impacts || []).length > 0 && (
        <div className="mt-4">
          <p className="eyebrow mb-2">What this affects</p>
          <ul className="space-y-1 text-body-s text-fg-secondary list-disc pl-5">
            {draft.impacts.map((im, i) => <li key={i}>{typeof im === "string" ? im : im.detail || im.text}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function Meta({ label, children }) {
  return (
    <div className="min-w-0">
      <dt className="text-body-s text-fg-tertiary">{label}</dt>
      <dd className="mt-0.5 truncate text-body-m text-fg">{children}</dd>
    </div>
  );
}

function describeHistory(h) {
  if (h.created) return h.via === "project_update" ? "Added by an accepted update" : "Added";
  if (h.deleted) return "Removed";
  if (h.edit) return `Edited ${Object.keys(h.edit).join(", ")}`;
  if (h.to) return { confirmed: "Confirmed", ignored: "Dismissed", detected: "Back in review", not_a_change: "Marked as not a change", review: "Sent to review", context: "Kept as context" }[h.to] || `Status → ${h.to}`;
  return "Updated";
}

/* ───────── Dialogs ───────── */
function EditMemoryDialog({ open, onOpenChange, item, onSaved }) {
  const [title, setTitle] = useState(item.title);
  const [detail, setDetail] = useState(item.detail || "");
  const [category, setCategory] = useState(item.display_category);
  const [busy, setBusy] = useState(false);
  React.useEffect(() => { if (open) { setTitle(item.title); setDetail(item.detail || ""); setCategory(item.display_category); } }, [open, item]);
  const save = async () => {
    setBusy(true);
    try {
      await api.patch(`/connect/memory/${item.id}`, { title, detail, category });
      toast.success("Saved — logged in the timeline");
      onOpenChange(false);
      onSaved();
    } catch (e) { toast.error(formatApiError(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Edit memory" description="Edits are saved to memory and logged in the timeline with you as the source."
      footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" loading={busy} disabled={!title.trim()} onClick={save}>Save changes</Button></>}>
      <div className="space-y-4">
        <Field label="Title" htmlFor="m-title"><Input id="m-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Detail" htmlFor="m-detail"><Textarea id="m-detail" rows={4} maxLength={800} value={detail} onChange={(e) => setDetail(e.target.value)} /></Field>
        <Field label="Category" htmlFor="m-cat">
          <NativeSelect id="m-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </NativeSelect>
        </Field>
      </div>
    </Dialog>
  );
}

function AddMemoryDialog({ open, onOpenChange, projectId, defaultCat, onAdded }) {
  const [category, setCategory] = useState(defaultCat || "decision");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  React.useEffect(() => { if (open) { setCategory(defaultCat || "decision"); setTitle(""); setDetail(""); } }, [open, defaultCat]);
  const add = async () => {
    setBusy(true);
    try {
      await api.post(`/projects/${projectId}/memory`, { category, title: title.trim(), detail: detail.trim(), status: "confirmed" });
      toast.success("Added to memory");
      onOpenChange(false);
      onAdded();
    } catch (e) { toast.error(formatApiError(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Add to memory" description="For things that happened off the record — a call, a meeting, a hallway decision."
      footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" loading={busy} disabled={!title.trim()} onClick={add}>Add to memory</Button></>}>
      <div className="space-y-4">
        <Field label="Category" htmlFor="a-cat">
          <NativeSelect id="a-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </NativeSelect>
        </Field>
        <Field label="What was agreed" htmlFor="a-title"><Input id="a-title" autoFocus value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Launch moves to Oct 24" /></Field>
        <Field label="Detail (optional)" htmlFor="a-detail"><Textarea id="a-detail" rows={3} maxLength={800} value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="Who said it, and where" /></Field>
      </div>
    </Dialog>
  );
}
