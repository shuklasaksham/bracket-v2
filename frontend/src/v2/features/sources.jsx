import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Info, FileText, Paperclip, Upload, Loader2, Unlink, Mic, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { v2 } from "../lib/api2";
import { refreshAll } from "../lib/workspace";
import { useResource } from "../lib/data";
import { Badge, Button, Checkbox, Input, SourceMark } from "../ui/primitives";
import { Dialog, FullScreen, Menu, MenuContent, MenuItem, MenuTrigger, Sheet } from "../ui/overlays";
import { useIsMobile } from "../lib/useMedia";
import { AnimatePresence, motion, t as T } from "../ui/motion";
import { cn } from "../../lib/utils";

/* Sources & files — dialogs and status helpers shared by Sources, Source
   detail, Files, Overview (empty state) and onboarding.
   Figma › Sources · Add source (picker), Add Slack — choose channels, Add note,
   Note added, Source detail · Add threads, Stop reading, Disconnect, Paused,
   Reconnected, Redirecting to Google, Files · Uploading, Delete file. */

const since = (iso) => {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return format(new Date(iso), "MMM d");
};
export const num = (n) => Number(n || 0).toLocaleString("en-US");

/* Status line used in the sources table and the detail header. */
export function SourceStatus({ s, short }) {
  const spin = (text) => <span className="inline-flex items-center gap-2 text-[12px] text-fg-secondary"><Loader2 size={14} className="animate-spin text-info" />{text}</span>;
  const dot = (cls, text) => <span className="inline-flex items-center gap-2 text-[12px] text-fg-secondary"><span className={cn("h-1.5 w-1.5 rounded-full", cls)} />{text}</span>;
  switch (s.status) {
    case "syncing": return spin(s.progress ? `Syncing… ${num(s.progress.done)} of ${num(s.progress.total)}` : "Syncing…");
    case "checking": return spin(s.checking_text || "Checking for new messages…");
    case "catching_up": return spin(`Catching up · ${s.catching_up?.done ?? 0} of ${s.catching_up?.total ?? 0} new ${s.provider === "gmail" ? "emails" : "messages"}`);
    case "paused": return dot("bg-fg-tertiary", `Paused by ${s.paused_by || "you"}${s.paused_at ? ` · ${format(new Date(s.paused_at), "HH:mm")}` : ""}`);
    case "disconnected": return dot("bg-fg-tertiary", `Disconnected · ${format(new Date(s.disconnected_at), "MMM d")}`);
    case "error": return <span className="inline-flex items-center gap-2 text-[12px] text-danger"><Unlink size={14} />Needs reconnect</span>;
    default:
      if (s.provider === "notes") return dot("bg-success", `Processed ${format(new Date(s.last_sync_at), "MMM d")}`);
      return dot("bg-success", short ? `Synced ${since(s.last_sync_at)}` : `Synced ${since(s.last_sync_at)}`);
  }
}

