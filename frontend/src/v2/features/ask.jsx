import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUp, Layers, Info, Loader2, AlertTriangle, GitFork, FileText, RefreshCw, Copy, Check, Flag, ChevronRight, Plug } from "lucide-react";
import { toast } from "sonner";
import { v2 } from "../lib/api2";
import { Avatar, Button, Confidence, SourceMark } from "../ui/primitives";
import { Dialog } from "../ui/overlays";
import { AnimatePresence, Stagger, StaggerItem, motion, t as T, Swap } from "../ui/motion";
import { useAuth } from "../../lib/AuthContext";
import { cn } from "../../lib/utils";

/* Ask Bracket — shared by the Ask page and the ⌘J panel.
   Figma › ✓ Ask Bracket, Ask Bracket · Start, Overview · Ask panel (⌘J),
   Ask Bracket — states (streaming, no answer, conflicting, partial, error). */

export const ASK_SUGGESTIONS = [
  "What is currently included in scope?",
  "What did Sarah say about tablet designs?",
  "Did we ever agree to a two-week deadline?",
  "What commitments are due this week?",
  "What changed this week?",
];

/* thread: [{ q, a?, status: "loading"|"done"|"error", id }] */
export function useAsk(wid) {
  const [thread, setThread] = useState([]);
  const ask = async (question) => {
    const q = question.trim();
    if (q.length < 3 || !wid) return null;
    const key = Date.now();
    setThread((t) => [...t, { key, q, status: "loading" }]);
    try {
      const a = await v2.ask(wid, q);
      setThread((t) => t.map((x) => (x.key === key ? { ...x, a, status: "done" } : x)));
      window.dispatchEvent(new Event("bk:ask-history"));
      return a;
    } catch (e) {
      setThread((t) => t.map((x) => (x.key === key ? { ...x, status: "error" } : x)));
      return null;
    }
  };
  const retry = (key) => {
    const item = thread.find((x) => x.key === key);
    setThread((t) => t.filter((x) => x.key !== key));
    if (item) ask(item.q);
  };
  const load = (a) => setThread([{ key: a.id, q: a.question, a, status: "done" }]);
  return { thread, ask, retry, load, reset: () => setThread([]) };
}

export function AskComposer({ onSubmit, disabled, scopeLabel, autoFocus, placeholder = "Ask a follow-up…", className }) {
  const [v, setV] = useState("");
  const ref = useRef(null);
  const submit = () => {
    if (!v.trim() || disabled) return;
    onSubmit(v);
    setV("");
  };
  useEffect(() => {
    const el = ref.current;
    if (el) { el.style.height = "auto"; el.style.height = `${Math.min(160, el.scrollHeight)}px`; }
  }, [v]);
  return (
    <div className={cn("rounded-xl border border-line-control bg-surface px-3 pt-3 pb-3 transition-colors duration-fast focus-within:border-fg/70", className)}>
      <textarea
        ref={ref}
        autoFocus={autoFocus}
        rows={1}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
        placeholder={placeholder}
        aria-label="Ask Bracket"
        className="block w-full resize-none bg-transparent px-1 text-body-m text-fg placeholder:text-fg-tertiary outline-none"
      />
      <div className="mt-3 flex items-center gap-2">
        {scopeLabel && (
          <span className="inline-flex h-[22px] items-center gap-2 rounded-[4px] border border-line-subtle bg-raised px-2 text-[12px] font-medium text-fg-secondary">
            <Layers size={12} /> {scopeLabel}
          </span>
        )}
        <span className="flex-1" />
        <motion.button whileTap={{ scale: 0.92 }} onClick={submit} disabled={!v.trim() || disabled} aria-label="Send question"
          className="flex h-7 w-7 items-center justify-center rounded-md bg-inverse text-fg-inverse transition-opacity duration-fast disabled:opacity-30">
          <ArrowUp size={16} />
        </motion.button>
      </div>
    </div>
  );
}

