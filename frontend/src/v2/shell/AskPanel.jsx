import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { X, ExternalLink, MessageCircleQuestion } from "lucide-react";
import { IconButton } from "../ui/primitives";
import { Sheet } from "../ui/overlays";
import { AnimatePresence, motion, t as T } from "../ui/motion";
import { useIsMobile } from "../lib/useMedia";
import { AskComposer, AskTurn, ASK_SUGGESTIONS, useAsk } from "../features/ask";

/* ⌘J — Ask Bracket panel (Figma › Overview · Ask panel (⌘J)). Scoped to the
   current workspace; `open(question)` asks immediately. On mobile it's a sheet. */
const Ctx = createContext({ open: () => {} });
export const useAskPanel = () => useContext(Ctx);

export function AskPanelProvider({ children }) {
  const [state, setState] = useState({ open: false, q: null, n: 0 });
  const location = useLocation();
  const pid = (location.pathname.match(/^\/w\/([^/]+)/) || [])[1] || null;
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") { e.preventDefault(); setState((s) => ({ ...s, open: !s.open, q: null })); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const open = useCallback((q) => setState((s) => ({ open: true, q: typeof q === "string" ? q : null, n: s.n + 1 })), []);
  const value = useMemo(() => ({ open }), [open]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {pid && <Panel key={pid} pid={pid} state={state} onClose={() => setState((s) => ({ ...s, open: false }))} />}
    </Ctx.Provider>
  );
}

function Panel({ pid, state, onClose }) {
  const { thread, ask, retry, reset } = useAsk(pid);
  const mobile = useIsMobile();
  const navigate = useNavigate();
  const end = useRef(null);
  const asked = useRef(0);
  const base = `/w/${pid}`;
  useEffect(() => {
    if (state.open && state.q && asked.current !== state.n) { asked.current = state.n; reset(); ask(state.q); }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [thread]);
  useEffect(() => {
    if (!state.open) return undefined;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.open, onClose]);
  const busy = thread.some((x) => x.status === "loading");
  const last = thread[thread.length - 1];

  const body = (
    <>
      {thread.length === 0 ? (
        <div>
          <p className="text-body-m font-medium text-fg">What would you like to know?</p>
          <p className="mt-1 text-[12px] text-fg-tertiary">Every answer cites the conversation it came from.</p>
          <div className="mt-4 space-y-2">
            {ASK_SUGGESTIONS.slice(0, 4).map((s) => (
              <button key={s} onClick={() => ask(s)} className="flex h-10 w-full items-center gap-3 rounded-md border border-line px-3 text-left text-[12px] text-fg-secondary transition-colors duration-fast hover:bg-hover hover:text-fg">
                <MessageCircleQuestion size={14} className="text-fg-tertiary" /> {s}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-8">
          {thread.map((item) => <AskTurn key={item.key} item={item} compact wid={pid} base={base} onRetry={retry} onNext={ask} onCite={() => { onClose(); navigate(`${base}/ask?q=${item.a?.id}`); }} />)}
          <div ref={end} />
        </div>
      )}
    </>
  );
  const composer = <AskComposer onSubmit={ask} disabled={busy} autoFocus={!mobile} scopeLabel="This workspace" />;

  if (mobile) {
    return (
      <Sheet open={state.open} onOpenChange={(o) => !o && onClose()} title="Ask Bracket" footer={<div className="w-full pb-2">{composer}</div>}>
        {body}
      </Sheet>
    );
  }
  return (
    <AnimatePresence>
      {state.open && (
        <motion.aside
          key="ask-panel"
          initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={T.base}
          className="bk fixed right-0 top-0 bottom-0 z-40 flex w-[min(440px,100vw)] flex-col border-l border-line bg-sidebar shadow-overlay"
          role="dialog" aria-label="Ask Bracket"
        >
          <div className="flex h-14 shrink-0 items-center gap-1 border-b border-line-subtle pl-4 pr-3">
            <p className="eyebrow flex-1">Ask Bracket · This workspace</p>
            <IconButton icon={ExternalLink} label="Open as page" onClick={() => { onClose(); navigate(last?.a?.id ? `${base}/ask?q=${last.a.id}` : `${base}/ask`); }} />
            <IconButton icon={X} label="Close (Esc)" onClick={onClose} />
          </div>
          <div className="scroll-pane min-h-0 flex-1 px-4 py-4">{body}</div>
          <div className="shrink-0 px-3 pb-3">{composer}</div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
