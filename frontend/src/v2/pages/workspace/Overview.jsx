import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertTriangle, ArrowRight, ArrowLeft, ChevronRight, Clock, GitFork, CheckCircle2, Mail, RefreshCw, Plus, MessageCircleQuestion, MoreHorizontal,
  CalendarClock, CalendarDays, Bookmark, Check, ExternalLink, X, Loader2, FileText, Upload, Reply, Unlink,
} from "lucide-react";
import { toast } from "sonner";
import { format, addDays, nextMonday, setHours, setMinutes } from "date-fns";
import { DayPicker } from "react-day-picker";
import { useWorkspace, refreshAll } from "../../lib/workspace";
import { v2 } from "../../lib/api2";
import { shortTime, clock, useResource } from "../../lib/data";
import { Badge, Button, IconButton, Kbd, SourceMark, Skeleton } from "../../ui/primitives";
import { Menu, MenuTrigger, MenuContent, MenuItem, MenuSeparator, Dialog } from "../../ui/overlays";
import { SectionTitle, Row, Chip, MoreButton } from "../../ui/patterns";
import { AnimatePresence, Collapse, Stagger, StaggerItem, motion, t as T, useDelayed } from "../../ui/motion";
import { useAskPanel } from "../../shell/AskPanel";
import { cn } from "../../../lib/utils";

/* Overview — "what needs me, what's coming, what changed".
   Figma › 03 Core screens › ✓ Overview — Desktop 1440 + states (all caught up,
   first sync, source needs reconnect, after accepting, snoozed & saved,
   attention item menu, new workspace). */

const KIND_ICON = {
  scope_change: [AlertTriangle, "text-warning"],
  conflict: [GitFork, "text-danger"],
  waiting: [Clock, "text-fg-tertiary"],
  reply: [Reply, "text-fg-tertiary"],
  commitment_due: [CalendarDays, "text-info"],
  source_issue: [Unlink, "text-danger"],
};
const EYEBROW_TONE = { warning: "text-warning", danger: "text-danger", info: "text-info", neutral: "text-fg-secondary" };
const SINCE_ICON = { mail: Mail, changed: RefreshCw, added: Plus };

export const dueLabel = (iso) => (iso ? format(new Date(iso), "EEE MMM d") : "No date");
export function dueStatus(item) {
  if (item.at_risk) return { tone: "danger", label: "At risk" };
  if (item.waiting_days) return { tone: "neutral", label: `Waiting ${item.waiting_days} days` };
  if (!item.due) return null;
  const days = Math.ceil((new Date(item.due) - Date.now()) / 864e5);
  if (days < 0) return { tone: "danger", label: `${-days} day${days === -1 ? "" : "s"} late` };
  if (days === 0) return { tone: "warning", label: "Due today" };
  if (days <= 7) return { tone: "info", label: `In ${days} day${days === 1 ? "" : "s"}` };
  return null;
}

