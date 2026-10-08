import React, { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, AlertTriangle, Check, CheckCircle2, FileText, Loader2, Lock, Plus, Search, Upload } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { useAuth } from "../../../lib/AuthContext";
import { v2 } from "../../lib/api2";
import { fetchProjects } from "../../lib/workspace";
import { Badge, Button, Checkbox, Input, SourceMark } from "../../ui/primitives";
import { AnimatePresence, Stagger, StaggerItem, motion, t as T } from "../../ui/motion";
import { Logo } from "../../shell/Logo";
import { Seo } from "../../shell/Seo";
import { AddNoteDialog, UploadDialog } from "../../features/sources";
import { cn } from "../../../lib/utils";

/* Onboarding — Figma › 04 Flows › Onboarding 1–5 (Create workspace, Connect
   sources, Choose what Bracket reads, Learning (live), Workspace ready) and the
   Onboarding — Mobile 390 frames. Also used for "New workspace". */
const STEPS = ["Workspace", "Connect", "Choose", "Learn"];
const KINDS = ["A client project", "My own business", "A team or department", "Something else"];

export default function Onboarding() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const step = Number(params.get("step") || 1);
  const wid = params.get("w");
  const go = (n, extra = {}) => setParams({ step: String(n), ...(wid ? { w: wid } : {}), ...extra });
  const Step = { 1: CreateWorkspace, 2: ConnectSources, 3: ChooseReads, 4: Learning, 5: Ready }[step] || CreateWorkspace;
  return (
    <div className="bk flex min-h-[100dvh] flex-col bg-app">
      <Seo title="Set up your workspace" />
      <header className="flex h-14 shrink-0 items-center gap-4 border-b border-line-subtle px-4 md:px-6">
        <Logo />
        <span className="flex-1" />
        {step <= 4 && (
          <ol className="hidden items-center gap-2 md:flex" aria-label="Progress">
            {STEPS.map((l, i) => {
              const n = i + 1; const on = n === step; const done = n < step;
              return (
                <li key={l} className="flex items-center gap-2">
                  {i > 0 && <span className={cn("h-px w-10 transition-colors duration-base", done || on ? "bg-line-strong" : "bg-line-subtle")} aria-hidden="true" />}
                  <span className={cn("flex h-5 w-5 items-center justify-center rounded-full border text-[11px] transition-colors duration-base", on ? "border-fg bg-fg text-app" : done ? "border-fg text-fg" : "border-line-control text-fg-tertiary")}>{done ? <Check size={11} /> : n}</span>
                  <span className={cn("text-[12px]", on ? "text-fg" : "text-fg-tertiary")} aria-current={on ? "step" : undefined}>{l}</span>
                </li>
              );
            })}
          </ol>
        )}
        <span className="flex-1" />
        <button onClick={() => navigate(wid ? `/w/${wid}` : "/app")} className="text-[12px] font-medium text-fg hover:underline">Save & exit</button>
      </header>
      {step <= 4 && <p className="px-4 pt-4 text-[12px] text-fg-tertiary md:hidden">Step {step} of 4 · {STEPS[step - 1]}</p>}
      <main className="flex flex-1 justify-center px-4 pt-8 pb-16 md:pt-14">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div key={step} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={T.sheet} className="w-full">
            <Step wid={wid} go={go} setParams={setParams} />
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}

const Eyebrow = ({ children }) => <p className="eyebrow">{children}</p>;
const Title = ({ children }) => <h1 className="mt-3 text-title-l text-fg">{children}</h1>;
const Lead = ({ children }) => <p className="mt-3 text-body-m text-fg-secondary">{children}</p>;

