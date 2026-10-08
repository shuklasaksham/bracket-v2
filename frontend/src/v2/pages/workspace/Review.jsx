import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, AlertTriangle, ChevronLeft, ChevronRight, ChevronDown, ExternalLink, Check, Reply, Clock, Pencil, X, Info,
  RefreshCw, CheckCircle2, RotateCcw, MoreHorizontal, GitFork,
} from "lucide-react";
import { toast } from "sonner";
import { useWorkspace, refreshAll } from "../../lib/workspace";
import { v2, errStatus } from "../../lib/api2";
import { shortTime, useResource } from "../../lib/data";
import { useIsMobile } from "../../lib/useMedia";
import { Avatar, Badge, Button, Checkbox, Confidence, IconButton, SourceMark, Skeleton, Segmented } from "../../ui/primitives";
import { Dialog, Sheet } from "../../ui/overlays";
import { Chip } from "../../ui/patterns";
import { AnimatePresence, motion, t as T, useDelayed } from "../../ui/motion";
import { MobileSubHeader } from "../../shell/AppShell";
import { cn } from "../../../lib/utils";

/* Change review — Figma › ✓ Change review — Desktop 1440, Dismiss with reason,
   Change review — edge cases, and the Mobile 390 frames (proposals / source
   email / more actions / dismiss). Keyboard: J/K move · X toggle · ⌘↵ accept ·
   ⌫ dismiss · ⌘Z undo. */

const OP = { modify: ["Modify", "warning"], add: ["Add", "info"], conflict: ["Conflict", "danger"], remove: ["Remove", "danger"] };
const CAT = { scope: "Scope", decision: "Decisions", deliverable: "Deliverables", requirement: "Requirements", commitment: "Commitments", person: "People" };
const KIND_LABEL = { scope_change: "Potential scope change", decision: "New requirement", conflict: "Conflicting information" };
const REASONS = ["Not a real request", "Already handled", "Wrong interpretation", "Other"];