export default function Overview() {
  const { projectId, workspace, canEdit, lastSeen, readOnly } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const view = params.get("view") === "later" ? "later" : "now";
  const { data, setData, reload } = useResource(() => v2.overview(projectId), [projectId]);
  const later = useResource(() => v2.attention(projectId), [projectId, view], { enabled: view === "later" });
  const navigate = useNavigate();
  const ask = useAskPanel();
  const base = `/w/${projectId}`;
  const showSkeleton = useDelayed(300);

  useEffect(() => {
    const on = () => reload();
    window.addEventListener("bk:refresh", on);
    return () => window.removeEventListener("bk:refresh", on);
  }, [reload]);

  // ?resolve=cf1 deep link (from Updates) → resolve page
  useEffect(() => {
    const r = params.get("resolve");
    if (r) navigate(`${base}/resolve/${r}`, { replace: true });
  }, [params, base, navigate]);

  const act = useCallback((item) => {
    const a = item.action || {};
    if (a.kind === "review") navigate(`${base}/review/${a.target}`);
    else if (a.kind === "resolve") navigate(`${base}/resolve/${a.target}`);
    else if (a.kind === "follow_up") navigate(`${base}/conversations/${a.target}?draft=follow-up`);
    else if (a.kind === "reply") navigate(`${base}/conversations/${a.target}?draft=1`);
    else if (a.kind === "reconnect") navigate(`${base}/sources/${a.target}?reconnect=1`);
    else if (a.kind === "view") navigate(`${base}/memory?item=${a.target}`);
  }, [base, navigate]);

  const removeLocal = (id) => setData((d) => d && ({ ...d, attention: d.attention.filter((x) => x.id !== id) }));
  const menuAction = async (item, kind, until) => {
    try {
      if (kind === "snooze") {
        removeLocal(item.id);
        await v2.snooze(projectId, item.id, until);
        toast(`Snoozed until ${format(new Date(until), "EEE, HH:mm")}`, { action: { label: "Undo", onClick: async () => { await v2.restoreAttention(projectId, item.id); reload(); refreshAll(); } } });
      } else if (kind === "save") {
        removeLocal(item.id);
        await v2.saveForLater(projectId, item.id);
        toast("Saved for later", { action: { label: "Undo", onClick: async () => { await v2.restoreAttention(projectId, item.id); reload(); refreshAll(); } } });
      } else if (kind === "handled" || kind === "dismiss") {
        removeLocal(item.id);
        await v2.dismissAttention(projectId, item.id);
        toast(kind === "handled" ? "Marked as handled" : "Dismissed — not relevant");
      } else if (kind === "restore") {
        await v2.restoreAttention(projectId, item.id);
        later.setData((d) => d && ({ ...d, items: d.items.filter((x) => x.id !== item.id) }));
        toast("Back in Needs your attention");
      }
      reload();
      refreshAll();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn’t update that item");
      reload();
    }
  };

  if (!data) {
    return showSkeleton ? <OverviewSkeleton /> : null;
  }

  const ws = data.workspace || workspace || {};
  if (!data.sources?.length && !data.categories?.some((c) => c.count) && !data.attention?.length) {
    return <EmptyWorkspace ws={ws} base={base} canEdit={canEdit} />;
  }
  const learning = ws.learning;
  const dimmed = !!readOnly && readOnly !== "viewer";
  const laterItems = (later.data?.items || []).filter((a) => a.saved || (a.snoozed_until && new Date(a.snoozed_until) > Date.now()));

  return (
    <div className="scroll-pane h-full">
      {learning && <LearningBanner learning={learning} />}
      <div className="mx-auto max-w-[1600px] px-4 pt-6 pb-24 md:px-8">
        {/* Header */}
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between lg:gap-8">
          <div className="min-w-0 max-w-[900px]">
            <h1 className="text-title-l text-fg">{ws.name}</h1>
            {ws.summary ? (
              <p className="mt-2 text-body-m text-fg-secondary">{ws.summary}</p>
            ) : (
              <p className="mt-2 text-body-m text-fg-tertiary">{ws.client_name}</p>
            )}
          </div>
          {ws.memory_updated_at && (
            <p className="flex shrink-0 items-center gap-2 font-mono text-[12px] text-fg-tertiary">
              <Clock size={14} aria-hidden="true" /> Memory updated {relative(ws.memory_updated_at)}
            </p>
          )}
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[minmax(0,1fr)_340px]">
          {/* Left column */}
          <div className="min-w-0 space-y-7">
            <section aria-labelledby="attn">
              <SectionTitle id="attn" title={view === "later" ? "Snoozed & saved" : "Needs your attention"} count={view === "later" ? laterItems.length : data.attention.length}
                action={view === "later" ? "← Back to needs you" : data.snoozed || data.saved ? [data.snoozed ? `Snoozed ${data.snoozed}` : null, data.saved ? `Saved for later ${data.saved}` : null].filter(Boolean).join(" · ") : "Only items that need a decision from you"}
                actionIcon={view !== "later"}
                onClick={view === "later" ? () => setParams({}) : data.snoozed || data.saved ? () => setParams({ view: "later" }) : undefined} />

              {view === "later" ? (
                <AttentionList items={laterItems} later onAct={act} onMenu={menuAction} dimmed={dimmed} canEdit={canEdit} loading={!later.data} />
              ) : data.attention.length === 0 && !learning ? (
                <CaughtUp base={base} />
              ) : (
                <AttentionList items={data.attention} onAct={act} onMenu={menuAction} dimmed={dimmed} canEdit={canEdit} skeletonRows={learning ? 2 : 0} />
              )}
            </section>

            <section aria-labelledby="coming">
              <SectionTitle id="coming" title="Coming up" count={data.coming_up.length} action="All commitments" to={`${base}/memory/commitment`} />
              {data.coming_up.length ? (
                <Stagger as="ul" className="overflow-hidden rounded-lg border border-line divide-y divide-line-subtle">
                  {data.coming_up.map((c) => {
                    const st = dueStatus(c);
                    return (
                      <StaggerItem as="li" key={c.id}>
                        <Row to={`${base}/memory/commitment?item=${c.id}`} prefix={dueLabel(c.due)} title={c.title} meta={c.direction}
                          trailing={st && <Badge tone={st.tone} dot>{st.label}</Badge>} />
                      </StaggerItem>
                    );
                  })}
                </Stagger>
              ) : (
                <p className="rounded-lg border border-line px-4 py-4 text-body-s text-fg-tertiary">No open commitments yet. Bracket adds them when someone promises something.</p>
              )}
            </section>
          </div>

          {/* Right column */}
          <div className="min-w-0 space-y-7">
            <section aria-labelledby="mem">
              <SectionTitle id="mem" title="Memory" count={(data.categories || []).reduce((n, c) => n + c.count, 0)} action="Open" to={`${base}/memory`} />
              <Stagger as="ul" className="overflow-hidden rounded-lg border border-line divide-y divide-line-subtle">
                {(data.categories || []).map((c) => (
                  <StaggerItem as="li" key={c.key}>
                    <Link to={`${base}/memory/${c.key}`} className="group flex items-center gap-3 px-4 py-3 transition-colors duration-fast hover:bg-hover">
                      <span className="flex flex-1 items-baseline gap-2"><span className="text-body-m font-medium text-fg">{c.label}</span><span className="text-body-s text-fg-tertiary">{c.count}</span></span>
                      <AnimatePresence initial={false} mode="popLayout">
                        {c.updated_now ? (
                          <motion.span key="now" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={T.base}><Badge tone="success" dot>Updated now</Badge></motion.span>
                        ) : c.due ? (
                          <motion.span key="due" exit={{ opacity: 0 }}><Badge tone="info" dot>{c.due} due</Badge></motion.span>
                        ) : c.pending ? (
                          <motion.span key="chg" exit={{ opacity: 0 }}><Badge tone="warning" dot>{c.pending} change{c.pending === 1 ? "" : "s"}</Badge></motion.span>
                        ) : null}
                      </AnimatePresence>
                      <ChevronRight size={16} className="text-fg-tertiary transition-transform duration-fast group-hover:translate-x-0.5" />
                    </Link>
                  </StaggerItem>
                ))}
                {learning && Array.from({ length: learning.discovering || 3 }).map((_, i) => (
                  <li key={`d${i}`} className="flex h-11 items-center gap-2 px-4">
                    <Skeleton className="h-2.5 w-24" /><span className="flex-1" /><span className="text-body-s text-fg-tertiary animate-pulse-soft">Discovering…</span>
                  </li>
                ))}
              </Stagger>
            </section>

            <section aria-labelledby="since">
              <SectionTitle id="since" title={learning ? "Found so far" : "Since your last visit"} action="Timeline" to={`${base}/timeline`} />
              <Stagger as="ul" className="rounded-lg border border-line px-2 py-2">
                {(data.since_last_visit || []).map((e) => {
                  const Icon = SINCE_ICON[e.icon] || Mail;
                  return (
                    <StaggerItem as="li" key={e.id}>
                      <Link to={`${base}/timeline/${e.id}`} className="flex items-start gap-3 rounded-md px-2 py-2 transition-colors duration-fast hover:bg-hover">
                        <Icon size={16} className="mt-0.5 shrink-0 text-fg-tertiary" aria-hidden="true" />
                        <span className="min-w-0 flex-1 text-[12px] leading-[18px] text-fg-secondary">{e.short}</span>
                        <span className="shrink-0 font-mono text-[12px] text-fg-tertiary">{sinceTime(e.at)}</span>
                      </Link>
                    </StaggerItem>
                  );
                })}
                {!data.since_last_visit?.length && <li className="px-2 py-2 text-body-s text-fg-tertiary">{lastSeen ? "Nothing new since your last visit." : "Activity shows up here as Bracket reads your sources."}</li>}
              </Stagger>
            </section>
          </div>
        </div>
      </div>

      <div className="pointer-events-none fixed bottom-6 right-6 z-30 hidden md:block">
        <motion.button
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ ...T.base, delay: 0.15 }}
          onClick={() => ask.open()}
          className="pointer-events-auto flex h-10 items-center gap-3 rounded-lg border border-line-strong bg-raised pl-3 pr-2 text-body-s font-medium text-fg shadow-popover transition-colors duration-fast hover:bg-[#1b1c20]"
        >
          <MessageCircleQuestion size={16} /> Ask Bracket <Kbd>⌘J</Kbd>
        </motion.button>
      </div>
    </div>
  );
}