/* 1 · Create workspace */
function CreateWorkspace({ go, setParams }) {
  const { user } = useAuth();
  const domainGuess = (user?.email || "").split("@")[1]?.split(".")[0];
  const [client, setClient] = useState("");
  const [work, setWork] = useState("");
  const [kind, setKind] = useState(KINDS[0]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  useEffect(() => { if (!client) setClient("Acme Finance"); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const next = async () => {
    setBusy(true); setErr(null);
    try {
      const w = await v2.createWorkspace({ client_name: client.trim(), name: work.trim() ? work.trim().replace(/^\w/, (c) => c.toUpperCase()) : client.trim(), kind });
      fetchProjects(true);
      setParams({ step: "2", w: w.id });
    } catch (e) {
      if (e?.response?.data?.code === "plan_limit") setErr("You’re using all 10 projects. Archive a finished workspace in Settings, or add this one for a one-off fee.");
      else setErr(e?.response?.data?.detail || "Couldn’t create the workspace");
    } finally { setBusy(false); }
  };
  return (
    <div className="mx-auto max-w-[480px]">
      <Eyebrow>Step 1 of 4</Eyebrow>
      <Title>What should Bracket remember?</Title>
      <Lead>A workspace is one business, client or project. Each has its own sources and memory.</Lead>
      <label className="mt-6 block"><span className="mb-2 block text-[12px] font-medium text-fg-secondary">Business or client</span><Input value={client} onChange={(e) => setClient(e.target.value)} autoFocus /></label>
      <p className="mt-2 text-[12px] text-fg-tertiary">{domainGuess ? "Suggested from your recent emails. You can change it." : "The company or person this work is for."}</p>
      <label className="mt-5 block"><span className="mb-2 block text-[12px] font-medium text-fg-secondary">What’s the work?</span><Input value={work} onChange={(e) => setWork(e.target.value)} placeholder="Fintech landing page redesign" /></label>
      <p className="mt-5 text-[12px] font-medium text-fg-secondary">This workspace is for…</p>
      <div className="mt-2 flex flex-wrap gap-2" role="radiogroup">
        {KINDS.map((k) => (
          <button key={k} role="radio" aria-checked={kind === k} onClick={() => setKind(k)} className={cn("h-9 rounded-md border px-3 text-[12px] transition-colors duration-fast", kind === k ? "border-fg bg-selected text-fg" : "border-line-control text-fg-secondary hover:text-fg")}>{k}</button>
        ))}
      </div>
      <p className="mt-3 text-[12px] text-fg-tertiary">Only used to tune what Bracket looks for first. Categories are discovered from your sources either way.</p>
      {err && <p className="mt-4 text-[12px] text-danger">{err}</p>}
      <div className="mt-6 flex justify-end"><Button variant="primary" icon={ArrowRight} loading={busy} disabled={!client.trim()} onClick={next}>Continue</Button></div>
    </div>
  );
}

/* OAuth popup helper — same postMessage protocol as the v1 connect flow. */
function useOAuth(wid, onResult) {
  return useCallback(async (provider) => {
    const { url } = await v2.connectUrl(wid, provider);
    const w = 520, h = 640;
    const popup = window.open(url, `bracket-oauth-${provider}`, `width=${w},height=${h},left=${window.screenX + (window.outerWidth - w) / 2},top=${window.screenY + 80}`);
    const done = (ok) => { window.removeEventListener("message", onMsg); clearInterval(poll); onResult(provider, ok); };
    const onMsg = (e) => { if (typeof e.data === "string" && e.data.startsWith(`bracket-oauth:${provider}:`)) done(e.data.endsWith(":ok")); };
    window.addEventListener("message", onMsg);
    const poll = setInterval(() => { if (!popup || popup.closed) done(false); }, 600);
  }, [wid, onResult]);
}

/* 2 · Connect sources */
function ConnectSources({ wid, go }) {
  const [state, setState] = useState(null);
  const [note, setNote] = useState(false);
  const [upload, setUpload] = useState(false);
  const load = useCallback(() => v2.onboarding(wid).then(setState), [wid]);
  useEffect(() => { load(); }, [load]);
  const onResult = useCallback(async (provider, ok) => { await v2.onboardingConnect(wid, provider, !ok); load(); }, [wid, load]);
  const connect = useOAuth(wid, onResult);
  const c = state?.connected || {};
  const cancelled = Object.entries(c).find(([, v]) => v === "cancelled");
  const any = Object.values(c).some((v) => v && v !== "cancelled");
  const rows = [
    { key: "gmail", title: "Gmail", sub: "Client email threads" },
    { key: "slack", title: "Slack", sub: "Project channels" },
    { key: "notes", title: "Notes & transcripts", sub: "Paste meeting notes or calls", icon: FileText, cta: "Add", on: () => setNote(true) },
    { key: "files", title: "Files", sub: "Briefs, contracts, PDFs", icon: Upload, cta: "Add", on: () => setUpload(true) },
    { key: "notion", title: "Notion", sub: "Coming soon", letter: "N", soon: true },
  ];
  return (
    <div className="mx-auto max-w-[560px]">
      <div className="mb-3 text-center"><button onClick={() => setNote(true)} className="text-[12px] font-medium text-fg hover:underline">Skip — start with a note</button></div>
      <Eyebrow>Step 2 of 4</Eyebrow>
      <Title>Connect where the work happens</Title>
      <Lead>Bracket learns from what already exists. Connect at least one source, or start with notes.</Lead>
      <AnimatePresence>
        {cancelled && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={T.base} className="overflow-hidden">
            <p className="mt-5 flex items-center gap-3 rounded-md border border-warning/70 bg-warning-bg px-3 py-2.5 text-[12px] text-fg" role="status"><AlertTriangle size={14} className="text-warning" />{cancelled[0] === "slack" ? "Slack" : "Gmail"} connection was cancelled. Nothing was shared — try again whenever you’re ready.</p>
          </motion.div>
        )}
      </AnimatePresence>
      <Stagger className="mt-5 overflow-hidden rounded-lg border border-line divide-y divide-line-subtle">
        {rows.map((r) => {
          const v = c[r.key];
          const ok = v && v !== "cancelled";
          return (
            <StaggerItem key={r.key} className="flex items-center gap-3 px-3 py-3">
              <span className="flex w-5 justify-center">{r.icon ? <r.icon size={16} className="text-fg-secondary" /> : r.letter ? <span className="flex h-5 w-5 items-center justify-center rounded bg-white/[0.08] text-[10px] font-semibold text-fg-secondary">{r.letter}</span> : <SourceMark provider={r.key} size={16} />}</span>
              <span className="min-w-0 flex-1"><span className={cn("block text-[12px] font-medium", r.soon ? "text-fg-tertiary" : "text-fg")}>{r.title}</span><span className="block text-[12px] text-fg-tertiary">{r.sub}</span></span>
              {r.soon ? <Badge>Soon</Badge> : ok ? (
                <motion.span initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} transition={T.base} className="flex items-center gap-2 text-[12px] text-fg-secondary"><span className="h-1.5 w-1.5 rounded-full bg-success" />{typeof v === "string" ? v : "Added"}</motion.span>
              ) : <Button size="s" onClick={r.on || (() => connect(r.key))}>{r.cta || (v === "cancelled" ? "Try again" : "Connect")}</Button>}
            </StaggerItem>
          );
        })}
      </Stagger>
      <p className="mt-3 flex items-center gap-2 text-[12px] text-fg-tertiary"><Lock size={14} /> Next, you’ll choose exactly which threads and channels Bracket can read.</p>
      <div className="mt-6 flex items-center justify-between">
        <Button variant="ghost" onClick={() => go(1)}>Back</Button>
        <Button variant="primary" icon={ArrowRight} disabled={!any} onClick={() => go(3)}>Continue</Button>
      </div>
      <AddNoteDialog open={note} onOpenChange={setNote} wid={wid} onAdded={async () => { await v2.onboardingConnect(wid, "notes"); load(); }} />
      <UploadDialog open={upload} onOpenChange={(o) => { setUpload(o); if (!o) v2.onboardingConnect(wid, "files").then(load); }} wid={wid} />
    </div>
  );
}

/* 3 · Choose what Bracket reads */
function ChooseReads({ wid, go }) {
  const [state, setState] = useState(null);
  const [sel, setSel] = useState(new Set());
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { v2.onboarding(wid).then((s) => { setState(s); setSel(new Set(s.threads.filter((t) => t.selected).map((t) => t.id))); }); }, [wid]);
  const threads = (state?.threads || []).filter((t) => !q || `${t.name} ${t.from}`.toLowerCase().includes(q.toLowerCase()));
  const client = state?.workspace?.client_name || "the client";
  const toggle = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const start = async () => { setBusy(true); await v2.onboardingStart(wid, [...sel], (state?.channels || []).map((c) => c.id)); go(4); };
  return (
    <div className="mx-auto max-w-[760px]">
      <Eyebrow>Step 3 of 4</Eyebrow>
      <Title>Choose what Bracket can read</Title>
      <Lead>Bracket suggested threads that mention {client}. Nothing else in your inbox is read.</Lead>
      <div className="mt-6 overflow-hidden rounded-lg border border-line">
        <div className="flex items-center gap-3 border-b border-line-subtle px-3 py-2.5">
          <SourceMark provider="gmail" size={16} /><span className="text-[12px] text-fg">Gmail</span>
          <label className="flex h-8 flex-1 items-center gap-2 rounded-md border border-line-control px-2.5 sm:max-w-[240px]"><Search size={14} className="text-fg-tertiary" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search threads" className="min-w-0 flex-1 bg-transparent text-[12px] text-fg placeholder:text-fg-tertiary outline-none" aria-label="Search threads" /></label>
          <span className="hidden flex-1 text-right text-[12px] text-fg-tertiary sm:block">Suggested</span>
        </div>
        <div className="divide-y divide-line-subtle">
          {threads.map((t) => (
            <label key={t.id} htmlFor={`ob-${t.id}`} className="flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors duration-fast hover:bg-hover">
              <Checkbox id={`ob-${t.id}`} checked={sel.has(t.id)} onChange={() => toggle(t.id)} />
              <span className="min-w-0 flex-1"><span className="block truncate text-[12px] text-fg">{t.name}</span><span className="block truncate font-mono text-[11px] text-fg-tertiary">{t.from}</span></span>
              {t.mentions && <Badge tone="info" className="hidden sm:inline-flex">Mentions {client.split(" ")[0]}</Badge>}
              <span className="hidden w-[60px] text-right font-mono text-[12px] text-fg-tertiary sm:block">{t.messages} msgs</span>
              <span className="w-[48px] text-right text-[12px] text-fg-tertiary">{relDay(t.at)}</span>
            </label>
          ))}
        </div>
        {(state?.channels || []).length > 0 && (
          <div className="flex items-center gap-3 border-t border-line-subtle px-3 py-3 text-[12px]">
            <SourceMark provider="slack" size={14} /><span className="flex-1 text-fg-secondary">Slack · {state.channels.map((c) => c.name).join(", ")} selected · {state.channels[0].messages.toLocaleString("en-US")} messages (last 90 days)</span>
            <Button size="s" variant="ghost" onClick={() => toast("Choose channels after setup in Sources")}>Change</Button>
          </div>
        )}
      </div>
      <div className="mt-6 flex items-center gap-3">
        <Button variant="ghost" onClick={() => go(2)}>Back</Button>
        <span className="flex-1" />
        <span className="text-[12px] text-fg-tertiary">{sel.size} thread{sel.size === 1 ? "" : "s"} · {(state?.channels || []).length} channel{(state?.channels || []).length === 1 ? "" : "s"}</span>
        <Button variant="primary" icon={ArrowRight} loading={busy} disabled={!sel.size && !(state?.channels || []).length} onClick={start}>Start learning</Button>
      </div>
    </div>
  );
}
function relDay(iso) { const d = new Date(iso); return d.toDateString() === new Date().toDateString() ? "Today" : format(d, "MMM d"); }