export default function Review() {
  const { rid } = useParams();
  const { projectId, canEdit } = useWorkspace();
  const navigate = useNavigate();
  const base = `/w/${projectId}`;
  const mobile = useIsMobile();

  // /review with no id → first pending review
  const queue = useResource(() => v2.reviews(projectId), [projectId], { enabled: !rid });
  useEffect(() => {
    if (!rid && queue.data) {
      const first = queue.data.reviews.find((r) => !r.saved) || queue.data.reviews[0];
      if (first) navigate(`${base}/review/${first.id}`, { replace: true });
    }
  }, [rid, queue.data, base, navigate]);

  const { data: r, error, reload } = useResource(() => v2.review(projectId, rid), [projectId, rid], { enabled: !!rid });
  const [selected, setSelected] = useState(new Set());
  const [edits, setEdits] = useState({});
  const [editing, setEditing] = useState(null);
  const [focus, setFocus] = useState(0);
  const [kbd, setKbd] = useState(false); // show the row focus marker only while using J/K
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [dismissOpen, setDismissOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [tab, setTab] = useState("proposals");
  const [expanded, setExpanded] = useState(() => new Set());
  const showSkel = useDelayed(300);
  const rowRefs = useRef([]);

  useEffect(() => {
    if (r) {
      setSelected(new Set(r.proposals.filter((p) => p.confidence !== "low").map((p) => p.id)));
      setEdits({}); setFocus(0); setFailed(false);
      setExpanded(new Set([r.proposals[0]?.id]));
    }
  }, [r]);

  const toggle = useCallback((id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }), []);
  const total = r?.proposals.length || 0;
  const count = selected.size;
  const allState = count === 0 ? false : count === total ? true : "indeterminate";
  const firstName = (r?.trigger?.from || "").split(" ")[0];

  const accept = useCallback(async () => {
    if (!r || !count || busy) return;
    setBusy(true); setFailed(false);
    try {
      const res = await v2.acceptReview(projectId, r.id, [...selected], edits);
      refreshAll();
      navigate(base);
      toast.success(`${res.accepted} memories updated · ${res.impact.replace(/ \+?\d+/g, "").split(" · ").join(", ")}`, {
        duration: 10000,
        action: { label: "Undo", onClick: async () => { await v2.undoReview(projectId, r.id); refreshAll(); toast("Changes undone — nothing was lost"); } },
      });
    } catch (e) {
      if (errStatus(e) === 409) reload(); else setFailed(true);
    } finally {
      setBusy(false);
    }
  }, [r, count, busy, projectId, selected, edits, navigate, base, reload]);

  const save = async () => {
    await v2.saveReview(projectId, r.id);
    refreshAll();
    toast("Saved for later", { description: "It’s under Snoozed & saved on Overview." });
    navigate(base);
  };
  const dismiss = async (reason, note) => {
    await v2.dismissReview(projectId, r.id, reason, note);
    setDismissOpen(false);
    refreshAll();
    toast(`Dismissed ${total} proposed update${total === 1 ? "" : "s"}`, { description: "Memory stays as it is. The decision is kept in Timeline." });
    navigate(base);
  };
  const draftReply = () => navigate(`${base}/conversations/${r.trigger.thread_id}?draft=review-${r.id}`);

  // keyboard
  useEffect(() => {
    if (!r || mobile) return undefined;
    const onKey = (e) => {
      if (/INPUT|TEXTAREA/.test(e.target.tagName) || dismissOpen) return;
      const k = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && k === "enter") { e.preventDefault(); accept(); }
      else if (k === "j" || k === "arrowdown") { e.preventDefault(); setKbd(true); setFocus((f) => { const n = Math.min(total - 1, f + 1); rowRefs.current[n]?.focus(); return n; }); }
      else if (k === "k" || k === "arrowup") { e.preventDefault(); setKbd(true); setFocus((f) => { const n = Math.max(0, f - 1); rowRefs.current[n]?.focus(); return n; }); }
      else if (k === "x") { e.preventDefault(); toggle(r.proposals[focus].id); }
      else if (k === "backspace" && canEdit) { e.preventDefault(); setDismissOpen(true); }
      else if (k === "escape") navigate(base);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [r, mobile, accept, toggle, focus, total, dismissOpen, canEdit, navigate, base]);

  /* ───── empty / error states ───── */
  if (!rid && queue.data && !queue.data.reviews.length) {
    return <Done title="Nothing to review" body="Bracket will bring proposed updates here when a source changes something it remembers." onBack={() => navigate(base)} />;
  }
  if (error) {
    const resolved = errStatus(error) === 409;
    return resolved ? (
      <Done icon={CheckCircle2} title={error.response.data.detail} body="Memory is already up to date. You can see exactly what changed in Timeline."
        onBack={() => navigate(base)} extra={<Button onClick={() => navigate(`${base}/timeline`)}>View in Timeline</Button>} />
    ) : <Done title="This review no longer exists" body="It may have been replaced by a newer one." onBack={() => navigate(base)} />;
  }
  if (!r) return showSkel ? <ReviewSkeleton /> : null;

  const label = r.label || KIND_LABEL[r.kind] || "Proposed updates";
  const cats = new Set(r.proposals.map((p) => p.category)).size;
  const meta = `Detected in ${r.detected.count} ${r.detected.unit} · ${relDay(r.detected.at)} · ${total} proposed update${total === 1 ? "" : "s"} across ${cats} categor${cats === 1 ? "y" : "ies"}`;

  const proposals = (
    <ProposalList r={r} selected={selected} toggle={toggle} edits={edits} setEdits={setEdits} editing={editing} setEditing={setEditing}
      focus={focus} setFocus={setFocus} rowRefs={rowRefs} mobile={mobile} kbd={kbd} expanded={expanded} setExpanded={setExpanded} canEdit={canEdit} />
  );
  const banners = (
    <>
      {r.source_changed && (
        <EdgeBanner tone="info" icon={RefreshCw} title={r.source_changed.title} body={r.source_changed.body} action={<Button size="s">Show what changed</Button>} />
      )}
      {r.partially_resolved && (
        <EdgeBanner tone="success" icon={CheckCircle2} title={r.partially_resolved.title} body={r.partially_resolved.body} action={<Button size="s" variant="ghost" onClick={() => navigate(`${base}/timeline`)}>View in Timeline</Button>} />
      )}
      <AnimatePresence>
        {failed && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={T.base} className="overflow-hidden">
            <EdgeBanner tone="danger" icon={AlertTriangle} title={`Couldn’t save ${count} update${count === 1 ? "" : "s"}`} body="Nothing was changed. Your selections are kept."
              action={<Button size="s" variant="primary" icon={RotateCcw} onClick={accept}>Try again</Button>} />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );

  /* ───── mobile ───── */
  if (mobile) {
    return (
      <div className="flex h-full flex-col">
        <MobileSubHeader title="Review changes" onBack={() => navigate(base)} actions={<IconButton icon={MoreHorizontal} label="More actions" size="l" onClick={() => setMoreOpen(true)} />} />
        <div className="scroll-pane flex-1 min-h-0">
          <div className="px-4 pt-4">
            <p className="flex items-center gap-2 font-mono text-[12px] text-warning"><AlertTriangle size={16} /> {label}</p>
            <h1 className="mt-2 text-title-m text-fg">{r.title}</h1>
            <div className="mt-2"><Chip provider={r.trigger.provider} label={r.trigger.from} at={`${relDay(r.trigger.at)} ${shortTime(r.trigger.at)}`.replace("Today Today", "Today")} /></div>
            <Segmented className="mt-4 w-full" value={tab} onChange={setTab} options={[{ value: "proposals", label: `Proposed updates · ${total}` }, { value: "source", label: r.trigger.provider === "gmail" ? "Source email" : "Source message" }]} />
            <div className="mt-3 space-y-2">{banners}</div>
          </div>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div key={tab} initial={{ opacity: 0, x: tab === "source" ? 16 : -16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={T.base}>
              {tab === "proposals" ? <div className="mt-2 border-t border-line-subtle">{proposals}</div> : <div className="px-4 py-4"><SourceMessage trigger={r.trigger} bare /></div>}
            </motion.div>
          </AnimatePresence>
        </div>
        <div className="shrink-0 border-t border-line-subtle bg-sidebar px-4 pt-3 safe-bottom">
          <p className="text-[12px] text-fg-tertiary">{count} of {total} updates selected</p>
          <div className="mt-2 flex gap-2 pb-3">
            <IconButton icon={MoreHorizontal} label="More actions" size="l" className="border border-line bg-raised" onClick={() => setMoreOpen(true)} />
            <Button variant="primary" size="l" icon={Check} className="flex-1" disabled={!count || !canEdit} loading={busy} onClick={accept}>Accept {count} update{count === 1 ? "" : "s"}</Button>
          </div>
        </div>
        <Sheet open={moreOpen} onOpenChange={setMoreOpen} title="More actions">
          <div className="-mx-1">
            {[
              [Reply, `Draft reply to ${firstName}`, () => { setMoreOpen(false); draftReply(); }],
              [Clock, "Save for later", () => { setMoreOpen(false); save(); }],
              [Pencil, "Edit a proposed update", () => { setMoreOpen(false); setTab("proposals"); setEditing(r.proposals[0].id); setExpanded(new Set([r.proposals[0].id])); }],
              [X, "Dismiss all", () => { setMoreOpen(false); setDismissOpen(true); }, true],
            ].map(([Icon, l, fn, danger]) => (
              <button key={l} onClick={fn} disabled={!canEdit} className={cn("flex h-12 w-full items-center gap-3 rounded-md px-2 text-body-m hover:bg-hover disabled:opacity-40", danger ? "text-danger" : "text-fg")}>
                <Icon size={18} /> {l}
              </button>
            ))}
          </div>
        </Sheet>
        <DismissDialog open={dismissOpen} onOpenChange={setDismissOpen} total={total} onConfirm={dismiss} />
      </div>
    );
  }

  /* ───── desktop ───── */
  const pos = r.position || { index: 1, total: 1 };
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-4 border-b border-line-subtle px-8 py-4">
        <IconButton icon={ArrowLeft} label="Back to Overview (Esc)" onClick={() => navigate(base)} className="self-center" />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 font-mono text-[12px] leading-4 text-warning">
            {r.kind === "conflict" ? <GitFork size={16} /> : <AlertTriangle size={16} />} {label}
          </p>
          <h1 className="mt-1 text-title-l text-fg">{r.title}</h1>
          <p className="mt-1 text-[12px] leading-[18px] text-fg-tertiary">{meta}</p>
        </div>
        {pos.total > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-medium text-fg-tertiary">{pos.index} of {pos.total} to review</span>
            <IconButton icon={ChevronLeft} label="Previous review" disabled={pos.index <= 1} onClick={() => navigate(-1)} />
            <IconButton icon={ChevronRight} label="Next review" disabled={!r.next_id} onClick={() => navigate(`${base}/review/${r.next_id}`)} />
          </div>
        )}
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="scroll-pane hidden w-[500px] shrink-0 border-r border-line-subtle bg-sidebar pt-5 pr-8 pb-7 pl-10 lg:block xl:w-[500px]">
          <p className="eyebrow mb-4">What happened</p>
          <SourceMessage trigger={r.trigger} />
          {r.compared?.length > 0 && <Compared items={r.compared} base={base} />}
        </aside>
        <section className="scroll-pane min-w-0 flex-1 pt-5 pr-10 pb-7 pl-8">
          <p className="eyebrow">Bracket’s interpretation</p>
          <p className="mt-3 max-w-[640px] text-body-m text-fg-secondary">{r.interpretation}</p>
          <div className="mt-3 space-y-3">{banners}</div>
          <div className="mt-3 flex items-center gap-3 pt-2">
            <Checkbox checked={allState === true} indeterminate={allState === "indeterminate"} disabled={!canEdit}
              onChange={() => setSelected(count === total ? new Set() : new Set(r.proposals.map((p) => p.id)))} aria-label="Select all proposed updates" />
            <span className="text-title-s text-fg">Proposed updates</span>
            <span className="font-mono text-[12px] text-fg-tertiary">{count} of {total} selected</span>
            <span className="flex-1" />
            <span className="hidden items-center gap-2 text-[12px] font-medium text-fg-tertiary xl:flex"><Info size={16} /> Low-confidence items are unselected by default</span>
          </div>
          <div className="mt-3 overflow-hidden rounded-lg border border-line">{proposals}</div>
          <div className="mt-6 lg:hidden"><p className="eyebrow mb-3">What happened</p><SourceMessage trigger={r.trigger} /></div>
        </section>
      </div>
      <footer className="flex flex-wrap items-center gap-3 border-t border-line bg-sidebar px-8 py-4">
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-medium leading-[18px] text-fg" aria-live="polite">{count} of {total} updates selected</p>
          <p className="text-[12px] font-medium leading-4 text-fg-tertiary">Previous versions stay in history and can be restored from the Timeline.</p>
        </div>
        <Button icon={Reply} onClick={draftReply}>Draft reply to {firstName}</Button>
        <Button variant="ghost" onClick={() => setDismissOpen(true)} disabled={!canEdit}>Dismiss all</Button>
        <Button onClick={save} disabled={!canEdit}>Save for later</Button>
        <Button variant="primary" icon={Check} onClick={accept} loading={busy} disabled={!count || !canEdit}>
          Accept {count} update{count === 1 ? "" : "s"}
        </Button>
      </footer>
      <DismissDialog open={dismissOpen} onOpenChange={setDismissOpen} total={total} onConfirm={dismiss} />
    </div>
  );
}

function relDay(iso) {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "Today";
  const y = new Date(Date.now() - 864e5);
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/* ───────────────────────── Source message ───────────────────────── */
function SourceMessage({ trigger, bare }) {
  const hl = (b, i) => b.tags ? (
    <div key={i} className="rounded-[2px] border-l-2 border-warning bg-warning-bg py-2 pr-2 pl-3">
      <p className="text-[12px] leading-[18px] text-fg">{b.text}</p>
      <p className="mt-1 font-mono text-[12px] leading-4 text-warning">→ {b.tags.join(" · ")}</p>
    </div>
  ) : (
    <p key={i} className="whitespace-pre-line text-[12px] leading-[18px] text-fg-secondary">{b.text}</p>
  );
  const head = (
    <div className={cn("flex items-center gap-3", !bare && "border-b border-line-subtle py-4 pr-3 pl-4")}>
      <Avatar name={trigger.from} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-[12px] font-medium leading-[18px] text-fg">{trigger.from} <SourceMark provider={trigger.provider} size={16} /></p>
        <p className="text-[12px] font-medium leading-4 text-fg-tertiary">to {trigger.to} · {relDay(trigger.at)} {shortTime(trigger.at)}</p>
      </div>
      {!bare && <IconButton icon={ExternalLink} label={`Open in ${trigger.provider === "gmail" ? "Gmail" : "Slack"}`} />}
    </div>
  );
  if (bare) {
    return (
      <div>
        {head}
        <div className="mt-4 space-y-3">{trigger.body.map(hl)}</div>
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface">
      {head}
      <div className="space-y-3 p-4">
        <p className="text-body-m font-medium text-fg">{trigger.subject}</p>
        {trigger.body.map(hl)}
      </div>
    </div>
  );
}

function Compared({ items, base }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, 2);
  return (
    <>
      <p className="eyebrow mt-4 mb-4">Compared with what Bracket remembers</p>
      <div className="overflow-hidden rounded-lg border border-line divide-y divide-line-subtle">
        <AnimatePresence initial={false}>
          {shown.map((c) => (
            <motion.div key={c.memory_id} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={T.base} className="overflow-hidden">
              <div className="space-y-2 px-4 py-3">
                <p className="text-[12px] leading-[18px] text-fg">{c.text}</p>
                <Chip provider={c.chip.provider} label={c.chip.label} to={`${base}/memory?item=${c.memory_id}`} />
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        {items.length > 2 && (
          <button onClick={() => setAll((a) => !a)} className="w-full px-4 py-3 text-left text-[12px] font-medium text-fg-secondary hover:bg-hover hover:text-fg">
            {all ? "Show less" : `Show ${items.length - 2} more`}
          </button>
        )}
      </div>
    </>
  );
}

/* ───────────────────────── Proposals ───────────────────────── */
function ProposalList({ r, selected, toggle, edits, setEdits, editing, setEditing, focus, setFocus, rowRefs, mobile, expanded, setExpanded, canEdit, kbd }) {
  return (
    <div className="divide-y divide-line-subtle">
      {r.proposals.map((p, i) => {
        const on = selected.has(p.id);
        const [opLabel, opTone] = OP[p.op] || OP.add;
        const open = !mobile || expanded.has(p.id);
        const after = edits[p.id] ?? p.after;
        return (
          <motion.div
            key={p.id}
            ref={(el) => { rowRefs.current[i] = el; }}
            tabIndex={-1}
            onFocus={() => setFocus(i)}
            className={cn("flex gap-3 px-4 py-3 outline-none transition-colors duration-fast", focus === i && kbd && !mobile && "bg-white/[0.03] shadow-[inset_2px_0_0_var(--text-primary)]")}
          >
            <div className="pt-0.5"><Checkbox checked={on} onChange={() => toggle(p.id)} disabled={!canEdit} aria-label={`Include ${CAT[p.category] || p.category} update`} /></div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="eyebrow">{CAT[p.category] || p.category}</span>
                <Badge tone={opTone}>{opLabel}</Badge>
                <span className="flex-1" />
                {!mobile && <Confidence level={p.confidence} />}
                {mobile && (
                  <button aria-label={open ? "Collapse" : "Expand"} onClick={() => setExpanded((s) => { const n = new Set(s); n.has(p.id) ? n.delete(p.id) : n.add(p.id); return n; })} className="-m-2 p-2 text-fg-tertiary">
                    <motion.span animate={{ rotate: open ? 180 : 0 }} transition={T.fast} className="block"><ChevronDown size={16} /></motion.span>
                  </button>
                )}
              </div>
              {mobile ? (
                <p className="mt-2 text-body-m text-fg">{after}</p>
              ) : (
                <div className="mt-2 space-y-1 border-l-2 border-line pl-3">
                  {p.before && <p className="text-[12px] leading-[18px] text-fg-tertiary">{p.before}</p>}
                  <EditableAfter value={after} editing={editing === p.id} onEdit={() => canEdit && setEditing(p.id)} onDone={(v) => { setEditing(null); if (v !== p.after) setEdits((e) => ({ ...e, [p.id]: v })); }} edited={edits[p.id] != null} />
                </div>
              )}
              <AnimatePresence initial={false}>
                {open && (
                  <motion.div initial={mobile ? { height: 0, opacity: 0 } : false} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={T.base} className="overflow-hidden">
                    {mobile && p.before && <p className="mt-2 text-[12px] text-fg-tertiary">Was: {p.before}</p>}
                    {mobile && editing === p.id && (
                      <div className="mt-2"><EditableAfter value={after} editing onDone={(v) => { setEditing(null); if (v !== p.after) setEdits((e) => ({ ...e, [p.id]: v })); }} /></div>
                    )}
                    <p className="mt-2 text-[12px] font-medium leading-4 text-fg-tertiary">{p.rationale}</p>
                    {mobile && <div className="mt-2"><Confidence level={p.confidence} /></div>}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

function EditableAfter({ value, editing, onEdit, onDone, edited }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  if (editing) {
    return (
      <div>
        <input autoFocus value={v} onChange={(e) => setV(e.target.value)} onBlur={() => onDone(v.trim() || value)}
          onKeyDown={(e) => { if (e.key === "Enter") onDone(v.trim() || value); if (e.key === "Escape") onDone(value); }}
          className="h-10 w-full rounded-md border border-fg/80 bg-app px-3 text-body-m text-fg outline-none" aria-label="Edit proposed value" />
        <p className="mt-1 text-[12px] text-fg-tertiary">Your edit is saved as the accepted version. Bracket’s original stays in history.</p>
      </div>
    );
  }
  return (
    <button onClick={onEdit} className="group flex w-full items-start gap-2 text-left" title="Edit proposed value">
      <span className="text-body-m text-fg">{value}</span>
      {edited && <Badge>Edited</Badge>}
      <Pencil size={12} className="mt-1 shrink-0 text-fg-tertiary opacity-0 transition-opacity duration-fast group-hover:opacity-100" />
    </button>
  );
}

function EdgeBanner({ tone, icon: Icon, title, body, action }) {
  const c = { info: "border-info/60 text-info", success: "border-success/60 text-success", danger: "border-danger/60 text-danger" }[tone];
  return (
    <div className={cn("rounded-lg border px-4 py-3", c)} role={tone === "danger" ? "alert" : "status"}>
      <div className="flex gap-3">
        <Icon size={16} className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-body-m text-fg">{title}</p>
          {body && <p className="mt-0.5 text-body-s text-fg-secondary">{body}</p>}
          {action && <div className="mt-2">{action}</div>}
        </div>
      </div>
    </div>
  );
}

function DismissDialog({ open, onOpenChange, total, onConfirm }) {
  const [reason, setReason] = useState(null);
  const [note, setNote] = useState("");
  useEffect(() => { if (open) { setReason(null); setNote(""); } }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={`Dismiss all ${total} proposed update${total === 1 ? "" : "s"}?`}
      description="Memory stays as it is. The email and this decision are kept in Timeline."
      footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="danger" onClick={() => onConfirm(reason, note)}>Dismiss {total} update{total === 1 ? "" : "s"}</Button></>}>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Why are you dismissing these?">
        {REASONS.map((x) => (
          <button key={x} role="radio" aria-checked={reason === x} onClick={() => setReason(reason === x ? null : x)}
            className={cn("h-9 rounded-md border px-3 text-[12px] font-medium transition-colors duration-fast", reason === x ? "border-fg bg-selected text-fg" : "border-line-control text-fg-secondary hover:text-fg")}>
            {x}
          </button>
        ))}
      </div>
      <AnimatePresence>
        {reason === "Other" && (
          <motion.input initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={T.fast} autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="Tell Bracket what it got wrong"
            className="mt-3 h-10 w-full rounded-md border border-line-control bg-app px-3 text-body-m text-fg outline-none focus:border-fg" />
        )}
      </AnimatePresence>
      <p className="mt-3 text-[12px] text-fg-tertiary">Optional — helps Bracket interpret similar messages better.</p>
    </Dialog>
  );
}

function Done({ icon: Icon = CheckCircle2, title, body, onBack, extra }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <motion.span initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={T.base}><Icon size={22} className="text-success" /></motion.span>
      <p className="mt-3 text-title-m text-fg">{title}</p>
      <p className="mt-1.5 max-w-[360px] text-body-s text-fg-tertiary">{body}</p>
      <div className="mt-5 flex gap-2">{extra}<Button variant="primary" onClick={onBack}>Back to Overview</Button></div>
    </div>
  );
}

function ReviewSkeleton() {
  return (
    <div className="flex h-full flex-col" aria-busy="true">
      <div className="border-b border-line-subtle px-8 py-5"><Skeleton className="h-3 w-40" /><Skeleton className="mt-3 h-6 w-[520px] max-w-full" /></div>
      <div className="flex flex-1">
        <div className="hidden w-[500px] border-r border-line-subtle p-10 lg:block"><Skeleton className="h-80 w-full rounded-lg" /></div>
        <div className="flex-1 p-8 space-y-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full rounded-lg" />)}</div>
      </div>
    </div>
  );
}