function relative(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
function sinceTime(iso) {
  if (!iso) return "";
  if (Date.now() - new Date(iso).getTime() < 90e3) return "Now";
  return shortTime(iso);
}

/* ───────────────────────── Attention ───────────────────────── */
function AttentionList({ items, later, onAct, onMenu, dimmed, canEdit, skeletonRows = 0, loading }) {
  if (loading) return <div className="rounded-lg border border-line bg-surface p-5"><Skeleton className="h-3 w-1/2" /><Skeleton className="mt-3 h-3 w-3/4" /></div>;
  if (!items.length && !skeletonRows) {
    return <p className="rounded-lg border border-line bg-surface px-5 py-6 text-center text-body-s text-fg-tertiary">{later ? "Nothing snoozed or saved." : "Nothing needs you right now."}</p>;
  }
  return (
    <div className="overflow-hidden rounded-lg border border-line">
      <AnimatePresence initial={false}>
        {items.map((a, i) => (
          <Collapse key={a.id} className={cn(i > 0 && "border-t border-line-subtle")}>
            <AttentionRow item={a} later={later} first={i === 0} onAct={onAct} onMenu={onMenu} dimmed={dimmed} canEdit={canEdit} />
          </Collapse>
        ))}
      </AnimatePresence>
      {Array.from({ length: skeletonRows }).map((_, i) => (
        <div key={`s${i}`} className="border-t border-line-subtle px-5 py-5 pl-12">
          <Skeleton className="h-3 w-2/3" /><Skeleton className="mt-3 h-3 w-1/2" /><Skeleton className="mt-3 h-2.5 w-1/3" />
        </div>
      ))}
    </div>
  );
}

function AttentionRow({ item, later, first, onAct, onMenu, dimmed, canEdit }) {
  const [Icon, color] = KIND_ICON[item.kind] || KIND_ICON.waiting;
  const [pick, setPick] = useState(false);
  const eyebrow = later
    ? item.saved ? `Saved for later · ${item.saved_at ? shortTime(item.saved_at) : "Today"} by you` : `Snoozed until ${format(new Date(item.snoozed_until), "EEE, HH:mm")}`
    : item.eyebrow;
  const primary = item.action?.primary && first;
  const tomorrow = setMinutes(setHours(addDays(new Date(), 1), 9), 0);
  return (
    <div className={cn("flex gap-3 p-4 transition-opacity duration-base", dimmed && "opacity-50")}>
      <Icon size={16} className={cn("mt-0.5 shrink-0", later ? (item.saved ? "text-warning" : "text-danger") : color)} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className={cn("text-[12px] font-medium leading-4", later ? (item.saved ? "text-warning" : "text-danger") : EYEBROW_TONE[item.tone] || "text-fg-secondary")}>{eyebrow}</p>
        <p className="mt-2 text-title-s text-fg">{item.title}</p>
        {item.detail && <p className="mt-2 text-body-s text-fg-tertiary">{item.detail}</p>}
        {item.chip && <div className="mt-3"><Chip provider={item.chip.provider} label={item.chip.label} at={item.chip.at} /></div>}
      </div>
      <div className="flex shrink-0 items-center gap-2 self-start">
        {item.action && (
          <Button size="m" variant={primary || (later && item.action.primary) ? "primary" : "secondary"} onClick={() => onAct(item)} disabled={dimmed || (!canEdit && item.action.kind !== "view")} className="hidden sm:inline-flex">
            {item.action.label}
          </Button>
        )}
        <Menu>
          <MenuTrigger asChild>
            <MoreButton disabled={dimmed} />
          </MenuTrigger>
          <MenuContent className="w-[220px]">
            {item.action && <MenuItem className="sm:hidden" onSelect={() => onAct(item)}>{item.action.label}</MenuItem>}
            {later ? (
              <MenuItem icon={ArrowLeft} onSelect={() => onMenu(item, "restore")}>Move back to needs you</MenuItem>
            ) : (
              <>
                <MenuItem icon={Clock} shortcut="S" onSelect={() => onMenu(item, "snooze", tomorrow.toISOString())}>Snooze until tomorrow</MenuItem>
                <MenuItem icon={CalendarDays} onSelect={() => setPick(true)}>Snooze until…</MenuItem>
                <MenuItem icon={Bookmark} shortcut="L" onSelect={() => onMenu(item, "save")}>Save for later</MenuItem>
                <MenuItem icon={Check} shortcut="H" onSelect={() => onMenu(item, "handled")}>Mark as handled</MenuItem>
              </>
            )}
            {item.chip && (
              <>
                <MenuSeparator />
                <MenuItem icon={ExternalLink} onSelect={() => onAct({ action: { kind: item.chip.provider === "gmail" ? "reply" : "view", target: item.action?.target } })}>
                  Open source {item.chip.provider === "gmail" ? "email" : item.chip.provider === "slack" ? "message" : "note"}
                </MenuItem>
              </>
            )}
            {!later && <MenuItem icon={X} danger shortcut="⌫" onSelect={() => onMenu(item, "dismiss")}>Not relevant — dismiss</MenuItem>}
          </MenuContent>
        </Menu>
      </div>
      <SnoozePicker open={pick} onOpenChange={setPick} onPick={(d) => { setPick(false); onMenu(item, "snooze", d.toISOString()); }} />
    </div>
  );
}

function SnoozePicker({ open, onOpenChange, onPick }) {
  const [day, setDay] = useState();
  const at9 = (d) => setMinutes(setHours(d, 9), 0);
  const quick = [
    ["Later today", setMinutes(setHours(new Date(), Math.min(new Date().getHours() + 3, 23)), 0)],
    ["Tomorrow, 09:00", at9(addDays(new Date(), 1))],
    ["Monday, 09:00", at9(nextMonday(new Date()))],
    ["Next week", at9(addDays(new Date(), 7))],
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Snooze until…" size="s"
      footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" disabled={!day} onClick={() => onPick(at9(day))}>Snooze</Button></>}>
      <div className="grid grid-cols-2 gap-2">
        {quick.map(([l, d]) => (
          <button key={l} onClick={() => onPick(d)} className="rounded-md border border-line px-3 py-2 text-left text-body-s text-fg-secondary transition-colors duration-fast hover:border-line-strong hover:text-fg">
            {l}<span className="block text-fg-tertiary">{format(d, "EEE MMM d")}</span>
          </button>
        ))}
      </div>
      <div className="mt-4 flex justify-center rounded-lg border border-line-subtle p-2 bk-daypicker">
        <DayPicker mode="single" selected={day} onSelect={setDay} disabled={{ before: new Date() }} weekStartsOn={1} />
      </div>
    </Dialog>
  );
}

function CaughtUp({ base }) {
  return (
    <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={T.base}
      className="flex flex-col items-center rounded-lg border border-line bg-surface px-6 py-10 text-center">
      <motion.span initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ ...T.base, delay: 0.1 }}>
        <CheckCircle2 size={20} className="text-success" />
      </motion.span>
      <p className="mt-3 text-body-l font-medium text-fg">You’re all caught up</p>
      <p className="mt-1.5 max-w-[300px] text-body-s text-fg-tertiary">Bracket will surface anything that needs a decision here. Last item reviewed today at {clock(new Date().toISOString())}.</p>
      <Link to={`${base}/timeline`} className="mt-4 text-body-s font-medium text-fg hover:underline">See what changed today</Link>
    </motion.div>
  );
}