/* One Q&A turn. `onCite(n)` opens a citation; `compact` = panel. */
export function AskTurn({ item, onCite, activeCite, compact, onRetry, onNext, base, wid }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const [report, setReport] = useState(false);
  const a = item.a;
  const copy = () => {
    const text = [a.lead, ...(a.paragraphs || []).map((p) => `${p.text} ${p.cites.map((c) => `[${c}]`).join("")} ${p.tail || ""}`), ...(a.rows || []).map((r) => `${r.label}: ${r.text}`), "", "Sources:", ...(a.sources || []).map((s) => `[${s.n}] ${s.label} — ${s.meta}`)].join("\n");
    navigator.clipboard?.writeText(text);
    setCopied(true);
    toast("Answer copied with sources");
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <div className="space-y-4">
      {compact ? (
        <div className="rounded-md bg-surface px-3 py-2.5 text-body-m text-fg">{item.q}</div>
      ) : (
        <div className="flex items-center gap-3"><Avatar name={user?.name || "You"} /><p className="text-title-m text-fg">{item.q}</p></div>
      )}
      {item.status === "loading" && <Streaming />}
      {item.status === "error" && (
        <StateBox tone="danger" icon={AlertTriangle} title="Bracket couldn’t answer right now" body="Your question is saved. Try again in a moment."
          action={<Button size="s" icon={RefreshCw} onClick={() => onRetry(item.key)}>Try again</Button>} />
      )}
      {a && item.status === "done" && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={T.base} className="space-y-4">
          {a.status === "no_answer" ? (
            <StateBox tone="neutral" icon={Info} title={a.title} body={a.answer}
              action={<><Button size="s" icon={FileText} onClick={() => navigate(`${base}/sources?note=1`)}>Add a note</Button><Button size="s" variant="ghost" icon={Plug} onClick={() => navigate(`${base}/sources?add=1`)}>Connect a source</Button></>} />
          ) : a.status === "conflict" ? (
            <StateBox tone="warning" icon={GitFork} title={a.title} body={<Cited text={a.answer} onCite={onCite} />}
              action={<><Button size="s" onClick={() => navigate(`${base}/resolve/cf1`)}>Resolve in review</Button><Button size="s" variant="ghost" onClick={() => navigate(`${base}/conversations/t1?draft=ask`)}>Ask Sarah</Button></>} />
          ) : (
            <>
              {!compact && <p className="flex items-center gap-2 text-[12px] text-fg-tertiary"><MessageMark /> <span className="font-medium text-fg-secondary">Bracket</span> · answered from {a.basis.memories} memories and {a.basis.sources} sources</p>}
              {a.partial && (
                <StateBox tone="info" icon={Loader2} spin title="Answer may be incomplete" body={`${a.partial.source} is ${a.partial.pct}% synced. Bracket answered from what’s ready and will update this answer if anything changes.`} />
              )}
              <Stagger className="space-y-3" step={0.06}>
                <StaggerItem><p className="text-body-m font-semibold text-fg">{a.lead}</p></StaggerItem>
                {(a.paragraphs || []).map((p, i) => (
                  <StaggerItem key={i}>
                    <p className="text-body-m leading-6 text-fg-secondary">
                      {p.text}{" "}{p.cites.map((c) => <CiteChip key={c} n={c} active={activeCite === c} onClick={() => onCite(c)} />)}{p.tail ? ` ${p.tail}` : ""}
                    </p>
                  </StaggerItem>
                ))}
                {a.rows && (
                  <StaggerItem>
                    <div className="space-y-2.5">
                      {a.rows.map((r) => (
                        <div key={r.label} className="flex items-center gap-3 text-[12px]">
                          <span className="w-[80px] shrink-0 text-fg-tertiary">{r.label}</span>
                          <span className="flex-1 text-fg-secondary">{r.text}</span>
                          <CiteChip n={r.cite} active={activeCite === r.cite} onClick={() => onCite(r.cite)} />
                        </div>
                      ))}
                    </div>
                  </StaggerItem>
                )}
              </Stagger>
              {a.uncertain && (
                <div className="rounded-lg border border-line bg-surface px-4 py-3">
                  {compact ? <p className="text-[12px] font-medium text-fg">Not sure</p> : <p className="flex items-center gap-2 text-[12px] font-medium text-fg"><Info size={16} className="text-fg-tertiary" /> What Bracket isn’t sure about</p>}
                  <p className={cn("mt-1 text-[12px] text-fg-tertiary", !compact && "pl-6")}>{a.uncertain}</p>
                  {!compact && <div className="mt-2 pl-6"><Confidence level={a.confidence} /></div>}
                </div>
              )}
              {a.actions && compact && (
                <div className="flex gap-2">{a.actions.map((x) => <Button key={x.label} size="s" variant={x.kind === "review" ? "secondary" : "ghost"} onClick={() => navigate(x.kind === "review" ? `${base}/review/${x.target}` : `${base}/conversations/${x.target}?draft=1`)}>{x.label}</Button>)}</div>
              )}
              {!compact && a.sources?.length > 0 && (
                <div>
                  <p className="eyebrow mb-3">Sources · {a.sources.length}</p>
                  <div className="space-y-2">
                    {a.sources.map((s) => (
                      <button key={s.n} onClick={() => onCite(s.n)} className={cn("flex w-full items-center gap-3 rounded-md border px-3 py-2.5 text-left transition-colors duration-fast", activeCite === s.n ? "border-line-strong bg-surface" : "border-line hover:bg-hover")}>
                        <CiteNum n={s.n} active={activeCite === s.n} />
                        {s.provider === "notes" || s.provider === "file" ? <FileText size={14} className="text-fg-secondary" /> : <SourceMark provider={s.provider} size={14} />}
                        <span className="min-w-0 flex-1 truncate text-[12px] text-fg">{s.label} <span className="text-fg-tertiary">{s.meta}</span></span>
                        <ChevronRight size={16} className="text-fg-tertiary" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {!compact && (
                <div className="flex gap-1">
                  <Button size="s" variant="ghost" icon={copied ? Check : Copy} onClick={copy}><Swap k={copied ? "y" : "n"}>{copied ? "Copied" : "Copy"}</Swap></Button>
                  <Button size="s" variant="ghost" icon={Flag} onClick={() => setReport(true)}>Something’s wrong</Button>
                </div>
              )}
              {!compact && a.next?.length > 0 && (
                <div>
                  <p className="eyebrow mb-3">Ask next</p>
                  <div className="flex flex-wrap gap-2">{a.next.map((n) => <Button key={n} size="m" onClick={() => onNext(n)}>{n}</Button>)}</div>
                </div>
              )}
            </>
          )}
        </motion.div>
      )}
      <ReportDialog open={report} onOpenChange={setReport} onSend={async (why) => { await v2.askFeedback(wid, a.id, { why }); setReport(false); toast("Thanks — Bracket will use this to improve answers"); }} />
    </div>
  );
}

function ReportDialog({ open, onOpenChange, onSend }) {
  const [why, setWhy] = useState(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="What’s wrong with this answer?" size="s"
      footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" disabled={!why} onClick={() => onSend(why)}>Send</Button></>}>
      <div className="flex flex-wrap gap-2">
        {["Wrong facts", "Wrong source", "Missing something", "Outdated"].map((x) => (
          <button key={x} onClick={() => setWhy(x)} className={cn("h-8 rounded-md border px-3 text-[12px] font-medium", why === x ? "border-fg bg-selected text-fg" : "border-line-control text-fg-secondary")}>{x}</button>
        ))}
      </div>
    </Dialog>
  );
}

function MessageMark() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="text-fg-secondary" aria-hidden="true"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><path d="M12 17h.01" /></svg>;
}
export function CiteNum({ n, active }) {
  return <span className={cn("inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[3px] px-1 font-mono text-[11px] leading-none", active ? "bg-fg text-app" : "bg-white/[0.08] text-fg-secondary")}>{n}</span>;
}
function CiteChip({ n, onClick, active }) {
  return (
    <button onClick={onClick} aria-label={`Source ${n}`} className="mx-0.5 inline-flex translate-y-[-1px] align-middle transition-transform duration-fast hover:scale-110">
      <CiteNum n={n} active={active} />
    </button>
  );
}
function Cited({ text, onCite }) {
  return text.split(/(\[\d\])/).map((part, i) => /^\[\d\]$/.test(part) ? <CiteChip key={i} n={Number(part[1])} onClick={() => onCite(Number(part[1]))} /> : <React.Fragment key={i}>{part}</React.Fragment>);
}

function Streaming() {
  const steps = ["Searching 3 sources…", "Searching 3 sources · found 2 relevant messages…", "Writing the answer…"];
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((x) => Math.min(x + 1, steps.length - 1)), 260);
    return () => clearInterval(id);
  }, [steps.length]);
  return (
    <div className="space-y-3" role="status" aria-live="polite">
      <p className="flex items-center gap-2 text-[12px] text-fg-tertiary"><Loader2 size={14} className="animate-spin" /><Swap k={i}>{steps[i]}</Swap></p>
      <div className="space-y-2">{[0.9, 0.75, 0.55].map((w, k) => <div key={k} className="skeleton h-3 rounded" style={{ width: `${w * 100}%` }} />)}</div>
    </div>
  );
}