/* ───────────────────────── Add source picker ───────────────────────── */
const TILES = [
  { key: "slack", label: "Slack", sub: "Channels" },
  { key: "gmail", label: "Gmail", sub: "Email threads" },
  { key: "notes", label: "Notes", sub: "Paste or write", icon: FileText },
  { key: "files", label: "Files", sub: "PDF, DOCX, images", icon: FileText },
  { key: "figma", label: "Figma", sub: "Comments, versions", letter: "F" },
  { key: "github", label: "GitHub", sub: "Issues, PRs", letter: "G" },
  { key: "notion", label: "Notion", sub: "Coming soon", letter: "N", soon: true },
  { key: "jira", label: "Jira", sub: "Coming soon", letter: "J", soon: true },
  { key: "meetings", label: "Meetings", sub: "Coming soon", icon: Mic, soon: true },
];
export function AddSourceDialog({ open, onOpenChange, sources, onPick }) {
  const connected = new Set((sources || []).filter((s) => s.status !== "disconnected").map((s) => s.provider));
  const mobile = useIsMobile();
  if (mobile) {
    const order = ["slack", "gmail", "notes", "files", "figma", "github", "notion", "jira", "meetings"];
    return (
      <Sheet open={open} onOpenChange={onOpenChange} title="Add a source" description="Bracket only reads what you choose in the next step.">
        <ul className="overflow-hidden rounded-lg border border-line divide-y divide-line-subtle">
          {order.map((k) => TILES.find((t) => t.key === k)).map((t) => {
            const isConnected = connected.has(t.key) && t.key !== "slack" && t.key !== "notes";
            return (
              <li key={t.key}>
                <button disabled={t.soon || isConnected} onClick={() => onPick(t.key)} className={cn("flex min-h-[56px] w-full items-center gap-3 px-4 py-2 text-left active:bg-hover", t.soon && "opacity-55")}>
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center">
                    {t.icon ? <t.icon size={16} className="text-fg-secondary" /> : t.letter ? <span className="flex h-5 w-5 items-center justify-center rounded bg-white/[0.08] text-[10px] font-semibold text-fg-secondary">{t.letter}</span> : <SourceMark provider={t.key} size={16} />}
                  </span>
                  <span className="min-w-0 flex-1"><span className="block text-body-m text-fg">{t.label}</span><span className="block text-body-s text-fg-tertiary">{isConnected ? "Connected" : t.sub === "Email threads" ? "Threads" : t.sub}</span></span>
                  {isConnected ? <Badge tone="success" dot>Connected</Badge> : !t.soon && <ChevronRight size={16} className="text-fg-tertiary" />}
                </button>
              </li>
            );
          })}
        </ul>
      </Sheet>
    );
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Add a source" description="Bracket only reads what you choose in the next step." size="l">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {TILES.map((t, i) => {
          const isConnected = connected.has(t.key) && t.key !== "slack";
          return (
            <motion.button key={t.key} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ ...T.base, delay: i * 0.02 }}
              disabled={t.soon} onClick={() => onPick(t.key)}
              className={cn("flex h-[60px] items-center gap-3 rounded-md border px-3 text-left transition-colors duration-fast", t.soon ? "border-line opacity-60" : "border-line-control hover:border-fg hover:bg-hover")}>
              <span className="flex h-6 w-6 shrink-0 items-center justify-center">
                {t.icon ? <t.icon size={16} className="text-fg-secondary" /> : t.letter ? <span className="flex h-5 w-5 items-center justify-center rounded bg-white/[0.08] text-[10px] font-semibold text-fg-secondary">{t.letter}</span> : <SourceMark provider={t.key} size={18} />}
              </span>
              <span className="min-w-0">
                <span className="block text-[12px] font-medium text-fg">{t.label}</span>
                <span className={cn("block text-[12px]", isConnected ? "text-success" : "text-fg-tertiary")}>{isConnected ? "Connected" : t.sub}</span>
              </span>
            </motion.button>
          );
        })}
      </div>
    </Dialog>
  );
}