function LearningBanner({ learning }) {
  return (
    <div className="border-b border-info/30 bg-info/[0.16] px-4 py-3 md:px-6" role="status" aria-live="polite">
      <div className="flex items-center gap-4">
        <Loader2 size={16} className="shrink-0 animate-spin text-info" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-body-m text-fg">Bracket is learning from your sources</p>
          <div className="mt-2 flex flex-col gap-2 md:flex-row md:items-center md:gap-4">
            <div className="h-1 w-full max-w-[380px] overflow-hidden rounded-full bg-white/10">
              <motion.div className="h-full rounded-full bg-info" initial={{ width: 0 }} animate={{ width: `${Math.round((learning.pct || 0.3) * 100)}%` }} transition={{ duration: 0.8, ease: [0.2, 0.8, 0.2, 1] }} />
            </div>
            <span className="font-mono text-[12px] text-fg-secondary">{learning.text}</span>
          </div>
        </div>
        <span className="hidden text-body-s text-fg-secondary lg:inline">You can use what’s ready now.</span>
      </div>
    </div>
  );
}

function EmptyWorkspace({ ws, base, canEdit }) {
  const navigate = useNavigate();
  const rows = [
    { icon: <SourceMark provider="gmail" size={16} />, title: "Connect Gmail", sub: "Pick the client threads", cta: "Connect", to: `${base}/sources?add=gmail` },
    { icon: <SourceMark provider="slack" size={16} />, title: "Connect Slack", sub: "Pick project channels", cta: "Connect", to: `${base}/sources?add=slack` },
    { icon: <FileText size={16} className="text-fg-secondary" />, title: "Paste a note or transcript", sub: "Meeting notes, calls, briefs", cta: "Add note", to: `${base}/sources?note=1` },
    { icon: <Upload size={16} className="text-fg-secondary" />, title: "Upload a file", sub: "Proposal, SOW, contract", cta: "Upload", to: `${base}/files?upload=1` },
  ];
  return (
    <div className="scroll-pane h-full">
      <div className="mx-auto max-w-[520px] px-4 pt-16 pb-16 md:pt-24">
        <h1 className="text-title-l text-fg">{ws.name}</h1>
        <p className="mt-3 text-body-l text-fg-secondary">Bracket has nothing to remember yet. Connect where this work happens, or paste a note to start.</p>
        <Stagger as="ul" className="mt-5 overflow-hidden rounded-lg border border-line bg-surface divide-y divide-line-subtle">
          {rows.map((r) => (
            <StaggerItem as="li" key={r.title} className="flex items-center gap-3 px-4 py-3">
              <span className="flex w-5 justify-center">{r.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-body-m text-fg">{r.title}</span>
                <span className="block text-body-s text-fg-tertiary">{r.sub}</span>
              </span>
              <Button size="s" onClick={() => navigate(r.to)} disabled={!canEdit}>{r.cta}</Button>
            </StaggerItem>
          ))}
        </Stagger>
        <p className="mt-4 flex items-start gap-2 text-body-s text-fg-tertiary"><span aria-hidden="true">ⓘ</span> Once connected, Overview shows what needs you, what’s coming up, and what Bracket remembers.</p>
      </div>
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div className="mx-auto max-w-[1180px] px-4 pt-6 md:px-8" aria-busy="true" aria-label="Loading overview">
      <Skeleton className="h-6 w-80" />
      <Skeleton className="mt-3 h-4 w-[640px] max-w-full" />
      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-28 w-full rounded-lg" />)}</div>
        <div className="space-y-3"><Skeleton className="h-64 w-full rounded-lg" /><Skeleton className="h-40 w-full rounded-lg" /></div>
      </div>
    </div>
  );
}
