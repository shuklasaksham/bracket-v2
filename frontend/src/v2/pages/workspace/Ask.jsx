import React, { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus, MessageCircleQuestion } from "lucide-react";
import { useWorkspace } from "../../lib/workspace";
import { Button } from "../../ui/primitives";
import { AskComposer, AskThread, useAsk, ASK_SUGGESTIONS } from "../../features/ask";

/* Ask Bracket — full page. Answers only from memory + connected sources. */
export default function Ask() {
  const { projectId, project } = useWorkspace();
  const { thread, ask, reset } = useAsk(projectId);
  const [params, setParams] = useSearchParams();
  const end = useRef(null);
  const busy = thread.some((t) => t.loading);

  useEffect(() => {
    const q = params.get("q");
    if (q) { ask(q); const n = new URLSearchParams(params); n.delete("q"); setParams(n, { replace: true }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [thread]);

  return (
    <div className="flex h-full flex-col">
      <div className="scroll-pane flex-1">
        <div className="mx-auto max-w-[760px] px-4 py-6 md:px-8 md:py-10">
          {thread.length === 0 ? (
            <div className="pt-6 md:pt-16">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-line bg-raised"><MessageCircleQuestion size={18} className="text-fg-secondary" /></span>
              <h1 className="mt-4 text-title-l md:text-display-s">Ask anything about {project?.name || "this work"}</h1>
              <p className="mt-2 text-body-m text-fg-tertiary">Bracket answers only from memory and the sources you connected — and shows where every claim came from.</p>
              <div className="mt-8 grid gap-2 sm:grid-cols-2">
                {ASK_SUGGESTIONS.map((s) => (
                  <button key={s} onClick={() => ask(s)} className="rounded-lg border border-line px-4 py-3 text-left text-body-m text-fg-secondary hover:border-line-strong hover:bg-hover hover:text-fg">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              <div className="mb-6 flex justify-end"><Button size="s" variant="secondary" icon={Plus} onClick={reset}>New question</Button></div>
              <AskThread thread={thread} />
              <div ref={end} className="h-4" />
            </>
          )}
        </div>
      </div>
      <div className="border-t border-line-subtle bg-app px-4 py-4 safe-bottom md:pb-4">
        <div className="mx-auto max-w-[760px]">
          <AskComposer onSubmit={ask} disabled={busy} scopeLabel={project?.name} autoFocus placeholder={thread.length ? "Ask a follow-up…" : "Ask a question…"} />
          <p className="mt-2 text-center text-body-s text-fg-tertiary">Answers only use this workspace’s memory and connected sources.</p>
        </div>
      </div>
    </div>
  );
}