/* ───────────────────────── Choose Slack channels / Gmail threads ───────────────────────── */
export function ChooseItemsDialog({ open, onOpenChange, wid, sid, provider, onDone, onBack }) {
  const { data } = useResource(() => (open ? (sid ? v2.sourceCandidates(wid, sid) : v2.candidates(wid, provider)) : Promise.resolve(null)), [open, wid, sid, provider]);
  const [sel, setSel] = useState(new Set());
  const [q, setQ] = useState("");
  const [range, setRange] = useState("Last 90 days");
  const [busy, setBusy] = useState(false);
  const mobile = useIsMobile();
  useEffect(() => { if (data) setSel(new Set(data.items.filter((i) => i.suggested || i.connected).map((i) => i.id))); }, [data]);
  const channels = (data?.kind || (provider === "slack" ? "channels" : "threads")) === "channels";
  const items = (data?.items || []).filter((i) => !q || `${i.name} ${i.meta}`.toLowerCase().includes(q.toLowerCase()));
  const picked = (data?.items || []).filter((i) => sel.has(i.id) && !i.connected);
  const messages = picked.reduce((n, i) => n + (i.messages || 0), 0);
  const toggle = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const submit = async () => {
    setBusy(true);
    try {
      if (sid) await v2.addThreads(wid, sid, picked.map((i) => i.id)); else await v2.addSource(wid, provider, [...sel]);
      refreshAll();
      toast.success(channels ? `Connecting ${picked.length || sel.size} channel${(picked.length || sel.size) === 1 ? "" : "s"}` : `Reading ${picked.length} thread${picked.length === 1 ? "" : "s"}`, { description: "New memory goes to review if it changes anything." });
      onDone?.();
    } finally { setBusy(false); }
  };
  const count = channels ? sel.size : picked.length;
  if (mobile && channels) {
    return (
      <FullScreen open={open} onOpenChange={onOpenChange} title="Add Slack"
        footer={<><Button variant="ghost" onClick={onBack || (() => onOpenChange(false))}>Cancel</Button><Button variant="primary" loading={busy} disabled={!count} onClick={submit}>Add {count} channel{count === 1 ? "" : "s"}</Button></>}>
        <p className="flex items-center gap-2 text-body-s text-fg-tertiary"><SourceMark provider="slack" size={14} />{data?.account || "Northlight Studio"} · signed in as Maya</p>
        <p className="mt-4 text-body-m text-fg">Choose the channels Bracket can read. It never posts or reacts.</p>
        <label className="mt-4 block text-body-s text-fg-secondary" htmlFor="ch-q">Search channels</label>
        <Input id="ch-q" className="mt-2 h-11" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Channel name" />
        <div className="mt-4 overflow-hidden rounded-lg border border-line divide-y divide-line-subtle">
          {!data && <p className="px-4 py-4 text-[12px] text-fg-tertiary">Loading…</p>}
          {items.map((i) => (
            <label key={i.id} htmlFor={`pick-${i.id}`} className="flex cursor-pointer items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1"><span className="block text-body-m text-fg">{i.name}</span><span className="block text-body-s text-fg-tertiary">{i.meta}</span></span>
              <Checkbox id={`pick-${i.id}`} checked={sel.has(i.id)} onChange={() => toggle(i.id)} />
            </label>
          ))}
        </div>
      </FullScreen>
    );
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="l"
      title={<span className="flex items-center gap-2"><SourceMark provider={channels ? "slack" : "gmail"} size={16} />{channels ? "Choose Slack channels" : "Add Gmail threads"}</span>}
      description={channels ? `${data?.account || "Northlight Studio"} workspace · Bracket reads only these channels. Direct messages are never read.` : undefined}
      footer={<>
        <Button variant="ghost" onClick={onBack || (() => onOpenChange(false))}>{onBack ? "Back" : "Cancel"}</Button>
        <Button variant="primary" loading={busy} disabled={!count} onClick={submit}>{channels ? `Connect ${count} channel${count === 1 ? "" : "s"}` : `Add ${count} thread${count === 1 ? "" : "s"}`}</Button>
      </>}>
      {!channels && (
        <label className="mb-4 flex h-9 items-center gap-2 rounded-md border border-line-control px-3 focus-within:border-fg">
          <Search size={16} className="text-fg-tertiary" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by subject, person or domain" className="flex-1 bg-transparent text-[12px] text-fg placeholder:text-fg-tertiary outline-none" aria-label="Search threads" />
        </label>
      )}
      {!channels && <p className="eyebrow mb-3">Suggested · {data?.suggest_label || "Mention the client"}</p>}
      <div className="overflow-hidden rounded-lg border border-line divide-y divide-line-subtle">
        {!data && <p className="px-4 py-4 text-[12px] text-fg-tertiary">Loading…</p>}
        {items.map((i) => (
          <label key={i.id} htmlFor={`pick-${i.id}`} className="flex cursor-pointer items-center gap-3 px-3 py-3 transition-colors duration-fast hover:bg-hover">
            <Checkbox id={`pick-${i.id}`} checked={sel.has(i.id)} disabled={i.connected && channels && false} onChange={() => toggle(i.id)} />
            <span className="min-w-0 flex-1"><span className="block truncate text-[12px] font-medium text-fg">{i.name}</span><span className="block text-[12px] text-fg-tertiary">{i.meta}</span></span>
            {i.badge && <Badge tone="info">{i.badge}</Badge>}
          </label>
        ))}
        {data && items.length === 0 && <p className="px-4 py-4 text-[12px] text-fg-tertiary">Nothing matches “{q}”.</p>}
      </div>
      {channels ? (
        <div className="mt-4 flex items-center justify-between">
          <span className="text-[12px] text-fg-secondary">Read history from</span>
          <Menu>
            <MenuTrigger asChild><Button>{range}</Button></MenuTrigger>
            <MenuContent>{["Last 30 days", "Last 90 days", "Last 12 months", "Everything"].map((r) => <MenuItem key={r} checked={r === range} onSelect={() => setRange(r)}>{r}</MenuItem>)}</MenuContent>
          </Menu>
        </div>
      ) : count > 0 && (
        <p className="mt-3 flex items-center gap-2 text-[12px] text-fg-tertiary"><Info size={14} /> Bracket will read {count} thread{count === 1 ? "" : "s"} ({messages} messages). New memory from them goes to review if it changes anything.</p>
      )}
    </Dialog>
  );
}

