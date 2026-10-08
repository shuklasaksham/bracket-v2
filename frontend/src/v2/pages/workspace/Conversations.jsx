import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Filter, ExternalLink, ChevronRight, Reply, RefreshCw, Send, Info, CheckCircle2, X, AlertTriangle, Lock, Copy, FileText, Pencil, Plus, ChevronDown, Link2, MoreHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { useWorkspace, refreshAll } from "../../lib/workspace";
import { v2 } from "../../lib/api2";
import { shortTime, useResource } from "../../lib/data";
import { useIsMobile, useMedia } from "../../lib/useMedia";
import { Avatar, Badge, Button, IconButton, Input, Skeleton, SourceMark } from "../../ui/primitives";
import { Menu, MenuContent, MenuItem, MenuTrigger, Sheet } from "../../ui/overlays";
import { Chip } from "../../ui/patterns";
import { AnimatePresence, Stagger, StaggerItem, motion, t as T, useDelayed } from "../../ui/motion";
import { MobileSubHeader } from "../../shell/AppShell";
import { cn } from "../../../lib/utils";

/* Conversations — Figma › ✓ Conversations — Desktop 1440 and states: Reply sent,
   Draft follow-up, Slack thread, Meeting note, Needs reply filter, Nothing
   detected, New message, Reply — states; plus the Mobile 390 frames. */

const FILTERS = [["all", "All"], ["needs_reply", "Needs reply"], ["gmail", "Gmail"], ["slack", "Slack"]];
const TAG_TONE = {
  warning: "border-warning bg-warning-bg [&_.tag]:text-warning",
  info: "border-info bg-info-bg [&_.tag]:text-info",
};
const dayTime = (iso) => {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date(Date.now() - 864e5);
  if (d.toDateString() === today.toDateString()) return `Today, ${format(d, "HH:mm")}`;
  if (d.toDateString() === y.toDateString()) return `Yesterday ${format(d, "HH:mm")}`;
  return format(d, "MMM d, HH:mm");
};

