import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { RotateCcw } from "lucide-react";
import { SidePanel } from "../ui/overlays";
import { Button } from "../ui/primitives";
import { AskComposer, AskThread, useAsk, ASK_SUGGESTIONS } from "../features/ask";

/* ⌘J — Ask Bracket side panel, available everywhere in the app.
   Scoped to the current workspace, or across all workspaces outside one. */
const Ctx = createContext({ open: () => {} });
export const useAskPanel = () => useContext(Ctx);

export function AskPanelProvider({ children }) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const pid = (location.pathname.match(/^\/w\/([^/]+)/) || [])[1] || null;
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") { e.preventDefault(); setOpen((o) => !o); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const value = useMemo(() => ({ open: () => setOpen(true) }), []);
  return (
    <Ctx.Provider value={value}>
      {children}
      <PanelBody key={pid || "all"} open={open} onOpenChange={setOpen} projectId={pid} />
    </Ctx.Provider>
  );
}

function PanelBody({ open, onOpenChange, projectId }) {
  const { thread, ask, reset } = useAsk(projectId);
  const end = useRef(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [thread]);
  const busy = thread.some((t) => t.loading);
  return (
    <SidePanel
      open={open}
      onOpenChange={onOpenChange}
      title="Ask Bracket"
      width={480}
      footer={
        <div className="w-full">
          <AskComposer onSubmit={ask} disabled={busy} autoFocus scopeLabel={projectId ? "This workspace" : "All workspaces"} placeholder="Ask anything about this work…" />
          <p className="mt-2 text-body-s text-fg-tertiary">Answers only use your memory and connected sources.</p>
        </div>
      }
    >
      {thread.length === 0 ? (
        <div>
          <p className="text-title-m">What would you like to know?</p>
          <p className="mt-1 text-body-s text-fg-tertiary">Every answer cites the conversation it came from.</p>
          <div className="mt-5 flex flex-col gap-2">
            {ASK_SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => ask(s)} className="rounded-md border border-line px-3 py-2 text-left text-body-m text-fg-secondary hover:border-line-strong hover:text-fg">
                {s}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="mb-4 flex justify-end"><Button size="s" variant="ghost" icon={RotateCcw} onClick={reset}>New question</Button></div>
          <AskThread thread={thread} compact />
          <div ref={end} />
        </>
      )}
    </SidePanel>
  );
}