/* ───────────────────────── Add note ───────────────────────── */
export function AddNoteDialog({ open, onOpenChange, wid, onAdded, quiet }) {
  const mobile = useIsMobile();
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [people, setPeople] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const fileRef = useRef(null);
  const navigate = useNavigate();
  useEffect(() => { if (open) { setTitle(`Call notes — ${format(new Date(), "MMM d")}`); setText(""); setPeople([]); setErr(null); } }, [open]);
  const detected = useMemo(() => ["Sarah Chen", "James Park", "Maya Rao", "Dev Patel", "Lena Torres"].filter((n) => text.toLowerCase().includes(n.split(" ")[0].toLowerCase()) || /\bmaya\b/i.test(text) && n === "Maya Rao"), [text]);
  useEffect(() => setPeople(detected), [detected]);
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await v2.addNote(wid, title, text, people);
      onOpenChange(false);
      refreshAll();
      onAdded?.(res);
      if (quiet && !res.nothing_new) return;
      if (res.nothing_new) toast("Nothing new found", { description: `Bracket read “${title}” but everything in it already matches memory.` });
      else toast.success(`Bracket found ${res.found} things in “${title}” · ${res.needs_review} needs review`, { action: res.review_id ? { label: "Review", onClick: () => navigate(`/w/${wid}/review/${res.review_id}`) } : undefined, duration: 10000 });
    } catch (e) { setErr(e?.response?.data?.detail || "Couldn’t add the note"); } finally { setBusy(false); }
  };
  if (mobile) {
    return (
      <FullScreen open={open} onOpenChange={onOpenChange} title="Add note"
        footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" loading={busy} disabled={text.trim().length < 3} onClick={submit}>Add to Bracket</Button></>}>
        <label className="block text-body-s text-fg-secondary">Title<Input className="mt-2 h-11" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="mt-4 block text-body-s text-fg-secondary">Note
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={10} placeholder="Paste meeting notes, a call transcript or a brainstorm…"
            className="mt-2 w-full rounded-md border border-line-control bg-app px-3 py-3 text-body-m text-fg placeholder:text-fg-tertiary outline-none transition-colors duration-fast focus:border-fg" />
        </label>
        <p className="mt-2 text-body-s text-fg-tertiary">Paste notes or a transcript. Bracket reads it once and links what it learns to this note.</p>
        <AnimatePresence>{err && <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-2 text-body-s text-danger">{err}</motion.p>}</AnimatePresence>
      </FullScreen>
    );
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="l" title={<span className="flex items-center gap-2"><FileText size={16} /> Add note</span>}
      footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" loading={busy} disabled={text.trim().length < 3} onClick={submit}>Add to Bracket</Button></>}>
      <label className="block"><span className="mb-2 block text-[12px] font-medium text-fg-secondary">Title</span><Input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
      <label className="mt-4 block"><span className="mb-2 block text-[12px] font-medium text-fg-secondary">Notes or transcript</span>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} autoFocus placeholder="Paste meeting notes, a call transcript or a brainstorm…"
          className="w-full rounded-md border border-line-control bg-surface px-3 py-2.5 text-[12px] leading-[18px] text-fg placeholder:text-fg-tertiary outline-none transition-colors duration-fast focus:border-fg" />
      </label>
      <AnimatePresence>{err && <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-2 text-[12px] text-danger">{err}</motion.p>}</AnimatePresence>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-[12px] text-fg-tertiary">Who was there?</span>
        {people.map((n) => <button key={n} onClick={() => setPeople((p) => p.filter((x) => x !== n))}><Badge>{n}</Badge></button>)}
        {!people.length && <span className="text-[12px] text-fg-tertiary">Bracket picks names up from the text</span>}
      </div>
      <button onClick={() => fileRef.current?.click()} className="mt-3 flex items-center gap-2 text-[12px] text-fg-secondary hover:text-fg"><Paperclip size={14} /> Or drop a transcript file (.txt, .vtt, .docx, .pdf)</button>
      <input ref={fileRef} type="file" accept=".txt,.vtt,.docx,.pdf" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f && /\.(txt|vtt)$/i.test(f.name)) setText(await f.text()); else if (f) setTitle(f.name.replace(/\.[^.]+$/, "")); }} />
    </Dialog>
  );
}

