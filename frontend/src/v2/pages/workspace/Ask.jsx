import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Plus, MessageCircleQuestion, ArrowRight, ChevronDown, X } from "lucide-react";
import { useWorkspace } from "../../lib/workspace";
import { v2 } from "../../lib/api2";
import { useResource, shortTime } from "../../lib/data";
import { useIsMobile } from "../../lib/useMedia";
import { Button, Confidence, IconButton } from "../../ui/primitives";
import { AskComposer, AskTurn, ASK_SUGGESTIONS, CitationView, CiteNum, useAsk } from "../../features/ask";
import { AnimatePresence, Stagger, StaggerItem, motion, t as T } from "../../ui/motion";
import { cn } from "../../../lib/utils";

/* Ask Bracket page — Figma › ✓ Ask Bracket — Desktop 1440, Ask Bracket · Start,
   Ask Bracket · Answer copied; Ask Bracket — Mobile 390, Ask · History. */
export default function Ask() {
  const { projectId, project } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const mobile = useIsMobile();
  const navigate = useNavigate();
  const base = `/w/${projectId}`;
  const qid = params.get("q");
  const prefill = params.get("ask");
  const { thread, ask, retry, load, reset } = useAsk(projectId);
  const history = useResource(() => v2.askHistory(projectId), [projectId]);
  const [cite, setCite] = useState(null);
  const end = useRef(null);
  const askedPrefill = useRef(null); // StrictMode runs effects twice — ask a prefilled question once

  useEffect(() => {
    const on = () => history.reload();
    window.addEventListener("bk:ask-history", on);
    return () => window.removeEventListener("bk:ask-history", on);
  }, [history]);
  // open a past question
  useEffect(() => {
    if (qid && !thread.some((x) => x.a?.id === qid)) v2.askItem(projectId, qid).then((a) => { load(a); setCite(a.sources?.[0] ? 1 : null); }).catch(() => {});
  }, [qid, projectId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (prefill && askedPrefill.current !== prefill) { askedPrefill.current = prefill; submit(prefill); const n = new URLSearchParams(params); n.delete("ask"); setParams(n, { replace: true }); }
  }, [prefill]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (thread.length > 1 || thread[0]?.status === "loading") end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [thread.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (q) => {
    const a = await ask(q);
    if (a?.id) { setParams({ q: a.id }, { replace: true }); if (!mobile && a.sources?.length) setCite(1); }
  };
  const newQuestion = () => { reset(); setCite(null); setParams({}); };
  const last = thread[thread.length - 1];
  const sources = last?.a?.sources || [];
  const activeSource = sources.find((s) => s.n === cite);
  const scope = project?.name || "This workspace";

  /* ───── start ───── */
  if (!thread.length && !qid) {
    if (mobile) {
      return (
        <div className="scroll-pane h-full px-4 pt-4 pb-6">
          <div className="flex items-center"><h1 className="flex-1 text-title-m text-fg">Ask Bracket</h1><IconButton icon={Plus} label="New question" size="l" onClick={newQuestion} /></div>
          <AskComposer className="mt-3" onSubmit={submit} scopeLabel={scope} placeholder="Ask about this workspace…" />
          <p className="eyebrow mt-6 mb-1">Recent</p>
          <Stagger as="ul">
            {(history.data?.items || []).map((h) => (
              <StaggerItem as="li" key={h.id}>
                <button onClick={() => setParams({ q: h.id })} className="flex min-h-[52px] w-full items-center gap-3 border-b border-line-subtle text-left">
                  <MessageCircleQuestion size={16} className="shrink-0 text-fg-tertiary" />
                  <span className="flex-1 text-[12px] text-fg">{h.question}</span>
                  <span className="text-[12px] text-fg-tertiary">{relDay(h.at)}</span>
                </button>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      );
    }
    return (
      <div className="flex h-full">
        <HistoryColumn items={history.data?.items} active={qid} onPick={(id) => setParams({ q: id })} onNew={newQuestion} />
        <div className="scroll-pane flex-1">
          <div className="mx-auto max-w-[520px] px-6 pt-24 pb-12">
            <motion.h1 initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={T.base} className="text-title-m text-fg">Ask about {scope}</motion.h1>
            <p className="mt-3 text-body-s text-fg-secondary">Answers come only from this workspace’s memory and connected sources — with citations.</p>
            <AskComposer className="mt-5" autoFocus onSubmit={submit} scopeLabel={scope} placeholder="Ask about this workspace…" />
            <p className="eyebrow mt-6 mb-3">Try asking</p>
            <Stagger className="space-y-2" step={0.04} delay={0.08}>
              {ASK_SUGGESTIONS.map((s) => (
                <StaggerItem key={s}>
                  <button onClick={() => submit(s)} className="group flex h-11 w-full items-center gap-3 rounded-md border border-line px-3 text-left text-[12px] text-fg-secondary transition-colors duration-fast hover:bg-hover hover:text-fg">
                    <MessageCircleQuestion size={16} className="text-fg-tertiary" /><span className="flex-1">{s}</span>
                    <ArrowRight size={16} className="text-fg-tertiary transition-transform duration-fast group-hover:translate-x-0.5" />
                  </button>
                </StaggerItem>
              ))}
            </Stagger>
          </div>
        </div>
      </div>
    );
  }

  /* ───── conversation ───── */
  const threadView = (
    <div className={cn("space-y-10", mobile ? "px-4 pt-4" : "mx-auto max-w-[520px] px-6 pt-5")}>
      {thread.map((item) => (
        mobile ? <MobileTurn key={item.key} item={item} onNext={submit} base={base} wid={projectId} onRetry={retry} /> : (
          <AskTurn key={item.key} item={item} wid={projectId} base={base} onRetry={retry} onNext={submit}
            activeCite={item === last ? cite : null} onCite={(n) => { if (item !== last) return; setCite(cite === n ? null : n); }} />
        )
      ))}
      <div ref={end} />
    </div>
  );
  const composer = (
    <div className={cn("shrink-0 pb-4", mobile ? "border-t border-line-subtle px-4 pt-3" : "mx-auto w-full max-w-[520px] px-6")}>
      <AskComposer onSubmit={submit} disabled={last?.status === "loading"} scopeLabel={scope} />
      {!mobile && <p className="mt-3 text-[12px] text-fg-tertiary">Answers only use this workspace’s memory and connected sources.</p>}
    </div>
  );
  if (mobile) {
    return (
      <div className="flex h-full flex-col">
        <div className="scroll-pane min-h-0 flex-1 pb-6">{threadView}</div>
        {composer}
      </div>
    );
  }
  return (
    <div className="flex h-full">
      <HistoryColumn items={history.data?.items} active={qid} onPick={(id) => { reset(); setParams({ q: id }); }} onNew={newQuestion} />
      <div className="flex min-w-0 flex-1 flex-col border-l border-line-subtle">
        <div className="scroll-pane min-h-0 flex-1 pb-8">{threadView}</div>
        {composer}
      </div>
      <AnimatePresence initial={false}>
        {activeSource && (
          <motion.aside key="cite" initial={{ width: 0, opacity: 0 }} animate={{ width: 360, opacity: 1 }} exit={{ width: 0, opacity: 0 }} transition={T.base}
            className="h-full shrink-0 overflow-hidden border-l border-line-subtle" aria-label="Source">
            <div className="scroll-pane h-full w-[360px] px-5 py-5">
              <CitationView s={activeSource} onClose={() => setCite(null)} onOpen={() => navigate(activeSource.provider === "notes" ? `${base}/conversations/n2` : activeSource.provider === "file" ? `${base}/files/f6` : `${base}/conversations/t1`)} />
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  );
}

function relDay(iso) {
  const d = new Date(iso);
  if (d.toDateString() === new Date().toDateString()) return "Today";
  if (d.toDateString() === new Date(Date.now() - 864e5).toDateString()) return "Yesterday";
  return shortTime(iso);
}

function HistoryColumn({ items, active, onPick, onNew }) {
  return (
    <nav aria-label="Questions" className="scroll-pane hidden h-full w-[244px] shrink-0 px-3 py-4 lg:block">
      <Button className="w-full" icon={Plus} onClick={onNew}>New question</Button>
      <p className="eyebrow px-2 pt-5 pb-2">This week</p>
      <div className="space-y-0.5">
        {(items || []).map((h) => (
          <button key={h.id} onClick={() => onPick(h.id)} className={cn("relative block w-full rounded-md px-2 py-2 text-left text-[12px] leading-[18px] transition-colors duration-fast", active === h.id ? "text-fg" : "text-fg-secondary hover:bg-hover hover:text-fg")}>
            {active === h.id && <motion.span layoutId="ask-hist" className="absolute inset-0 rounded-md bg-selected" transition={T.base} />}
            <span className="relative">{h.question}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}

/* Mobile answer — sources collapse into a numbered row. */
function MobileTurn({ item, onNext, base, wid, onRetry }) {
  const [open, setOpen] = useState(false);
  const a = item.a;
  if (item.status !== "done" || !a || a.status !== "answered") return <AskTurn item={item} compact onCite={() => {}} onNext={onNext} base={base} wid={wid} onRetry={onRetry} />;
  return (
    <div className="space-y-4">
      <div className="rounded-md bg-surface px-3 py-2.5 text-body-m text-fg">{item.q}</div>
      <p className="text-body-m font-semibold text-fg">{a.lead}</p>
      <p className="text-body-m leading-6 text-fg-secondary">{(a.paragraphs || []).map((p) => `${p.text}${p.tail ? ` ${p.tail}` : ""}`).join(" ")}</p>
      {a.rows && a.rows.map((r) => <p key={r.label} className="text-[12px] text-fg-secondary"><span className="text-fg-tertiary">{r.label}</span> · {r.text}</p>)}
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2">
        {a.sources.map((s) => <CiteNum key={s.n} n={s.n} />)}
        <span className="text-[12px] text-fg-tertiary">{a.sources.length} sources</span><span className="flex-1" />
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={T.fast}><ChevronDown size={16} className="text-fg-tertiary" /></motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.ul initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={T.base} className="overflow-hidden space-y-2">
            {a.sources.map((s) => <li key={s.n} className="flex items-center gap-2 text-[12px] text-fg-secondary"><CiteNum n={s.n} /> {s.label} <span className="text-fg-tertiary">{s.meta}</span></li>)}
          </motion.ul>
        )}
      </AnimatePresence>
      {a.uncertain && (
        <div className="rounded-lg border border-line bg-surface px-3 py-3">
          <p className="text-[12px] font-medium text-fg">What Bracket isn’t sure about</p>
          <p className="mt-1 text-[12px] text-fg-tertiary">{a.uncertain}</p>
          {a.confidence && <div className="mt-3"><Confidence level={a.confidence} /></div>}
        </div>
      )}
      {a.next?.length > 0 && (
        <div>
          <p className="eyebrow mb-2">Ask next</p>
          <div className="space-y-2">{a.next.map((n) => (
            <button key={n} onClick={() => onNext(n)} className="flex min-h-[44px] w-full items-center gap-3 rounded-md border border-line px-3 text-left text-[12px] text-fg-secondary"><span className="flex-1">{n}</span><ArrowRight size={16} /></button>
          ))}</div>
        </div>
      )}
    </div>
  );
}
