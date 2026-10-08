import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Plus, RefreshCw, Mail, Hash, FileText, Info, CheckCircle2, Unlink, MoreHorizontal, ExternalLink, History, Layers, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { useWorkspace, refreshAll } from "../../lib/workspace";
import { v2 } from "../../lib/api2";
import { useResource } from "../../lib/data";
import { useIsMobile } from "../../lib/useMedia";
import { Button, IconButton, Skeleton, SourceMark, Toggle } from "../../ui/primitives";
import { Menu, MenuContent, MenuItem, MenuTrigger, Sheet } from "../../ui/overlays";
import { AnimatePresence, Stagger, StaggerItem, motion, t as T } from "../../ui/motion";
import { MobileSubHeader } from "../../shell/AppShell";
import { AddNoteDialog, ChoiceConfirm, ChooseItemsDialog, OAuthRedirect, SourceStatus, num } from "../../features/sources";
import { cn } from "../../../lib/utils";

/* Source detail — Figma › ✓ Source detail · Gmail, Add threads, Stop reading,
   Disconnect, Paused, Reconnected (catching up), Redirecting to Google, Syncing
   now, Source detail · Slack, Source detail · Notes; and the Mobile 390 frames. */
const CAT = { scope: "Scope", decision: "Decisions", commitment: "Commitments", requirement: "Requirements", person: "People", deliverable: "Deliverables" };