/* ───────────────────────── Radio-choice confirm (disconnect / stop reading / delete) ───────────────────────── */
export function ChoiceConfirm({ open, onOpenChange, title, intro, options: desktopOptions, cta, onConfirm, danger = true, mobileIntro, mobileOptions }) {
  const mobile = useIsMobile();
  const options = (mobile && mobileOptions) || desktopOptions;
  if (mobile && mobileIntro) intro = mobileIntro;
  const [v, setV] = useState(options[0]?.value);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setV(options[0]?.value); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title}
      footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant={danger ? "danger" : "primary"} loading={busy} onClick={async () => { setBusy(true); try { await onConfirm(v); } finally { setBusy(false); } }}>{cta}</Button></>}>
      {intro && <p className="mb-4 text-[12px] text-fg-secondary">{intro}</p>}
      <div role="radiogroup" className="space-y-3">
        {options.map((o) => {
          const on = v === o.value;
          return (
            <button key={String(o.value)} role="radio" aria-checked={on} onClick={() => setV(o.value)}
              className={cn("flex w-full items-start gap-3 rounded-md border p-3 text-left transition-colors duration-fast", on ? "border-fg bg-surface" : "border-line-control hover:border-line-strong")}>
              <span className={cn("mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors duration-fast", on ? "border-fg bg-fg" : "border-line-control")}>{on && <span className="h-1.5 w-1.5 rounded-full bg-app" />}</span>
              <span><span className="block text-body-m text-fg">{o.label}</span><span className="block text-[12px] text-fg-tertiary">{o.help}</span></span>
            </button>
          );
        })}
      </div>
    </Dialog>
  );
}