export function StateBox({ tone, icon: Icon, title, body, action, spin }) {
  const c = { danger: "border-danger/70 text-danger", warning: "border-warning/70 text-warning", info: "border-info/70 text-info", neutral: "border-line text-fg-tertiary" }[tone];
  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={T.base} className={cn("rounded-lg border px-4 py-3", c)} role={tone === "danger" ? "alert" : "status"}>
      <div className="flex gap-3">
        <Icon size={16} className={cn("mt-0.5 shrink-0", spin && "animate-spin")} />
        <div className="min-w-0 flex-1">
          <p className="text-body-m text-fg">{title}</p>
          {body && <div className="mt-1 text-[12px] leading-[18px] text-fg-secondary">{body}</div>}
          {action && <div className="mt-3 flex flex-wrap gap-2">{action}</div>}
        </div>
      </div>
    </motion.div>
  );
}

/* Citation viewer — right panel on the Ask page. */
export function CitationView({ s, onClose, onOpen }) {
  if (!s) return null;
  const lines = (s.excerpt || "").split("\n");
  return (
    <motion.div key={s.n} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={T.base} className="space-y-4">
      <div className="flex items-center gap-2">
        <CiteNum n={s.n} active />
        {s.provider === "notes" || s.provider === "file" ? <FileText size={14} className="text-fg-secondary" /> : <SourceMark provider={s.provider} size={14} />}
        <p className="flex-1 truncate text-[12px] font-medium text-fg">{s.label}</p>
        {onClose && <button onClick={onClose} aria-label="Close source" className="text-fg-tertiary hover:text-fg">✕</button>}
      </div>
      <p className="text-[12px] text-fg-tertiary">{s.attendees || s.meta}</p>
      <div className="rounded-lg border border-line bg-surface p-4 text-[12px] leading-[18px] text-fg-secondary">
        {lines.map((l, i) => (s.highlight && l.includes(s.highlight.slice(0, 16)) ? (
          <p key={i} className="my-1.5 border-l-2 border-fg bg-raised py-2 pl-2 text-fg">{l}</p>
        ) : <p key={i} className={l ? "" : "h-3"}>{l}</p>))}
      </div>
      <Button size="s" icon={FileText} onClick={onOpen}>Open {s.provider === "notes" ? "note" : s.provider === "file" ? "file" : "source"}</Button>
      {s.memory?.length > 0 && (
        <div>
          <p className="eyebrow mb-3">Memory this came from</p>
          {s.memory.map((m, i) => <div key={i} className="border-l border-line pl-3"><p className="text-[12px] text-fg-tertiary">{m.category}</p><p className="text-[12px] text-fg">{m.text}</p></div>)}
        </div>
      )}
    </motion.div>
  );
}

export { AnimatePresence };