export default function Conversations() {
  const { tid } = useParams();
  const [params, setParams] = useSearchParams();
  const { projectId, counts, canEdit } = useWorkspace();
  const mobile = useIsMobile();
  const wide = useMedia("(min-width: 1280px)");
  const navigate = useNavigate();
  const base = `/w/${projectId}`;
  const filter = params.get("filter") || "all";
  const composing = params.get("new") === "1";
  const list = useResource(() => v2.threads(projectId, filter), [projectId, filter]);
  useEffect(() => {
    const on = () => list.reload();
    window.addEventListener("bk:refresh", on);
    return () => window.removeEventListener("bk:refresh", on);
  }, [list]);

  // Desktop opens the first thread by default (Figma shows one selected).
  useEffect(() => {
    if (!mobile && !tid && !composing && list.data?.threads?.length) navigate(`${base}/conversations/${list.data.threads[0].id}${window.location.search}`, { replace: true });
  }, [mobile, tid, composing, list.data, base, navigate]);

  const setFilter = (f) => { const n = new URLSearchParams(params); if (f === "all") n.delete("filter"); else n.set("filter", f); setParams(n); };
  const threads = list.data?.threads || [];
  const c = list.data?.counts || {};

  const listPane = (
    <section aria-label="Conversations" className={cn("flex h-full min-w-0 flex-col border-line-subtle", !mobile && "w-[340px] shrink-0 border-r")}>
      <div className="px-4 pt-5 pb-3 md:px-4">
        <div className="flex items-center gap-2">
          <h1 className="text-title-m text-fg">Conversations</h1>
          {mobile ? <><span className="flex-1" /><IconButton icon={Plus} label="New message" size="l" disabled={!canEdit} onClick={() => navigate(`${base}/conversations?new=1`)} /></> : <>
          <Button size="s" variant={composing ? "primary" : "secondary"} icon={Plus} disabled={!canEdit} onClick={() => navigate(`${base}/conversations?new=1`)}>New</Button>
          <span className="flex-1" />
          <Menu>
            <MenuTrigger asChild><IconButton icon={Filter} label="Filter" size={mobile ? "l" : "m"} /></MenuTrigger>
            <MenuContent className="w-[200px]">
              {FILTERS.map(([k, l]) => <MenuItem key={k} checked={filter === k} onSelect={() => setFilter(k)}>{l}</MenuItem>)}
              <MenuItem checked={filter === "notes"} onSelect={() => setFilter("notes")}>Notes</MenuItem>
            </MenuContent>
          </Menu></>}
        </div>
        <div className={cn("mt-3 flex overflow-x-auto [scrollbar-width:none]", mobile ? "-mx-4 gap-2 px-4" : "gap-1.5")}>
          {FILTERS.map(([k, l]) => {
            const on = filter === k;
            const n = k === "all" ? c.all : k === "needs_reply" ? c.needs_reply : null;
            return (
              <button key={k} onClick={() => setFilter(k)} className={cn("relative shrink-0 border text-[12px] font-medium transition-colors duration-fast", mobile ? "h-9 rounded-lg px-3" : "h-7 rounded-md px-2.5", on ? (mobile ? "border-fg text-app" : "border-transparent text-fg") : (mobile ? "border-line-control text-fg-secondary" : "border-line text-fg-secondary hover:text-fg"))}>
                {on && <motion.span layoutId="conv-filter" className={cn("absolute inset-0", mobile ? "rounded-[7px] bg-fg" : "rounded-md bg-selected")} transition={T.base} />}
                <span className="relative">{l}{n != null && <span className={cn("ml-1.5", mobile ? "" : "font-mono text-fg-tertiary")}>{n}</span>}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="scroll-pane min-h-0 flex-1 border-t border-line-subtle">
        {!list.data ? <ListSkel /> : threads.length === 0 ? (
          <p className="px-4 py-6 text-[12px] text-fg-tertiary">{filter === "needs_reply" ? "Nothing waiting on you. Bracket flags threads where someone is waiting for your answer." : "No conversations yet. Connect Gmail or Slack to see them here."}</p>
        ) : (
          <Stagger as="ul">
            {threads.map((t) => (
              <StaggerItem as="li" key={t.id}>
                <ThreadRow t={t} active={t.id === tid} to={`${base}/conversations/${t.id}${filter !== "all" ? `?filter=${filter}` : ""}`} />
              </StaggerItem>
            ))}
          </Stagger>
        )}
      </div>
    </section>
  );

  if (mobile) {
    if (composing) return <NewMessage wid={projectId} mobile onClose={() => navigate(`${base}/conversations`)} params={params} />;
    if (tid) return <ThreadView wid={projectId} tid={tid} base={base} mobile canEdit={canEdit} params={params} setParams={setParams} />;
    return listPane;
  }
  return (
    <div className="flex h-full">
      {listPane}
      <div className="min-w-0 flex-1">
        {composing ? <NewMessage wid={projectId} onClose={() => navigate(`${base}/conversations`)} params={params} wide={wide} />
          : tid ? <ThreadView key={tid} wid={projectId} tid={tid} base={base} canEdit={canEdit} params={params} setParams={setParams} wide={wide} />
            : <div className="flex h-full items-center justify-center text-[12px] text-fg-tertiary">Pick a conversation</div>}
      </div>
    </div>
  );
}

function ThreadRow({ t, active, to }) {
  const isNote = t.provider === "notes";
  return (
    <Link to={to} className={cn("relative block border-b border-line-subtle px-4 py-3 transition-colors duration-fast", active ? "bg-surface" : "hover:bg-hover")} aria-current={active ? "page" : undefined}>
      {active && <motion.span layoutId="thread-active" className="absolute inset-y-0 left-0 w-[2px] bg-fg" transition={T.base} />}
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0">{isNote ? <FileText size={16} className="text-fg-secondary" /> : <SourceMark provider={t.provider} size={16} />}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="flex-1 truncate text-[12px] font-medium text-fg">{t.provider === "slack" ? t.channel : t.who}</span>
            <span className="shrink-0 font-mono text-[12px] text-fg-tertiary">{shortTime(t.at)}</span>
          </div>
          <p className="truncate text-[12px] text-fg-secondary">{t.subtitle || t.title}</p>
          <p className="line-clamp-2 text-[12px] text-fg-tertiary">{t.preview}</p>
          {t.badge && <div className="mt-2"><Badge tone={t.badge.tone} dot>{t.badge.label}</Badge></div>}
        </div>
      </div>
    </Link>
  );
}

/* ───────────────────────── Thread ───────────────────────── */
function ThreadView({ wid, tid, base, mobile, canEdit, params, setParams, wide }) {
  const { data: t, setData } = useResource(() => v2.thread(wid, tid), [wid, tid]);
  const navigate = useNavigate();
  const [showEarlier, setShowEarlier] = useState(false);
  const [draft, setDraft] = useState(null); // {label, body, based_on, note, via, to}
  const [drafting, setDrafting] = useState(false);
  const [sent, setSent] = useState(null);
  const [failed, setFailed] = useState(null);
  const [outdated, setOutdated] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const scroller = useRef(null);
  const draftParam = params.get("draft");
  const showSkel = useDelayed(300);

  const makeDraft = async (instruction) => {
    setDrafting(true); setFailed(null);
    try {
      const d = await v2.draft(wid, tid, instruction || draftParam || undefined);
      setDraft(d); setOutdated(false);
      setTimeout(() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" }), 60);
    } finally { setDrafting(false); }
  };
  useEffect(() => {
    if (draftParam && t && !draft) makeDraft(`${draftParam}${params.get("date") ? `&date=${params.get("date")}` : ""}`);
  }, [draftParam, t]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const on = () => { if (draft) setOutdated(true); };
    window.addEventListener("bk:review-accepted", on);
    return () => window.removeEventListener("bk:review-accepted", on);
  }, [draft]);

  const send = async () => {
    setFailed(null);
    try {
      const res = await v2.send(wid, tid, draft.body, draft.to);
      setSent({ at: res.sent_at, via: draft.via, to: t.who });
      setDraft(null);
      const n = new URLSearchParams(params); n.delete("draft"); n.delete("date"); setParams(n, { replace: true });
      const fresh = await v2.thread(wid, tid); setData(fresh);
      refreshAll();
    } catch (e) {
      setFailed(e?.response?.data?.detail || "Couldn’t send. Your draft is saved.");
    }
  };

  if (!t) return showSkel ? <div className="p-8"><Skeleton className="h-6 w-80" /><Skeleton className="mt-6 h-40 w-full rounded-lg" /></div> : null;
  const firstName = t.who.split(" ")[0];
  const isNote = t.kind === "note";
  const providerName = t.provider === "gmail" ? "Gmail" : t.provider === "slack" ? "Slack" : "Notes";
  const metaLine = isNote ? `Meeting note · ${format(new Date(t.started_at), "MMM d")} · ${t.participants} · added by Maya` : `${t.participants} · ${t.count} message${t.count === 1 ? "" : "s"} · Started ${format(new Date(t.started_at), "MMM d")}`;

  const context = <ContextPanel t={t} base={base} navigate={navigate} />;
  const discard = () => { setDraft(null); const n = new URLSearchParams(params); n.delete("draft"); setParams(n, { replace: true }); };
  if (mobile) {
    return <MobileThread t={t} base={base} canEdit={canEdit} draft={draft} setDraft={setDraft} drafting={drafting} makeDraft={makeDraft} send={send} sent={sent} failed={failed} onDiscard={discard} providerName={providerName} firstName={firstName} context={context} />;
  }
  const body = (
    <div className="flex h-full min-w-0 flex-col">
      {mobile ? (
        <MobileSubHeader title={isNote ? "Note" : t.provider === "slack" ? t.channel : t.who} onBack={() => navigate(`${base}/conversations`)}
          actions={<IconButton icon={Info} label="This conversation and memory" size="l" onClick={() => setContextOpen(true)} />} />
      ) : (
        <header className="flex items-start gap-3 border-b border-line-subtle px-6 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-title-m text-fg">{t.title}</h2>
            <p className="mt-1 flex items-center gap-2 truncate text-[12px] text-fg-tertiary">
              {isNote ? <FileText size={14} /> : <SourceMark provider={t.provider} size={14} />}
              {t.provider === "slack" ? `${t.channel} · ${metaLine}` : metaLine}
            </p>
          </div>
          {isNote ? <Button icon={Pencil} disabled={!canEdit} onClick={() => toast("Editing notes is coming from Sources › Notes")}>Edit note</Button>
            : <Button icon={ExternalLink} onClick={() => window.open(t.provider === "gmail" ? "https://mail.google.com" : "https://slack.com", "_blank", "noopener")}>Open in {providerName}</Button>}
        </header>
      )}
      <div ref={scroller} className="scroll-pane min-h-0 flex-1 px-4 py-4 md:px-6">
        {mobile && <h2 className="mb-3 text-title-m text-fg">{t.title}</h2>}
        {t.earlier && !showEarlier && (
          <button onClick={() => setShowEarlier(true)} className="mb-4 flex h-9 w-full items-center gap-2 rounded-md border border-line px-3 text-left text-[12px] text-fg-secondary transition-colors duration-fast hover:bg-hover">
            <ChevronRight size={14} /> {t.earlier.count} earlier message{t.earlier.count === 1 ? "" : "s"} · {format(new Date(t.earlier.at), "MMM d")}
          </button>
        )}
        <AnimatePresence initial={false}>
          {showEarlier && t.earlier && (
            <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} transition={T.base} className="mb-4 overflow-hidden text-[12px] text-fg-tertiary">
              Earlier messages are summarised in memory. Open in {providerName} to read them in full.
            </motion.p>
          )}
        </AnimatePresence>
        {isNote ? <NoteBody lines={t.note} /> : (
          <Stagger className="space-y-5" step={0.04}>
            {t.messages.map((m) => (
              <StaggerItem key={m.id} className="flex gap-3">
                <Avatar name={m.author} />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-baseline gap-2 text-[12px] font-medium text-fg">{m.author}<span className="font-normal text-fg-tertiary">{dayTime(m.at)}{m.sent_by_bracket ? " · sent via Bracket" : ""}</span></p>
                  <div className="mt-1.5 space-y-2">
                    {m.body.map((b, i) => b.tag ? (
                      <div key={i} className={cn("flex items-start gap-3 rounded-[2px] border-l-2 py-2 pr-3 pl-3", TAG_TONE[b.tone] || TAG_TONE.warning)}>
                        <span className="flex-1 text-body-m text-fg">{b.text}</span>
                        <span className="tag shrink-0 pt-0.5 font-mono text-[12px] uppercase">{b.tag}</span>
                      </div>
                    ) : <p key={i} className="whitespace-pre-line text-body-m text-fg-secondary">{b.text}</p>)}
                  </div>
                </div>
              </StaggerItem>
            ))}
          </Stagger>
        )}
      </div>
      <div className="shrink-0 px-4 pb-4 md:px-6">
        <AnimatePresence mode="popLayout" initial={false}>
          {sent ? (
            <StateCard key="sent" tone="success" icon={CheckCircle2} title={`Sent to ${sent.to} via ${providerName}. Bracket will watch for ${t.provider === "slack" ? "replies" : "her answer"} and update memory.`}
              action={t.provider === "gmail" && <Button size="s" variant="ghost" icon={ExternalLink} onClick={() => window.open("https://mail.google.com", "_blank", "noopener")}>View in Gmail</Button>} onClose={() => setSent(null)} />
          ) : draft ? (
            <motion.div key="draft" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={T.base}>
              {outdated && (
                <StateCard tone="warning" icon={AlertTriangle} title="Scope changed after this draft was written" body="You accepted changes since. The draft may describe tablet as an addition."
                  action={<><Button size="s" icon={RefreshCw} onClick={() => makeDraft("refresh")}>Update draft</Button><Button size="s" variant="ghost" onClick={() => setOutdated(false)}>Keep as is</Button></>} className="mb-3" />
              )}
              {failed && (
                <StateCard tone="danger" icon={X} title={`Couldn’t send via ${providerName}`} body={failed}
                  action={<><Button size="s" variant="primary" onClick={send}>Reconnect & send</Button><Button size="s" variant="ghost" icon={Copy} onClick={() => { navigator.clipboard?.writeText(draft.body.replace(/\[\[|\]\]/g, "")); toast("Draft copied"); }}>Copy text</Button></>} className="mb-3" />
              )}
              <DraftComposer draft={draft} setDraft={setDraft} onDiscard={() => { setDraft(null); const n = new URLSearchParams(params); n.delete("draft"); setParams(n, { replace: true }); }}
                onRewrite={() => makeDraft(draftParam || "rewrite")} onSend={send} busy={drafting} canEdit={canEdit} providerName={providerName} firstName={firstName} mobile={mobile} />
            </motion.div>
          ) : isNote ? (
            <motion.div key="note-foot" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-3 rounded-md border border-line-subtle px-4 py-3">
              <Info size={16} className="text-fg-tertiary" />
              <span className="flex-1 text-[12px] text-fg-tertiary">Notes can’t be replied to. Ask Bracket or draft a message to someone who was there.</span>
              <Button size="s" icon={Send} onClick={() => makeDraft()} loading={drafting} disabled={!canEdit}>Draft message</Button>
            </motion.div>
          ) : t.provider === "slack" && t.read_only ? (
            <StateCard key="ro" tone="neutral" icon={Lock} title="Slack is connected read-only" body={`To reply from Bracket, allow “send messages” for ${t.channel}. You’ll approve every message.`}
              action={<Button size="s" onClick={() => navigate(`${base}/sources/s_slack`)}>Update permission</Button>} />
          ) : (
            <motion.div key="reply" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-center">
              <Button icon={Reply} loading={drafting} disabled={!canEdit} onClick={() => makeDraft()}>{t.needs_reply ? `Draft reply to ${firstName}` : "Draft a reply"}</Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );

  if (mobile) {
    return (
      <>
        {body}
        <AnimatePresence>
          {contextOpen && (
            <motion.div className="fixed inset-0 z-50 flex flex-col bg-app" initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={T.sheet}>
              <MobileSubHeader title="This conversation and memory" onBack={() => setContextOpen(false)} />
              <div className="scroll-pane flex-1 px-4 py-4">{context}</div>
            </motion.div>
          )}
        </AnimatePresence>
      </>
    );
  }
  return (
    <div className="flex h-full">
      <div className="min-w-0 flex-1">{body}</div>
      <aside className={cn("scroll-pane h-full w-[300px] shrink-0 border-l border-line-subtle px-4 py-5", !wide && "hidden xl:block")} aria-label="This conversation and memory">{context}</aside>
    </div>
  );
}

/* ───────────────────────── Mobile 390 thread — Figma 23:2726, 43:4966, 145:449…145:62661 ─────────────────────────
   Push screen: meta line, messages full width, one status card, "Bracket learned", sticky actions.
   Drafts open as a bottom sheet over the thread; a sent reply is confirmed inline. */
function MobileThread({ t, base, canEdit, draft, setDraft, drafting, makeDraft, send, sent, failed, onDiscard, providerName, firstName, context }) {
  const navigate = useNavigate();
  const [contextOpen, setContextOpen] = useState(false);
  const isNote = t.kind === "note";
  const isSlack = t.provider === "slack";
  const meta = isNote
    ? `Note · added by Maya Rao · ${format(new Date(t.started_at), "MMM d")}`
    : isSlack
      ? `Slack · ${t.channel}${t.members ? ` · ${t.members} members` : ""} · ${dayTime(t.at).split(",")[0]}`
      : `Gmail · ${t.participants} · ${t.count} message${t.count === 1 ? "" : "s"}`;
  const pending = t.would_change.reduce((n, x) => n + (x.more || 1), 0);
  const nothing = t.nothing_detected || (!t.would_change.length && !t.created.length && !t.referenced.length);
  const openIn = () => window.open(t.provider === "gmail" ? "https://mail.google.com" : "https://slack.com", "_blank", "noopener");
  const followUp = /follow/i.test(draft?.label || "");
  const plain = draft ? draft.body.replace(/\[\[|\]\]/g, "") : "";
  const via = draft?.via === "slack" ? "Slack" : providerName;

  let footer = null;
  if (sent) footer = null;
  else if (isNote) footer = <Button size="l" variant="secondary" className="w-full" disabled={!canEdit} onClick={() => navigate(`${base}/sources/s_notes?note=${t.id}`)}>Edit note</Button>;
  else if (nothing) footer = <Button size="l" variant="ghost" className="w-full" disabled={!canEdit} onClick={() => navigate(`${base}/memory?add=1&from=${t.id}`)}>Add to memory manually</Button>;
  else if (isSlack) footer = <Button size="l" variant="secondary" className="w-full" onClick={openIn}>Open in Slack</Button>;
  else if (t.review_id && pending) footer = (
    <div className="flex gap-3">
      <Button size="l" variant="secondary" className="flex-1" loading={drafting} disabled={!canEdit} onClick={() => makeDraft()}>Reply</Button>
      <Button size="l" variant="primary" className="flex-1" disabled={!canEdit} onClick={() => navigate(`${base}/review/${t.review_id}`)}>Review update{pending === 1 ? "" : "s"}</Button>
    </div>
  );
  else if (t.alert?.draft) footer = (
    <div className="flex gap-3">
      <Button size="l" variant="secondary" className="flex-1" loading={drafting} disabled={!canEdit} onClick={() => makeDraft()}>Reply</Button>
      <Button size="l" variant="primary" className="flex-1" loading={drafting} disabled={!canEdit} onClick={() => makeDraft(t.alert.draft)}>Draft follow-up</Button>
    </div>
  );
  else footer = <Button size="l" variant="primary" className="w-full" icon={Reply} loading={drafting} disabled={!canEdit} onClick={() => makeDraft()}>{t.needs_reply ? `Draft reply to ${firstName}` : "Draft a reply"}</Button>;

  return (
    <div className="flex h-full min-w-0 flex-col">
      <MobileSubHeader title={isNote || !isSlack ? t.title : t.channel} onBack={() => navigate(`${base}/conversations`)}
        actions={(
          <Menu>
            <MenuTrigger asChild><IconButton icon={MoreHorizontal} label="More" size="l" /></MenuTrigger>
            <MenuContent align="end" className="w-[240px]">
              <MenuItem icon={Info} onSelect={() => setContextOpen(true)}>This {isNote ? "note" : "conversation"} and memory</MenuItem>
              {!isNote && <MenuItem icon={ExternalLink} onSelect={openIn}>Open in {providerName}</MenuItem>}
              {!isNote && <MenuItem icon={Reply} disabled={!canEdit} onSelect={() => makeDraft()}>Draft a reply</MenuItem>}
            </MenuContent>
          </Menu>
        )} />
      <div className="scroll-pane min-h-0 flex-1 px-4 py-4">
        <p className="flex items-center gap-2 text-body-s text-fg-tertiary">{isNote ? <FileText size={14} /> : <SourceMark provider={t.provider} size={14} />}<span className="truncate">{meta}</span></p>
        {isNote ? <div className="mt-4"><NoteBody lines={t.note} /></div> : (
          <Stagger className="mt-4 space-y-5" step={0.04}>
            {t.messages.map((m) => (
              <StaggerItem key={m.id}>
                <p className="flex items-center gap-2 text-body-s font-medium text-fg"><Avatar name={m.author} size="s" />{m.author}<span className="font-normal text-fg-tertiary">{format(new Date(m.at), "HH:mm")}{m.sent_by_bracket ? " · via Bracket" : ""}</span></p>
                <div className="mt-2 space-y-2">
                  {m.body.map((b, i) => b.tag ? (
                    <div key={i} className={cn("rounded-[2px] border-l-2 px-3 py-2", TAG_TONE[b.tone] || TAG_TONE.warning)}>
                      <span className="block text-body-m text-fg">{b.text}</span>
                      <span className="tag mt-1 block font-mono text-[12px] uppercase">{b.tag}{t.review_id && b.tone === "warning" && pending ? " · in review" : ""}</span>
                    </div>
                  ) : <p key={i} className="whitespace-pre-line text-body-m text-fg-secondary">{b.text}</p>)}
                </div>
              </StaggerItem>
            ))}
          </Stagger>
        )}

        <AnimatePresence initial={false}>
          {sent ? (
            <motion.div key="sent" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={T.base} role="status"
              className="mt-5 flex items-center gap-3 rounded-lg border border-success/70 bg-success-bg px-4 py-3">
              <CheckCircle2 size={16} className="shrink-0 text-success" />
              <span className="text-body-s text-fg">Sent via {providerName}. Bracket will watch for {isSlack ? "replies" : `${firstName}’s answer`}.</span>
            </motion.div>
          ) : t.review_id && pending ? (
            <StatusCard key="found" tone="info" title={`Bracket found ${pending} update${pending === 1 ? "" : "s"}`} body={`Would change ${t.would_change.filter((x) => !x.more).map((x) => x.category.toLowerCase()).join(" and ")}${pending > 2 ? ` and ${pending - 2} more` : ""}.`} />
          ) : t.alert ? (
            <StatusCard key="alert" tone={t.alert.tone} icon={AlertTriangle} title={t.alert.title} body={t.alert.body} />
          ) : nothing ? (
            <StatusCard key="nothing" tone="neutral" title="Nothing for memory" body="Bracket read this thread and found no scope, decisions or commitments. Nothing changed." />
          ) : null}
        </AnimatePresence>

        {(isNote || isSlack) && t.created.length > 0 && !sent && (
          <section className="mt-6">
            <p className="eyebrow mb-3">Bracket learned · {t.created.length}</p>
            <ul className="overflow-hidden rounded-lg border border-line divide-y divide-line-subtle">
              {t.created.map((x, i) => (
                <li key={i}>
                  <button onClick={() => x.id && navigate(`${base}/memory?item=${x.id}`)} className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-hover">
                    <span className="min-w-0 flex-1"><span className="block text-body-m text-fg">{x.text}</span><span className="block text-body-s text-fg-tertiary">{x.category}{isNote ? "" : " · accepted"}</span></span>
                    <ChevronRight size={16} className="text-fg-tertiary" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      {footer && <div className="shrink-0 border-t border-line-subtle px-4 pt-3 pb-3 safe-bottom">{footer}</div>}

      {/* Draft sheet — Figma 23:2726 (reply) · 145:62661 (follow-up) */}
      <Sheet open={!!draft} onOpenChange={(o) => !o && onDiscard()} title={draft?.label || `Draft reply to ${firstName}`}
        description={followUp ? "Written by Bracket · not sent" : undefined}
        footer={(
          <div className="flex gap-3">
            {followUp ? <Button size="l" variant="ghost" className="flex-1" onClick={onDiscard}>Discard</Button>
              : <Button size="l" variant="secondary" className="flex-1" icon={RefreshCw} loading={drafting} onClick={() => makeDraft("rewrite")}>Rewrite</Button>}
            <Button size="l" variant="primary" className="flex-[2]" icon={followUp ? undefined : Send} disabled={!canEdit} onClick={send}>Send via {via}</Button>
          </div>
        )}>
        {draft && (
          <>
            {!followUp && <span className="absolute right-4 top-6 text-body-s text-fg-tertiary">Not sent</span>}
            {draft.based_on?.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-body-s text-fg-tertiary">Based on</span>
                {draft.based_on.map((b, i) => <Chip key={i} provider={b.provider} label={b.label} />)}
              </div>
            )}
            <textarea value={plain} onChange={(e) => setDraft({ ...draft, body: e.target.value })} rows={8} aria-label="Reply text"
              className="mt-4 w-full resize-none rounded-lg border border-line-control bg-app px-3 py-3 text-body-m text-fg outline-none focus:border-fg" />
            {draft.note && !followUp && <p className="mt-3 flex items-center gap-2 text-body-s text-fg-tertiary"><Info size={14} className="shrink-0" /> Proposed dates are suggestions. Edit before sending.</p>}
            {failed && <p role="alert" className="mt-3 text-body-s text-danger">{failed}</p>}
          </>
        )}
      </Sheet>

      <AnimatePresence>
        {contextOpen && (
          <motion.div className="fixed inset-0 z-50 flex flex-col bg-app" initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={T.sheet}>
            <MobileSubHeader title={`This ${isNote ? "note" : "conversation"} and memory`} onBack={() => setContextOpen(false)} />
            <div className="scroll-pane flex-1 px-4 py-4">{context}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function StatusCard({ tone, icon: Icon = Info, title, body }) {
  const c = { info: "border-info/70 bg-info-bg text-info", warning: "border-warning/70 bg-warning-bg text-warning", neutral: "border-line-strong bg-surface text-fg-secondary" }[tone];
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={T.base} role="status" className={cn("mt-5 flex items-start gap-3 rounded-lg border px-4 py-3", c)}>
      <Icon size={16} className="mt-0.5 shrink-0" />
      <div className="min-w-0"><p className="text-body-m text-fg">{title}</p>{body && <p className="mt-0.5 text-body-s text-fg-secondary">{body}</p>}</div>
    </motion.div>
  );
}

function NoteBody({ lines }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-3 space-y-2">
      {lines.map((l, i) => l.tag ? (
        <div key={i} className={cn("flex items-start gap-3 rounded-[2px] border-l-2 py-2 px-3", TAG_TONE[l.tone] || TAG_TONE.info)}>
          <span className="flex-1 text-body-m text-fg">{l.text}</span>
          <span className="tag shrink-0 pt-0.5 font-mono text-[12px] uppercase">{l.tag}</span>
        </div>
      ) : <p key={i} className="px-3 text-body-m text-fg-secondary">{l.text}</p>)}
    </div>
  );
}

function ContextPanel({ t, base, navigate }) {
  const isNote = t.kind === "note";
  const empty = !t.would_change.length && !t.created.length && !t.referenced.length;
  const group = (title, items, tone) => items.length > 0 && (
    <section className="mt-5">
      <p className="eyebrow mb-3">{title}</p>
      <div className="space-y-3">
        {items.map((x, i) => x.more ? (
          <div key={i} className="border-l-2 border-warning pl-3"><p className="text-[12px] text-warning">+{x.more} more</p><p className="text-[12px] text-fg">{x.text}</p></div>
        ) : (
          <button key={i} onClick={() => x.id && navigate(`${base}/memory?item=${x.id}`)} className={cn("block w-full border-l-2 pl-3 text-left transition-colors duration-fast", tone === "warning" ? "border-warning" : "border-line hover:border-fg")}>
            <span className={cn("block text-[12px]", tone === "warning" ? "text-warning" : "text-fg-tertiary")}>{x.category}</span>
            <span className="block text-[12px] text-fg">{x.text}</span>
          </button>
        ))}
      </div>
    </section>
  );
  return (
    <div>
      <h3 className="text-body-m font-medium text-fg">This {isNote ? "note" : "conversation"} and memory</h3>
      {empty ? (
        <div className="mt-10 flex flex-col items-center text-center">
          <CheckCircle2 size={18} className="text-fg-tertiary" />
          <p className="mt-3 text-body-m font-medium text-fg">Nothing to remember here</p>
          <p className="mt-1 max-w-[220px] text-[12px] text-fg-tertiary">Bracket read this thread and found no decisions, requests or commitments.</p>
          <Button size="s" variant="ghost" className="mt-3" onClick={() => toast("Bracket will stop reading this thread", { description: "You can add it back from Sources." })}>Stop reading this thread</Button>
        </div>
      ) : (
        <>
          {group("Would change · pending", t.would_change, "warning")}
          {t.review_id && t.would_change.length > 0 && <Button size="s" className="mt-3" onClick={() => navigate(`${base}/review/${t.review_id}`)}>Review {t.would_change.reduce((n, x) => n + (x.more || 1), 0)} changes</Button>}
          {group(`Created from this ${isNote ? "note" : "thread"}${isNote ? ` · ${t.created.length}` : ""}`, t.created)}
          {group("Referenced", t.referenced)}
        </>
      )}
    </div>
  );
}

/* Draft composer — "written by Bracket, not sent"; suggested values in [[…]]
   render as highlighted chips and are editable text. */
function DraftComposer({ draft, setDraft, onDiscard, onRewrite, onSend, busy, canEdit, providerName, firstName, mobile }) {
  const [editing, setEditing] = useState(false);
  const plain = draft.body.replace(/\[\[|\]\]/g, "");
  const via = draft.via === "copy" ? null : draft.via === "slack" ? "Slack" : providerName;
  return (
    <div className="overflow-hidden rounded-lg border border-line-strong bg-surface shadow-popover">
      <div className="flex items-center gap-2 border-b border-line-subtle px-3 py-2.5">
        <Reply size={14} className="text-fg-secondary" />
        <span className="text-[12px] font-medium text-fg">{draft.label || `Draft reply to ${firstName}`}</span>
        <span className="text-[12px] text-fg-tertiary">· written by Bracket, not sent</span>
      </div>
      {draft.based_on?.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-3 pt-3">
          <span className="text-[12px] text-fg-tertiary">Based on</span>
          {draft.based_on.map((b, i) => <Chip key={i} provider={b.provider} label={b.label} />)}
        </div>
      )}
      <div className="px-3 py-3">
        {editing ? (
          <textarea autoFocus value={plain} onChange={(e) => setDraft({ ...draft, body: e.target.value })} onBlur={() => setEditing(false)} rows={Math.min(14, plain.split("\n").length + 1)}
            className="w-full resize-none bg-transparent text-body-m leading-6 text-fg outline-none" aria-label="Reply text" />
        ) : (
          <button onClick={() => canEdit && setEditing(true)} className="block w-full whitespace-pre-line text-left text-body-m leading-6 text-fg" aria-label="Edit reply text">
            {draft.body.split(/(\[\[[^\]]+\]\])/).map((part, i) => part.startsWith("[[") ? (
              <span key={i} className="mx-0.5 rounded-[4px] bg-info-bg px-1.5 py-0.5 text-info">{part.slice(2, -2)}</span>
            ) : <React.Fragment key={i}>{part}</React.Fragment>)}
          </button>
        )}
        {draft.note && <p className="mt-3 flex items-center gap-2 text-[12px] text-fg-tertiary"><Info size={14} /> {draft.note}</p>}
      </div>
      <div className={cn("flex items-center justify-end gap-2 border-t border-line-subtle px-3 py-2.5", mobile && "flex-wrap")}>
        <Button variant="ghost" onClick={onDiscard}>Discard</Button>
        <Button icon={RefreshCw} onClick={onRewrite} loading={busy}>Rewrite</Button>
        {via ? (
          <Button variant="primary" icon={Send} onClick={onSend} disabled={!canEdit}>Send via {via}</Button>
        ) : (
          <Button variant="primary" icon={Link2} onClick={() => { navigator.clipboard?.writeText(plain); toast("Copied — paste it wherever the conversation happened"); }}>Copy reply</Button>
        )}
      </div>
    </div>
  );
}

function StateCard({ tone, icon: Icon, title, body, action, onClose, className }) {
  const c = { success: "border-success/70 text-success", warning: "border-warning/70 text-warning", danger: "border-danger/70 text-danger", neutral: "border-line text-fg-secondary" }[tone];
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={T.base}
      className={cn("flex items-start gap-3 rounded-lg border bg-surface px-4 py-3", c, className)} role={tone === "danger" ? "alert" : "status"}>
      <Icon size={16} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-[12px] text-fg">{title}</p>
        {body && <p className="mt-0.5 text-[12px] text-fg-tertiary">{body}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      {onClose && <IconButton icon={X} label="Dismiss" size="s" onClick={onClose} />}
    </motion.div>
  );
}

/* ───────────────────────── New message ───────────────────────── */
function NewMessage({ wid, onClose, params, mobile, wide }) {
  const { data } = useResource(() => v2.messageTemplates(wid), [wid]);
  const [to, setTo] = useState(params.get("to") ? decodeURIComponent(params.get("to")) : "");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [via, setVia] = useState("gmail");
  const [remember, setRemember] = useState([]);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const apply = (tpl) => { setTo(tpl.to); setSubject(tpl.subject); setBody(tpl.body); setRemember(tpl.remember); };
  const send = async () => {
    setBusy(true);
    try {
      const t = await v2.newMessage(wid, { to, subject, body, via });
      toast.success(`Sent via ${via === "gmail" ? "Gmail" : "Slack"}`, { description: "Bracket will read replies like any other source." });
      refreshAll();
      navigate(`/w/${wid}/conversations/${t.id}`);
    } catch (e) { toast.error(e?.response?.data?.detail || "Couldn’t send"); } finally { setBusy(false); }
  };
  const form = (
    <div className="flex h-full flex-col">
      {mobile ? <MobileSubHeader title="New message" onBack={onClose} /> : (
        <header className="flex items-center gap-3 px-6 pt-5 pb-3">
          <h2 className="flex-1 text-title-m text-fg">New message</h2>
          <Menu>
            <MenuTrigger asChild><Button icon={() => <SourceMark provider={via} size={14} />} iconRight={ChevronDown}>Send via {via === "gmail" ? "Gmail" : "Slack"}</Button></MenuTrigger>
            <MenuContent><MenuItem checked={via === "gmail"} onSelect={() => setVia("gmail")}>Gmail</MenuItem><MenuItem checked={via === "slack"} onSelect={() => setVia("slack")}>Slack</MenuItem></MenuContent>
          </Menu>
        </header>
      )}
      <div className="scroll-pane flex-1 space-y-4 px-4 pb-4 md:px-6">
        <label className="block"><span className="mb-2 block text-[12px] font-medium text-fg-secondary">To</span><Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="Name or email" /></label>
        <label className="block"><span className="mb-2 block text-[12px] font-medium text-fg-secondary">Subject</span><Input value={subject} onChange={(e) => setSubject(e.target.value)} /></label>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} aria-label="Message"
          className="w-full rounded-md border border-line-control bg-surface px-3 py-2.5 text-body-m leading-6 text-fg outline-none transition-colors duration-fast focus:border-fg" />
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] text-fg-tertiary">Start from</span>
          {(data?.templates || []).map((tpl) => <Button key={tpl.id} size="s" onClick={() => apply(tpl)}>{tpl.label}</Button>)}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Discard</Button>
          <Button variant="primary" icon={Send} loading={busy} disabled={!to.trim() || !body.trim()} onClick={send}>Send via {via === "gmail" ? "Gmail" : "Slack"}</Button>
        </div>
      </div>
    </div>
  );
  if (mobile) return form;
  return (
    <div className="flex h-full">
      <div className="min-w-0 flex-1">{form}</div>
      <aside className={cn("w-[300px] shrink-0 border-l border-line-subtle px-4 py-5", !wide && "hidden xl:block")}>
        <h3 className="text-body-m font-medium text-fg">This conversation and memory</h3>
        <p className="eyebrow mt-5 mb-3">Bracket will remember</p>
        <AnimatePresence>
          {remember.map((r, i) => (
            <motion.div key={r.text} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ ...T.base, delay: i * 0.04 }} className="mb-3 border-l-2 border-line pl-3">
              <p className="text-[12px] text-fg-tertiary">{r.category}</p><p className="text-[12px] text-fg">{r.text}</p>
            </motion.div>
          ))}
        </AnimatePresence>
        <p className="text-[12px] text-fg-tertiary">Sent messages are read like any other source — commitments you make become memory.</p>
      </aside>
    </div>
  );
}

function ListSkel() {
  const show = useDelayed(300);
  if (!show) return null;
  return <div className="space-y-px">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="px-4 py-3"><Skeleton className="h-3 w-1/2" /><Skeleton className="mt-2 h-3 w-3/4" /><Skeleton className="mt-2 h-3 w-2/3" /></div>)}</div>;
}