/* 4 · Learning (live) */
function Learning({ wid, go }) {
  const [p, setP] = useState(null);
  useEffect(() => {
    let alive = true;
    const tick = () => v2.onboardingProgress(wid).then((d) => { if (alive) setP(d); });
    tick();
    const id = setInterval(tick, 1200);
    return () => { alive = false; clearInterval(id); };
  }, [wid]);
  const bar = (pct, tone) => (
    <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10"><motion.div className={cn("h-full rounded-full", tone)} animate={{ width: `${Math.round((pct || 0) * 100)}%` }} transition={{ duration: 0.9, ease: [0.2, 0.8, 0.2, 1] }} /></div>
  );
  return (
    <div className="mx-auto max-w-[760px]">
      <Eyebrow>Step 4 of 4</Eyebrow>
      <Title>Bracket is reading your work</Title>
      <Lead>This takes a few minutes. You’ll see what it understands as it goes — no need to wait here.</Lead>
      <div className="mt-6 space-y-4 rounded-lg border border-line p-4" role="status" aria-live="polite">
        {p?.gmail && <div><div className="flex items-center gap-2 text-[12px]"><SourceMark provider="gmail" size={14} /><span className="flex-1 text-fg">{p.gmail.label}</span><span className="text-success">Done</span></div>{bar(1, "bg-success")}</div>}
        {p?.slack && <div><div className="flex items-center gap-2 text-[12px]"><SourceMark provider="slack" size={14} /><span className="flex-1 text-fg">{p.slack.label}</span><span className={p.slack.done ? "text-success" : "text-fg-tertiary"}>{p.slack.done ? "Done" : p.slack.eta}</span></div>{bar(p.slack.pct, p.slack.done ? "bg-success" : "bg-info")}</div>}
      </div>
      <div className="mt-4 overflow-hidden rounded-lg border border-line">
        <div className="flex items-center gap-2 border-b border-line-subtle px-4 py-3"><span className="text-[12px] text-fg">Found so far</span><span className="font-mono text-[12px] text-fg-tertiary">{p?.found_count ?? 0}</span><span className="flex-1" />{!p?.done ? <Loader2 size={14} className="animate-spin text-fg-tertiary" /> : <CheckCircle2 size={14} className="text-success" />}</div>
        <ul className="divide-y divide-line-subtle">
          <AnimatePresence initial={false}>
            {(p?.found || []).map((f) => (
              <motion.li key={f.text} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} transition={T.base} className="overflow-hidden">
                <div className="flex items-center gap-4 px-4 py-2.5">
                  <span className={cn("eyebrow w-[130px] shrink-0", f.attention && "text-warning")}>{f.category}</span>
                  <span className="flex-1 text-[12px] text-fg-secondary">{f.text}</span>
                  {f.provider === "notes" ? <FileText size={14} className="text-fg-tertiary" /> : <SourceMark provider={f.provider} size={14} />}
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      </div>
      <div className="mt-5 flex items-center">
        <span className="flex-1 text-[12px] text-fg-tertiary">We’ll notify you when it’s done</span>
        <Button variant="primary" icon={ArrowRight} onClick={() => go(5)}>Open workspace now</Button>
      </div>
    </div>
  );
}

/* 5 · Workspace ready */
function Ready({ wid }) {
  const [r, setR] = useState(null);
  const navigate = useNavigate();
  useEffect(() => { v2.onboardingFinish(wid).then((d) => { setR(d); fetchProjects(true); }); }, [wid]);
  if (!r) return <div className="flex justify-center pt-24"><Loader2 className="animate-spin text-fg-tertiary" /></div>;
  const cats = [["scope", "Scope"], ["decision", "Decisions"], ["deliverable", "Deliverables"], ["requirement", "Requirements"], ["commitment", "Commitments"], ["person", "People"]];
  return (
    <div className="mx-auto max-w-[760px]">
      <motion.span initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 380, damping: 22 }} className="inline-block"><CheckCircle2 size={22} className="text-success" /></motion.span>
      <p className="eyebrow mt-4">Ready</p>
      <Title>{r.workspace.name} is ready</Title>
      <Lead>Bracket read {r.read}. Here’s what it understands — you can correct anything.</Lead>
      <Stagger className="mt-6 grid grid-cols-3 overflow-hidden rounded-lg border border-line sm:grid-cols-6" step={0.05}>
        {cats.map(([k, l]) => (
          <StaggerItem key={k} className="border-line-subtle px-3 py-3 [&:not(:last-child)]:border-r">
            <p className="text-title-m text-fg">{r.counts[k]}</p><p className="text-[12px] text-fg-tertiary">{l}</p>
          </StaggerItem>
        ))}
      </Stagger>
      <p className="mt-3 text-[12px] text-fg-tertiary">These categories were discovered from your sources. They’ll evolve as the work changes.</p>
      {r.attention && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ ...T.base, delay: 0.3 }} className="mt-5 flex items-center gap-3 rounded-lg border border-warning px-4 py-3">
          <AlertTriangle size={16} className="text-warning" />
          <div className="min-w-0 flex-1"><p className="text-[12px] text-fg">1 thing already needs you</p><p className="text-[12px] text-fg-tertiary">{r.attention.title}</p></div>
          <Button size="s" onClick={() => navigate(`/w/${wid}/review/${r.attention.review_id}`)}>Review</Button>
        </motion.div>
      )}
      <div className="mt-6 flex items-center">
        <Button variant="ghost" icon={Plus} onClick={() => navigate(`/w/${wid}/settings/members?invite=1`)}>Invite a teammate</Button>
        <span className="flex-1" />
        <Button variant="primary" icon={ArrowRight} onClick={() => navigate(`/w/${wid}`)}>Open workspace</Button>
      </div>
    </div>
  );
}

/* /oauth-mock — mock API only: stands in for Google/Slack consent in the popup. */
export function OAuthMock() {
  const [params] = useSearchParams();
  const provider = params.get("provider") || "gmail";
  const name = provider === "gmail" ? "Google" : provider === "slack" ? "Slack" : provider;
  const finish = (ok) => { window.opener?.postMessage(`bracket-oauth:${provider}:${ok ? "ok" : "error"}`, "*"); window.close(); };
  return (
    <div className="bk flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-app px-6 text-center">
      <SourceMark provider={provider} size={28} />
      <p className="text-title-m text-fg">{name} — allow Bracket?</p>
      <p className="max-w-[320px] text-[12px] text-fg-tertiary">Mock consent screen. Bracket will only read what you choose next.</p>
      <div className="flex gap-2"><Button variant="ghost" onClick={() => finish(false)}>Cancel</Button><Button variant="primary" onClick={() => finish(true)}>Allow</Button></div>
      <Link to="/" className="sr-only">Home</Link>
    </div>
  );
}