/* ───────────────────────── Upload ───────────────────────── */
export function UploadDialog({ open, onOpenChange, wid, initialFiles }) {
  const [items, setItems] = useState([]);
  const fileRef = useRef(null);
  const navigate = useNavigate();
  const start = async (files) => {
    const list = [...files].map((f) => ({ key: `${f.name}-${f.size}-${Math.random()}`, name: f.name, size: f.size, state: "uploading" }));
    setItems((s) => [...list, ...s]);
    for (const it of list) {
      const res = await v2.uploadFile(wid, { name: it.name, size: it.size }).catch(() => null);
      setItems((s) => s.map((x) => (x.key === it.key ? { ...x, id: res?.id, state: res?.status || "failed", reason: res?.reason, progress: res?.progress } : x)));
    }
    refreshAll();
  };
  useEffect(() => { if (open && initialFiles?.length) start(initialFiles); if (!open) setItems([]); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open || !items.some((i) => i.state === "reading" || i.state === "uploading")) return undefined;
    const id = setInterval(async () => {
      const { files } = await v2.files(wid);
      setItems((s) => s.map((x) => { const f = files.find((y) => y.id === x.id); return f ? { ...x, state: f.status, progress: f.progress, reason: f.reason, contributed: f.contributed } : x; }));
    }, 700);
    return () => clearInterval(id);
  }, [open, items, wid]);
  const proposed = items.filter((i) => i.state === "in_memory").reduce((n, i) => n + (i.contributed?.proposed || 0), 0);
  const kb = (n) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Upload files"
      footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>{proposed > 0 ? <Button variant="primary" onClick={() => { onOpenChange(false); navigate(`/w/${wid}/memory/needs-review`); }}>Review {proposed} memories</Button> : <Button icon={Upload} onClick={() => fileRef.current?.click()}>Choose files</Button>}</>}>
      {items.length === 0 ? (
        <button onClick={() => fileRef.current?.click()} className="flex w-full flex-col items-center gap-2 rounded-lg border border-dashed border-line-control px-4 py-8 text-center transition-colors duration-fast hover:border-fg">
          <Upload size={18} className="text-fg-secondary" /><span className="text-[12px] text-fg">Drop files here or choose from your computer</span><span className="text-[12px] text-fg-tertiary">PDF, DOCX, TXT, images · up to 50 MB each</span>
        </button>
      ) : (
        <div className="space-y-4">
          {items.map((i) => {
            const pct = i.state === "in_memory" || i.state === "nothing_new" ? 100 : i.progress ? (i.progress.done / i.progress.total) * 100 : i.state === "uploading" ? 15 : 0;
            const tone = i.state === "in_memory" ? "bg-success" : ["not_supported", "failed", "too_large"].includes(i.state) ? "bg-danger" : "bg-info";
            return (
              <div key={i.key}>
                <div className="flex items-center gap-2 text-[12px]"><FileText size={14} className="text-fg-secondary" /><span className="flex-1 truncate text-fg">{i.name}</span><span className="font-mono text-fg-tertiary">{kb(i.size)}</span></div>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">{["not_supported", "failed", "too_large"].includes(i.state) ? null : <motion.div className={cn("h-full rounded-full", tone)} animate={{ width: `${pct}%` }} transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }} />}</div>
                <p className={cn("mt-1.5 text-[12px]", i.state === "in_memory" ? "text-success" : ["not_supported", "failed", "too_large"].includes(i.state) ? "text-danger" : "text-fg-tertiary")}>
                  {i.state === "uploading" ? "Uploading…" : i.state === "reading" ? "Reading…" : i.state === "in_memory" ? `Read · ${i.contributed?.proposed || 0} memories proposed` : i.state === "nothing_new" ? "Read · nothing new found" : i.state === "not_supported" ? "Not supported — add a transcript instead" : i.reason || "Couldn’t read"}
                </p>
              </div>
            );
          })}
          <p className="text-[12px] text-fg-tertiary">You can close this — files keep processing in the background.</p>
        </div>
      )}
      <input ref={fileRef} type="file" multiple hidden onChange={(e) => e.target.files?.length && start(e.target.files)} />
    </Dialog>
  );
}

/* Full-screen OAuth hand-off (Figma › Reconnect · Redirecting to Google). */
export function OAuthRedirect({ provider, account, onCancel, onDone }) {
  useEffect(() => { const id = setTimeout(onDone, 1800); return () => clearTimeout(id); }, [onDone]);
  const name = provider === "gmail" ? "Google" : provider === "slack" ? "Slack" : provider;
  return (
    <motion.div className="bk fixed inset-0 z-[60] flex flex-col items-center justify-center bg-app px-6 text-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={T.base} role="status" aria-live="polite">
      <Loader2 size={16} className="animate-spin text-fg-secondary" />
      <p className="mt-4 text-body-m font-medium text-fg">Opening {name} to reconnect {provider === "gmail" ? "Gmail" : name}…</p>
      <p className="mt-3 text-[12px] text-fg-tertiary">Approve access for {account}. You’ll come straight back here.</p>
      <Button variant="ghost" className="mt-4" onClick={onCancel}>Cancel</Button>
    </motion.div>
  );
}
