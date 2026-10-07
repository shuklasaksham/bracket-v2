import React, { useRef, useState } from "react";
import { ArrowUp, Copy, MessageCircleQuestion, Layers, Info, Check } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "../lib/data";
import { Avatar, Button, Confidence, SourceMark, Spinner } from "../ui/primitives";
import { cn } from "../../lib/utils";
import { useAuth } from "../../lib/AuthContext";

/* POST /projects/:id/ask  (or /ask/all across every workspace)
   → { answer, confidence, sources: [{label, provider, detail}] } */
export function useAsk(projectId) {
  const [thread, setThread] = useState([]); // [{q, a?, error?, loading}]
  const ask = async (question) => {
    const q = question.trim();
    if (q.length < 3) return;
    setThread((t) => [...t, { q, loading: true }]);
    try {
      const url = projectId ? `/projects/${projectId}/ask` : "/ask/all";
      const { data } = await api.post(url, { question: q });
      setThread((t) => t.map((x, i) => (i === t.length - 1 ? { q, a: data, loading: false } : x)));
    } catch (e) {
      setThread((t) => t.map((x, i) => (i === t.length - 1 ? { q, error: formatApiError(e), loading: false } : x)));
    }
  };
  return { thread, ask, reset: () => setThread([]) };
}

export function AskComposer({ onSubmit, disabled, scopeLabel, autoFocus, placeholder = "Ask a follow-up…" }) {
  const [v, setV] = useState("");
  const ref = useRef(null);
  const submit = () => {
    if (!v.trim() || disabled) return;
    onSubmit(v);
    setV("");
  };
  return (
    <div className="rounded-xl border border-line bg-surface focus-within:border-line-strong transition-colors duration-fast">
      <textarea
        ref={ref}
        autoFocus={autoFocus}
        value={v}
        rows={2}
        maxLength={500}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
        }}
        placeholder={placeholder}
        aria-label="Ask Bracket"
        className="block w-full resize-none bg-transparent px-4 pt-3 text-body-m text-fg placeholder:text-fg-disabled focus:outline-none"
      />
      <div className="flex items-center justify-between gap-2 px-3 pb-3">
        {scopeLabel ? (
          <span className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line px-2 text-body-s text-fg-tertiary truncate max-w-[70%]">
            <Layers size={13} /> {scopeLabel}
          </span>
        ) : <span />}
        <button
          onClick={submit}
          disabled={!v.trim() || disabled}
          aria-label="Send question"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-inverse text-fg-inverse disabled:opacity-30 transition-opacity"
        >
          {disabled ? <Spinner size={14} className="text-fg-inverse" /> : <ArrowUp size={16} />}
        </button>
      </div>
    </div>
  );
}

export function AskThread({ thread, compact }) {
  const { user } = useAuth();
  return (
    <div className={cn("space-y-8", compact && "space-y-6")}>
      {thread.map((t, i) => (
        <div key={i} className="animate-fade-up">
          <div className="flex items-start gap-3">
            <Avatar name={user?.name} email={user?.email} src={user?.picture} size="s" />
            <h2 className={cn("text-fg", compact ? "text-title-s" : "text-title-m")}>{t.q}</h2>
          </div>
          <div className="mt-4 pl-0 md:pl-9">
            {t.loading ? (
              <div className="flex items-center gap-2 text-body-s text-fg-tertiary" role="status">
                <Spinner size={14} /> Reading memory and connected sources…
              </div>
            ) : t.error ? (
              <p className="text-body-m text-danger" role="alert">{t.error}</p>
            ) : (
              <Answer a={t.a} />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function Answer({ a }) {
  const [copied, setCopied] = useState(false);
  const sources = a?.sources || [];
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(a.answer || "");
      setCopied(true);
      toast.success("Answer copied");
      setTimeout(() => setCopied(false), 1600);
    } catch { /* ignore */ }
  };
  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-body-s text-fg-tertiary">
        <MessageCircleQuestion size={14} /> Bracket · answered from {sources.length} source{sources.length === 1 ? "" : "s"}
      </div>
      <div className="whitespace-pre-wrap text-body-l text-fg">{a?.answer}</div>
      {a?.confidence && a.confidence !== "high" && (
        <div className="mt-4 rounded-lg border border-line bg-surface px-4 py-3">
          <p className="flex items-center gap-2 text-title-s"><Info size={14} className="text-fg-tertiary" /> What Bracket isn’t sure about</p>
          <p className="mt-1 text-body-s text-fg-tertiary">Bracket only answers from confirmed memory and connected sources. Check the sources below before relying on this.</p>
          <div className="mt-2"><Confidence level={a.confidence} /></div>
        </div>
      )}
      {sources.length > 0 && (
        <div className="mt-5">
          <p className="eyebrow mb-2">Sources · {sources.length}</p>
          <ol className="overflow-hidden rounded-lg border border-line">
            {sources.map((s, i) => (
              <li key={i} className="flex items-start gap-3 border-b border-line-subtle px-3 py-2.5 last:border-0">
                <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border border-line font-mono text-[11px] text-fg-tertiary">{i + 1}</span>
                <SourceMark provider={s.provider} size={14} className="mt-0.5" />
                <span className="min-w-0">
                  <span className="block text-body-m text-fg truncate">{s.label}</span>
                  {s.detail && <span className="block text-body-s text-fg-tertiary">{s.detail}</span>}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
      <div className="mt-3 flex gap-1">
        <Button size="s" variant="ghost" icon={copied ? Check : Copy} onClick={copy}>{copied ? "Copied" : "Copy"}</Button>
      </div>
    </div>
  );
}

export const ASK_SUGGESTIONS = [
  "What did we agree on the deadline?",
  "What is currently included in scope?",
  "What are we waiting on from the client?",
  "What changed this week?",
];