export default function SourceDetail() {
  const { sid } = useParams();
  const [params, setParams] = useSearchParams();
  const { projectId, canEdit } = useWorkspace();
  const mobile = useIsMobile();
  const navigate = useNavigate();
  const base = `/w/${projectId}`;
  const { data: s, setData, reload, error } = useResource(() => v2.source(projectId, sid), [projectId, sid]);
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState(false);
  const [disconnect, setDisconnect] = useState(false);
  const [stop, setStop] = useState(null); // {item, impact}
  const [oauth, setOauth] = useState(false);
  const [busy, setBusy] = useState(null);
  const [threadSheet, setThreadSheet] = useState(null);

  useEffect(() => {
    if (params.get("add") === "1") setAdding(true);
    if (params.get("disconnect") === "1") setDisconnect(true);
    if (params.get("reconnect") === "1") setOauth(true);
    if (params.get("add") || params.get("disconnect") || params.get("reconnect")) setParams({}, { replace: true });
  }, [params, setParams]);
  // poll while something is in progress
  useEffect(() => {
    if (!s || !["syncing", "checking", "catching_up"].includes(s.status) && !(s.threads || s.channels || []).some((t) => t.reading)) return undefined;
    const id = setInterval(reload, 1200);
    return () => clearInterval(id);
  }, [s, reload]);

  if (error) return <div className="flex h-full items-center justify-center text-[12px] text-fg-tertiary">This source isn’t connected to the workspace.</div>;
  if (!s) return <div className="p-8"><Skeleton className="h-12 w-72" /><Skeleton className="mt-6 h-48 w-full rounded-lg" /></div>;

  const kind = s.provider === "slack" ? "channels" : s.provider === "notes" ? "notes" : "threads";
  const items = s.threads || s.channels || s.notes || [];
  const totalMsgs = items.reduce((n, t) => n + (t.messages || 0), 0);
  const unit = kind === "channels" ? "channel" : kind === "notes" ? "note" : "thread";
  const paused = s.status === "paused";
  const disconnected = s.status === "disconnected";
  const act = async (name, fn, msg) => { setBusy(name); try { const r = await fn(); if (r) setData((d) => ({ ...d, ...r })); refreshAll(); if (msg) toast(msg); } finally { setBusy(null); } };

  const header = (
    <div className="flex flex-wrap items-start gap-4">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-line bg-surface">
        {s.provider === "notes" ? <FileText size={20} className="text-fg-secondary" /> : <SourceMark provider={s.provider} size={22} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-title-l text-fg">{s.label}</h1>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span key={s.status} initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={T.fast}>
              {s.provider === "notes" && s.status === "synced" ? <span className="inline-flex items-center gap-2 text-[12px] text-fg-secondary"><span className="h-1.5 w-1.5 rounded-full bg-success" />Processed today</span> : <SourceStatus s={s} />}
            </motion.span>
          </AnimatePresence>
        </div>
        <p className="mt-1 text-[12px] text-fg-tertiary">{s.provider === "notes" ? "Added in Bracket · notes, transcripts and call summaries" : `${s.account}${s.provider === "slack" ? " workspace" : ""} · Connected ${format(new Date(s.connected_at), "MMM d")} by ${s.connected_by}`}</p>
      </div>
      {!disconnected && (
        <div className="flex items-center gap-2">
          {s.provider === "notes" ? (
            <>
              <Button variant="ghost" onClick={() => setNote(true)} disabled={!canEdit}>Upload transcript</Button>
              <Button icon={Plus} onClick={() => setNote(true)} disabled={!canEdit}>New note</Button>
            </>
          ) : (
            <>
              {s.status !== "error" && <Button variant="ghost" loading={busy === "pause"} disabled={!canEdit} onClick={() => act("pause", () => (paused ? v2.resumeSource(projectId, s.id) : v2.pauseSource(projectId, s.id)))}>{paused ? "Resume syncing" : "Pause syncing"}</Button>}
              {s.status === "error" ? <Button variant="primary" onClick={() => setOauth(true)}>Reconnect {s.label}</Button>
                : <Button icon={RefreshCw} disabled={!canEdit || s.status === "checking"} onClick={() => act("sync", () => v2.syncSource(projectId, s.id))}>Sync now</Button>}
            </>
          )}
        </div>
      )}
    </div>
  );

  const dialogs = (
    <>
      <ChooseItemsDialog open={adding} onOpenChange={setAdding} wid={projectId} sid={s.id} provider={s.provider} onDone={() => { setAdding(false); reload(); }} />
      <AddNoteDialog open={note} onOpenChange={setNote} wid={projectId} onAdded={() => reload()} />
      <ChoiceConfirm open={!!stop} onOpenChange={(o) => !o && setStop(null)} title={`Stop reading this ${unit}?`} cta="Stop reading"
        mobileIntro={stop && `Bracket won’t read new messages in “${stop.impact.title}”.`}
        mobileOptions={[{ value: true, label: "Keep what Bracket learned", help: `${stop?.impact.total ?? 0} memories stay, marked “no longer read”.` }, { value: false, label: "Remove its memories", help: `${stop?.impact.only_here ?? 0} removed; ${stop?.impact.supported_elsewhere ?? 0} supported elsewhere stay.` }]}
        intro={stop && <>“{stop.impact.title}” · {stop.impact.from || ""}{stop.impact.messages ? ` · ${stop.impact.messages} messages` : ""}<br /><br />{stop.impact.total} memories came from this {unit}. {stop.impact.supported_elsewhere} are also supported by other sources and won’t change.</>}
        options={[
          { value: true, label: `Keep the ${stop?.impact.only_here ?? 2} memories only this ${unit} supports`, help: "Marked “source removed”. You can still see the original quotes." },
          { value: false, label: `Remove those ${stop?.impact.only_here ?? 2} memories`, help: "Recorded in Timeline. Restorable for 30 days." },
        ]}
        onConfirm={async (keep) => { const r = await v2.stopReading(projectId, s.id, stop.item.id, keep); setData((d) => ({ ...d, ...r })); setStop(null); refreshAll(); toast(`Stopped reading “${stop.impact.title}”`); }} />
      <ChoiceConfirm open={disconnect} onOpenChange={setDisconnect}
        title={<span className="flex items-center gap-2">{s.provider !== "notes" && <SourceMark provider={s.provider} size={16} />}{s.provider === "notes" ? "Delete all notes?" : `Disconnect ${s.label}?`}</span>}
        intro={s.provider === "notes" ? "Notes are removed from Bracket." : `Bracket will stop reading ${items.length} ${unit}${items.length === 1 ? "" : "s"}. Draft replies can no longer be sent through ${s.label}.`}
        cta={s.provider === "notes" ? "Delete notes" : `Disconnect ${s.label}`}
        options={[
          { value: true, label: "Keep what Bracket learned", help: `Recommended. ${s.impact?.total ?? s.learned?.total} memories stay, marked “source disconnected”.` },
          { value: false, label: `Remove memories learned only from ${s.label}`, help: `${s.impact?.only_here ?? 0} memories removed; ${Math.max(0, (s.impact?.total ?? 0) - (s.impact?.only_here ?? 0))} supported by other sources stay. Recorded in Timeline.` },
        ]}
        onConfirm={async (keep) => {
          const r = await v2.disconnectSource(projectId, s.id, keep);
          setDisconnect(false); refreshAll();
          if (mobile) { navigate(`${base}/sources`, { state: { disconnected: { sid: s.id, label: s.label, keep, kept: r.kept, removed: r.removed } } }); return; }
          navigate(`${base}/sources`);
          toast.success(keep ? `${s.label} disconnected · ${r.kept} memories kept, marked “source disconnected”` : `${s.label} disconnected · ${r.removed} memories removed`, {
            duration: 10000, action: { label: "Undo", onClick: async () => { await v2.undoDisconnect(projectId, s.id); refreshAll(); toast(`${s.label} reconnected`); } },
          });
        }} />
      <AnimatePresence>
        {oauth && <OAuthRedirect provider={s.provider} account={s.account} onCancel={() => setOauth(false)} onDone={async () => { const r = await v2.reconnected(projectId, s.id); setOauth(false); setData((d) => ({ ...d, ...r })); refreshAll(); }} />}
      </AnimatePresence>
    </>
  );

  /* Mobile — Figma › Source detail · Gmail / Slack / Notes / Syncing / Paused / Reconnected — Mobile 390. */
  if (mobile) {
    const isNotes = s.provider === "notes";
    const reconnected = s.status === "catching_up" && s.reconnected_at;
    const stopFor = async (t) => setStop({ item: t, impact: await v2.itemImpact(projectId, s.id, t.id) });
    return (
      <div className="flex h-full flex-col">
        <MobileSubHeader title={s.label} onBack={() => navigate(`${base}/sources`)}
          actions={(
            <Menu>
              <MenuTrigger asChild><IconButton icon={MoreHorizontal} label="More" size="l" /></MenuTrigger>
              <MenuContent align="end" className="w-[220px]">
                <MenuItem icon={History} onSelect={() => navigate(`${base}/timeline?source=${s.provider}`)}>Recent activity</MenuItem>
                {!isNotes && <MenuItem icon={ExternalLink} onSelect={() => window.open(s.provider === "gmail" ? "https://mail.google.com" : "https://slack.com", "_blank", "noopener")}>Open {s.label}</MenuItem>}
              </MenuContent>
            </Menu>
          )} />
        <div className="scroll-pane min-h-0 flex-1 px-4 pt-4 pb-6">
          <AnimatePresence initial={false}>
            {reconnected && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={T.base} className="overflow-hidden">
                <div role="status" className="mb-4 flex items-start gap-3 rounded-lg border border-info/70 bg-info-bg px-4 py-3">
                  <Info size={16} className="mt-0.5 shrink-0 text-info" />
                  <div><p className="text-body-m text-fg">Reconnected</p><p className="text-body-s text-fg-secondary">Bracket is reading what it missed since {format(new Date(s.catching_up.since), "MMM d")}. New updates will show up for review.</p></div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <div className="flex items-center gap-3">
            {isNotes ? <FileText size={22} className="shrink-0 text-fg-secondary" /> : <SourceMark provider={s.provider} size={26} />}
            <div className="min-w-0">
              <p className="truncate text-body-m text-fg">{isNotes ? "Added in Bracket" : s.account}</p>
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.div key={s.status} initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={T.fast}>
                  {isNotes ? <span className="inline-flex items-center gap-2 text-[12px] text-fg-secondary"><span className="h-1.5 w-1.5 rounded-full bg-success" />Processed {format(new Date(s.last_sync_at || Date.now()), "MMM d")}</span>
                    : s.status === "catching_up" ? <span className="inline-flex items-center gap-2 text-[12px] text-fg-secondary"><Loader2 size={14} className="animate-spin text-info" />Catching up · {s.catching_up?.done ?? 0} of {s.catching_up?.total ?? 0} emails</span>
                      : s.status === "checking" ? <span className="inline-flex items-center gap-2 text-[12px] text-fg-secondary"><Loader2 size={14} className="animate-spin text-info" />Checking for new {s.provider === "gmail" ? "emails" : "messages"}…</span>
                        : s.status === "paused" ? <span className="inline-flex items-center gap-2 text-[12px] text-fg-secondary"><span className="h-1.5 w-1.5 rounded-full bg-fg-tertiary" />Paused by you</span>
                          : <SourceStatus s={s} short />}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
          {!isNotes && !disconnected && (
            <div className="mt-4 flex gap-3">
              {s.status === "error" ? <Button size="l" variant="primary" className="flex-1" onClick={() => setOauth(true)}>Reconnect {s.label}</Button> : (
                <>
                  <Button size="l" className="flex-1" icon={RefreshCw} disabled={!canEdit || s.status === "checking"} onClick={() => act("sync", () => v2.syncSource(projectId, s.id))}>Sync now</Button>
                  <Button size="l" className="flex-1" loading={busy === "pause"} disabled={!canEdit} onClick={() => act("pause", () => (paused ? v2.resumeSource(projectId, s.id) : v2.pauseSource(projectId, s.id)))}>{paused ? "Resume" : "Pause"}</Button>
                </>
              )}
            </div>
          )}
          <p className="eyebrow mt-6 mb-3">{isNotes ? `Notes · ${items.length}` : `Reads · ${items.length} ${unit}${items.length === 1 ? "" : "s"}`}</p>
          <Stagger as="ul" className="overflow-hidden rounded-lg border border-line divide-y divide-line-subtle">
            {items.map((t) => (
              <StaggerItem as="li" key={t.id} className="flex items-center gap-3 py-2 pl-4 pr-2">
                <button onClick={() => (isNotes ? navigate(`${base}/conversations/${t.id}`) : setThreadSheet(t))} className="min-w-0 flex-1 py-1 text-left">
                  <span className="block truncate text-body-s text-fg">{t.subject || t.name || t.title}</span>
                  <span className="block text-body-s text-fg-tertiary">{t.reading ? "Reading…" : isNotes ? `${format(new Date(t.at), "MMM d")} · ${t.memories} memories` : `${t.memories} memories`}</span>
                </button>
                <IconButton icon={MoreHorizontal} label={`${t.subject || t.name || t.title} options`} size="l" onClick={() => setThreadSheet(t)} />
              </StaggerItem>
            ))}
          </Stagger>
          {!disconnected && <Button className="mt-4" icon={Plus} disabled={!canEdit} onClick={() => (isNotes ? setNote(true) : setAdding(true))}>{kind === "channels" ? "Add channels" : isNotes ? "Add note" : "Add threads"}</Button>}
        </div>
        <div className="shrink-0 border-t border-line-subtle px-4 pt-3 pb-3 safe-bottom">
          {disconnected ? <Button size="l" variant="primary" className="w-full" disabled={!canEdit} onClick={() => setOauth(true)}>Reconnect {s.label}</Button>
            : <Button size="l" variant="danger" className="w-full" disabled={!canEdit} onClick={() => setDisconnect(true)}>{isNotes ? "Remove all notes" : `Disconnect ${s.label}`}</Button>}
        </div>

        {/* Figma › Source detail · Thread actions — Mobile 390 (73:15188) */}
        <Sheet open={!!threadSheet} onOpenChange={(o) => !o && setThreadSheet(null)} title={threadSheet?.subject || threadSheet?.name || threadSheet?.title || ""}
          description={threadSheet ? `${threadSheet.messages ? `${threadSheet.messages} messages · ` : ""}${threadSheet.memories} memories came from this ${unit}` : undefined}>
          {threadSheet && (
            <div className="-mx-1">
              {[
                !isNotes && [ExternalLink, `Open in ${s.label}`, () => window.open(s.provider === "gmail" ? "https://mail.google.com" : "https://slack.com", "_blank", "noopener")],
                [Layers, "See what it taught Bracket", () => navigate(`${base}/memory?q=${encodeURIComponent((threadSheet.subject || threadSheet.name || "").replace(/^Re: /, "").split(" — ")[0])}&find=1`)],
                [X, isNotes ? "Remove this note" : `Stop reading this ${unit}`, () => { const t = threadSheet; setThreadSheet(null); stopFor(t); }, true],
              ].filter(Boolean).map(([Icon, l, fn, danger]) => (
                <button key={l} onClick={fn} disabled={danger && !canEdit} className={cn("flex h-12 w-full items-center gap-3 rounded-md px-2 text-body-m hover:bg-hover disabled:opacity-40", danger ? "text-danger" : "text-fg")}>
                  <Icon size={18} /> {l}
                </button>
              ))}
            </div>
          )}
        </Sheet>
        {dialogs}
      </div>
    );
  }

  const banner = paused ? { tone: "neutral", icon: Info, text: `Paused. New ${s.label} messages aren’t being read. Nothing already learned changes.` }
    : s.status === "catching_up" && s.reconnected_at ? { tone: "success", icon: CheckCircle2, text: `${s.label} reconnected. Reading ${s.catching_up.total} emails that arrived while disconnected (since ${format(new Date(s.catching_up.since), "MMM d, HH:mm")}).` }
      : s.status === "error" ? { tone: "danger", icon: Unlink, text: `${s.error || "Access expired"}. New messages since then haven’t been read.` }
        : disconnected ? { tone: "neutral", icon: Info, text: `Disconnected ${format(new Date(s.disconnected_at), "MMM d")}. ${s.kept_memory === false ? "Memory learned only from this source was removed." : "What Bracket learned is kept, marked “source disconnected”."}` } : null;

  const main = (
    <div className="min-w-0 space-y-6">
      <section>
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-title-s text-fg">What Bracket reads</h2>
          <span className="font-mono text-[12px] text-fg-tertiary">{items.length} {unit}{items.length === 1 ? "" : "s"}{kind !== "notes" ? ` · ${num(kind === "channels" ? s.progress?.total || totalMsgs : totalMsgs)} messages` : ""}</span>
          <span className="flex-1" />
          {!disconnected && <Button size="s" icon={Plus} disabled={!canEdit} onClick={() => (kind === "notes" ? setNote(true) : setAdding(true))}>{kind === "channels" ? "Add channels" : kind === "notes" ? "Add note" : "Add threads"}</Button>}
        </div>
        <Stagger className="overflow-hidden rounded-lg border border-line divide-y divide-line-subtle">
          {items.map((t) => (
            <StaggerItem key={t.id} className="flex items-center gap-3 px-4 py-3">
              {kind === "channels" ? <Hash size={16} className="text-fg-tertiary" /> : kind === "notes" ? <FileText size={16} className="text-fg-tertiary" /> : <Mail size={16} className="text-fg-tertiary" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] text-fg">{t.subject || t.name || t.title}</span>
                <span className="block text-[12px] text-fg-tertiary">{kind === "channels" ? (t.meta || `${t.members} members`) : kind === "notes" ? `${format(new Date(t.at), "MMM d")} · ${t.memories} memories` : `${t.from} · ${t.messages} msgs`}</span>
              </span>
              {kind !== "notes" && <span className="hidden font-mono text-[12px] text-fg-secondary sm:inline">{t.reading ? <span className="inline-flex items-center gap-1.5 text-info"><RefreshCw size={12} className="animate-spin" /> Reading…</span> : `${t.memories} memories`}</span>}
              {kind === "notes" ? <Button size="s" variant="ghost" onClick={() => navigate(`${base}/conversations/${t.id}`)}>Open</Button>
                : <Button size="s" variant="ghost" disabled={!canEdit || disconnected} onClick={async () => setStop({ item: t, impact: await v2.itemImpact(projectId, s.id, t.id) })}>Stop reading</Button>}
            </StaggerItem>
          ))}
        </Stagger>
      </section>
      {s.auto_include && (
        <div className="flex items-center gap-4 rounded-lg border border-line px-4 py-3">
          <div className="min-w-0 flex-1"><p className="text-[12px] text-fg">{s.auto_include.label}</p><p className="text-[12px] text-fg-tertiary">{s.auto_include.help}</p></div>
          <Toggle checked={s.auto_include.enabled} disabled={!canEdit || disconnected} label={s.auto_include.label}
            onChange={async (v) => { setData((d) => ({ ...d, auto_include: { ...d.auto_include, enabled: v } })); await v2.updateSource(projectId, s.id, { auto_include: { enabled: v } }); }} />
        </div>
      )}
      <section>
        <div className="mb-3 flex items-center"><h2 className="flex-1 text-title-s text-fg">Recent activity</h2><Link to={`${base}/timeline?source=${s.provider}`} className="text-[12px] font-medium text-fg-secondary hover:text-fg">View in Timeline</Link></div>
        <div className="overflow-hidden rounded-lg border border-line divide-y divide-line-subtle">
          {(s.activity || []).slice(0, 5).map((a, i) => (
            <div key={i} className="flex gap-4 px-4 py-3 text-[12px]">
              <span className="w-[72px] shrink-0 font-mono text-fg-tertiary">{relShort(a.at)}</span>
              <span className="text-fg-secondary">{a.text}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );

  const side = (
    <aside className="space-y-4">
      <div className="rounded-lg border border-line p-4">
        <div className="flex items-center"><p className="flex-1 text-body-m font-medium text-fg">Learned from {s.provider === "notes" ? "notes" : s.label}</p><span className="font-mono text-[12px] text-fg-tertiary">{s.learned?.total}</span></div>
        <div className="mt-3 space-y-2.5">
          {Object.entries(s.learned?.by || {}).map(([k, v]) => <div key={k} className="flex text-[12px]"><span className="flex-1 text-fg-secondary">{CAT[k] || k}</span><span className="font-mono text-fg-tertiary">{v}</span></div>)}
        </div>
        {s.learned?.corroborated > 0 && <p className="mt-3 text-[12px] text-fg-tertiary">{s.learned.corroborated} of these are also supported by {s.provider === "gmail" ? "Slack or Notes" : s.provider === "slack" ? "Gmail or Notes" : "Gmail or Slack"}.</p>}
      </div>
      <div className="rounded-lg border border-line p-4">
        <p className="text-body-m font-medium text-fg">Permissions</p>
        {[
          ["read", s.provider === "notes" ? "Read notes you add" : `Read selected ${unit}s`, "Required", true],
          ["send", s.provider === "notes" ? "Share notes with members" : s.provider === "slack" ? "Post replies you approve" : "Send replies you approve", "Each message needs your OK", false],
        ].map(([k, l, h, req]) => (
          <div key={k} className="mt-3 flex items-center gap-3">
            <div className="flex-1"><p className="text-[12px] text-fg">{l}</p><p className="text-[12px] text-fg-tertiary">{h}</p></div>
            <Toggle checked={!!s.permissions?.[k]} disabled={!req && (!canEdit || disconnected)} label={l}
              onChange={async (v) => { if (req) { toast("Bracket needs this to read your sources"); return; } setData((d) => ({ ...d, permissions: { ...d.permissions, [k]: v } })); await v2.updateSource(projectId, s.id, { permissions: { [k]: v } }); toast(v ? "Permission granted" : "Bracket will no longer send from here"); }} />
          </div>
        ))}
      </div>
      <div className="rounded-lg border border-line p-4">
        <p className="text-body-m font-medium text-fg">{disconnected ? "Reconnect" : "Disconnect"}</p>
        <p className="mt-2 text-[12px] text-fg-secondary">{disconnected ? `Start reading ${s.label} again. Bracket catches up on what it missed.` : s.provider === "notes" ? "Deleting all notes removes them and, if you choose, what Bracket learned from them." : `Stops reading ${s.label}. You choose whether to keep what Bracket learned.`}</p>
        {disconnected ? <Button className="mt-3" variant="primary" onClick={() => setOauth(true)} disabled={!canEdit}>Reconnect {s.label}</Button>
          : <Button className="mt-3" variant="danger" onClick={() => setDisconnect(true)} disabled={!canEdit}>{s.provider === "notes" ? "Delete all notes" : `Disconnect ${s.label}`}</Button>}
      </div>
    </aside>
  );

  return (
    <div className="flex h-full flex-col">
      {mobile && <MobileSubHeader title={s.label} onBack={() => navigate(`${base}/sources`)} />}
      <div className="scroll-pane min-h-0 flex-1">
        <div className="mx-auto max-w-[1600px] px-4 pt-4 pb-12 md:px-8 md:pt-6">
          {header}
          <AnimatePresence initial={false}>
            {banner && (
              <motion.div key={banner.text} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={T.base} className="overflow-hidden">
                <div className={cn("mt-5 flex items-center gap-3 rounded-lg border px-4 py-3 text-[12px]", banner.tone === "success" ? "border-success/60 bg-success-bg text-fg" : banner.tone === "danger" ? "border-danger/60 bg-danger-bg text-fg" : "border-line bg-surface text-fg-secondary")} role="status">
                  <banner.icon size={16} className={banner.tone === "success" ? "text-success" : banner.tone === "danger" ? "text-danger" : "text-fg-tertiary"} /> {banner.text}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_336px]">{main}{side}</div>
        </div>
      </div>

      {dialogs}
    </div>
  );
}

function relShort(iso) {
  const d = new Date(iso);
  if (d.toDateString() === new Date().toDateString()) return format(d, "HH:mm");
  if (d.toDateString() === new Date(Date.now() - 864e5).toDateString()) return "Yesterday";
  return format(d, "MMM d");
}
