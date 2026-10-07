import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, ExternalLink, Reply, Send, Copy, RotateCcw, Sparkles, MessagesSquare, Info, Plus, FileText } from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "../../lib/workspace";
import { api, formatApiError, catSingular, isPending, shortTime, timeAgo } from "../../lib/data";
import { parseDigest } from "../../lib/digest";
import {
  Avatar, Badge, Button, Card, Checkbox, EmptyState, EvidenceChip, Segmented, Skeleton, SourceMark, Spinner, Textarea, providerLabel,
} from "../../ui/primitives";
import { useIsMobile, useMedia } from "../../lib/useMedia";
import { cn } from "../../../lib/utils";

/* Conversations — the connected threads, what Bracket learned from each,
   and a grounded reply composer (suggest-reply → send via Gmail / Slack). */
export default function Conversations() {
  const ws = useWorkspace();
  const { connections, notes, items, projectId, project, refresh } = ws;
  const [params, setParams] = useSearchParams();
  const mobile = useIsMobile();
  const wide = useMedia("(min-width: 1280px)");
  const [filter, setFilter] = useState("all");
  const draftFor = params.get("draft");
  const draftItem = draftFor ? items.find((m) => m.id === draftFor) : null;

  const threads = useMemo(() => {
    const all = [
      ...(connections || []).map((c) => ({ ...c, kind: "source" })),
      ...(notes || []).map((n) => ({ id: n.id, provider: "meeting", source_name: n.title, last_activity_at: n.created_at, kind: "note", items: n.items })),
    ];
    return all
      .map((t) => {
        const mine = items.filter((m) => m.connection_id === t.id);
        return { ...t, pending: mine.filter(isPending).length, learned: mine.length };
      })
      .sort((a, b) => (b.last_activity_at || "").localeCompare(a.last_activity_at || ""));
  }, [connections, notes, items]);

  const shown = filter === "updates" ? threads.filter((t) => t.pending > 0) : filter === "notes" ? threads.filter((t) => t.kind === "note") : threads;
  const selId = params.get("c") || (draftItem?.connection_id) || (!mobile ? shown[0]?.id : null);
  const sel = threads.find((t) => t.id === selId) || null;
  const select = (id) => { const n = new URLSearchParams(params); n.set("c", id); n.delete("draft"); setParams(n, { replace: true }); };

  if (!connections) return <div className="p-8 space-y-3" aria-busy="true"><Skeleton className="h-8 w-60" /><Skeleton className="h-20" /><Skeleton className="h-20" /></div>;

  if (threads.length === 0) {
    return (
      <div className="h-full scroll-pane">
        <EmptyState icon={MessagesSquare} title="No conversations yet" className="py-20"
          action={<Button variant="primary" icon={Plus} onClick={() => (window.location.href = `/w/${projectId}/sources?add=1`)}>Connect a source</Button>}>
          Connect Gmail or Slack and pick the threads about this work. Bracket only reads what you choose.
        </EmptyState>
      </div>
    );
  }

  const listPane = (
    <section className={cn("flex min-h-0 flex-col border-r border-line-subtle", mobile ? "flex-1" : "w-[320px] shrink-0 xl:w-[340px]")} aria-label="Conversations">
      <div className="border-b border-line-subtle px-4 py-4">
        <h1 className="text-title-l">Conversations <span className="num text-body-m text-fg-tertiary">{threads.length}</span></h1>
        <Segmented className="mt-3" size="s" value={filter} onChange={setFilter}
          options={[{ value: "all", label: "All", count: threads.length }, { value: "updates", label: "Has updates", count: threads.filter((t) => t.pending).length }, { value: "notes", label: "Notes", count: (notes || []).length }]} />
      </div>
      <div className="scroll-pane flex-1">
        {shown.length === 0 && <p className="px-4 py-8 text-center text-body-s text-fg-tertiary">Nothing here.</p>}
        {shown.map((t) => (
          <button key={t.id} onClick={() => select(t.id)} className={cn("flex w-full gap-3 border-b border-line-subtle px-4 py-3 text-left hover:bg-hover", sel?.id === t.id && "bg-selected")}>
            <SourceMark provider={t.provider} size={16} className="mt-0.5" />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="flex-1 truncate text-body-m text-fg">{t.source_name}</span>
                <span className="font-mono text-mono-s text-fg-tertiary">{shortTime(t.last_activity_at || t.last_synced_at)}</span>
              </span>
              <span className="mt-0.5 block truncate text-body-s text-fg-tertiary">
                {t.kind === "note" ? "Meeting note" : providerLabel(t.provider)} · {t.learned} memor{t.learned === 1 ? "y" : "ies"}
              </span>
              {t.pending > 0 && <Badge tone="warning" dot className="mt-1.5">{t.pending} change{t.pending > 1 ? "s" : ""} detected</Badge>}
            </span>
          </button>
        ))}
      </div>
    </section>
  );

  if (mobile && !sel) return <div className="flex h-full flex-col">{listPane}</div>;

  return (
    <div className="flex h-full min-h-0">
      {!mobile && listPane}
      {sel && (
        <Thread
          key={sel.id}
          thread={sel}
          projectId={projectId}
          project={project}
          items={items.filter((m) => m.connection_id === sel.id)}
          draftItem={draftItem}
          wide={wide}
          mobile={mobile}
          onBack={() => { const n = new URLSearchParams(params); n.delete("c"); n.delete("draft"); setParams(n, { replace: true }); }}
          onSent={() => refresh("memory", "history")}
        />
      )}
    </div>
  );
}

function Thread({ thread, projectId, project, items, draftItem, wide, mobile, onBack, onSent }) {
  const navigate = useNavigate();
  const [content, setContent] = useState(null);
  const [err, setErr] = useState("");
  const [composer, setComposer] = useState(!!draftItem);
  useEffect(() => {
    let alive = true;
    setContent(null);
    setErr("");
    api.get(`/projects/${projectId}/connections/${thread.id}/content`)
      .then(({ data }) => alive && setContent(data))
      .catch((e) => alive && setErr(formatApiError(e)));
    return () => { alive = false; };
  }, [projectId, thread.id]);
  const msgs = useMemo(() => parseDigest(content?.provider || thread.provider, content?.content || ""), [content, thread.provider]);
  const pending = items.filter(isPending);
  const learned = items.filter((m) => !isPending(m));

  const side = (
    <div className="space-y-6">
      {pending.length > 0 && (
        <div>
          <p className="eyebrow mb-2">Would change · pending</p>
          <div className="space-y-2">
            {pending.map((m) => (
              <div key={m.id} className="border-l-2 border-warning pl-3">
                <p className="text-body-s text-warning">{catSingular(m.display_category)}</p>
                <p className="text-body-m text-fg">{m.title}</p>
              </div>
            ))}
          </div>
          <Button size="s" className="mt-3" onClick={() => navigate(`/w/${projectId}/review`)}>Review {pending.length} change{pending.length > 1 ? "s" : ""}</Button>
        </div>
      )}
      <div>
        <p className="eyebrow mb-2">Created from this {thread.kind === "note" ? "note" : "thread"} · {learned.length}</p>
        {learned.length === 0 ? <p className="text-body-s text-fg-tertiary">Nothing for memory yet. Bracket read this and found no scope, decisions or commitments.</p> : (
          <div className="space-y-2">
            {learned.slice(0, 12).map((m) => (
              <button key={m.id} onClick={() => navigate(`/w/${projectId}/memory?item=${m.id}`)} className="block w-full border-l-2 border-line pl-3 text-left hover:border-fg-tertiary">
                <p className="text-body-s text-fg-tertiary">{catSingular(m.display_category)}</p>
                <p className="text-body-m text-fg-secondary">{m.title}</p>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex min-w-0 flex-1 min-h-0">
      <section className="flex min-w-0 flex-1 flex-col" aria-label={thread.source_name}>
        <div className="flex items-start gap-3 border-b border-line-subtle px-4 py-4 md:px-6">
          {mobile && <button onClick={onBack} aria-label="Back to conversations" className="mt-0.5 rounded p-1 text-fg-tertiary hover:text-fg"><ArrowLeft size={18} /></button>}
          <div className="min-w-0 flex-1">
            <h2 className="text-title-m text-fg truncate">{thread.source_name}</h2>
            <p className="mt-0.5 flex items-center gap-1.5 text-body-s text-fg-tertiary">
              <SourceMark provider={thread.provider} size={12} /> {thread.kind === "note" ? "Meeting note" : providerLabel(thread.provider)}
              {msgs.length > 1 && <> · {msgs.length} messages</>} · updated {timeAgo(thread.last_activity_at || thread.last_synced_at)}
            </p>
          </div>
          {content?.source_url && (
            <Button size="s" variant="secondary" icon={ExternalLink} onClick={() => window.open(content.source_url, "_blank", "noopener")}>
              <span className="hidden sm:inline">Open in {providerLabel(thread.provider)}</span>
            </Button>
          )}
        </div>
        <div className="scroll-pane flex-1 px-4 py-5 md:px-6">
          {err ? <p className="text-body-m text-danger">{err}</p> : !content ? (
            <div className="space-y-4"><Skeleton className="h-24" /><Skeleton className="h-24" /></div>
          ) : msgs.length === 0 ? (
            <p className="text-body-s text-fg-tertiary">This source has no cached content yet. Run “Sync now” from Sources.</p>
          ) : (
            <ol className="space-y-6">
              {msgs.map((m, i) => (
                <li key={i} className="flex gap-3">
                  <Avatar name={m.author || providerLabel(thread.provider)} size="m" />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-baseline gap-x-2 text-body-s">
                      <span className="font-medium text-fg">{m.author || providerLabel(thread.provider)}</span>
                      {m.date && <span className="text-fg-tertiary">{m.date}</span>}
                    </p>
                    {m.subject && i === 0 && <p className="mt-0.5 text-body-s text-fg-tertiary">{m.subject}</p>}
                    <p className="mt-1 whitespace-pre-wrap break-words text-body-m text-fg-secondary">{m.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
          {!wide && <div className="mt-8 border-t border-line-subtle pt-6">{side}</div>}
        </div>
        {thread.kind !== "note" && (
          composer ? (
            <ReplyComposer projectId={projectId} project={project} thread={thread} seed={draftItem} onClose={() => setComposer(false)} onSent={onSent} />
          ) : (
            <div className="border-t border-line-subtle px-4 py-3 md:px-6 safe-bottom md:pb-3">
              <Button variant="secondary" icon={Reply} onClick={() => setComposer(true)} className="w-full md:w-auto" size={mobile ? "l" : "m"}>Draft a reply</Button>
            </div>
          )
        )}
      </section>
      {wide && (
        <aside className="scroll-pane w-[340px] shrink-0 border-l border-line-subtle px-5 py-5" aria-label="This conversation and memory">
          <p className="text-title-s mb-4">This conversation and memory</p>
          {side}
        </aside>
      )}
    </div>
  );
}

/* ───────── Reply composer ─────────
   POST /projects/:id/suggest-reply {instruction, history} → { reply, confidence, based_on, deep_links }
   Send: /send-email (Gmail, threaded) · /send-slack · demo: /demo/send-email */
function ReplyComposer({ projectId, project, thread, seed, onClose, onSent }) {
  const [instruction, setInstruction] = useState(seed ? `Reply about: ${seed.title}` : "");
  const [turns, setTurns] = useState([]); // [{role, content}]
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(null);
  const [targets, setTargets] = useState(null);
  const [chosen, setChosen] = useState(new Set());
  const box = useRef(null);

  useEffect(() => {
    api.get(`/projects/${projectId}/send-targets`).then(({ data }) => {
      const t = (data.targets || []).filter((x) => x.provider === "slack" ? x.channel_id === thread.source_id : x.thread_id === thread.source_id || !thread.source_id);
      const list = t.length ? t : data.targets || [];
      setTargets(list);
      setChosen(new Set(list.slice(0, 1).map(keyOf)));
    }).catch(() => setTargets([]));
  }, [projectId, thread.id, thread.source_id]);

  const generate = async (instr) => {
    setBusy("draft");
    try {
      const { data } = await api.post(`/projects/${projectId}/suggest-reply`, { instruction: instr, history: turns });
      setDraft({ ...data, text: (data.reply || "").trim() });
      setTurns((t) => [...t, { role: "user", content: instr || "Draft a reply" }, { role: "assistant", content: data.reply || "" }]);
    } catch (e) { toast.error(formatApiError(e)); } finally { setBusy(null); }
  };
  // Seeded from "Draft reply" on an open question — draft once on open.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (seed) generate(`Reply about: ${seed.title}`); }, []);

  const send = async () => {
    if (!draft?.text?.trim()) return;
    const pick = (targets || []).filter((t) => chosen.has(keyOf(t)));
    if (!pick.length) { toast.error("Choose where to send this reply."); return; }
    setBusy("send");
    try {
      const done = [];
      const gmail = pick.filter((t) => t.provider === "gmail");
      const slack = pick.filter((t) => t.provider === "slack");
      if (project?.is_demo && gmail.length) {
        const { data } = await api.post("/demo/send-email", { body: draft.text });
        toast.success(data?.message || "Demo email sent");
        setTimeout(async () => { try { await api.post("/demo/client-reply"); onSent(); toast("The client replied — Bracket updated memory."); } catch { /* ignore */ } }, 4000);
        done.push("demo email");
      } else if (gmail.length) {
        const { data } = await api.post(`/projects/${projectId}/send-email`, { body: draft.text, targets: gmail.map((t) => ({ to: t.to, thread_id: t.thread_id })) });
        done.push(`email to ${(data.to || []).join(", ")}`);
        if (data.failed?.length) toast.error(`Couldn’t send to ${data.failed.join(", ")}`);
      }
      for (const s of slack) {
        if (s.is_demo) continue;
        await api.post(`/projects/${projectId}/send-slack`, { channel_id: s.channel_id, body: draft.text });
        done.push(`#${s.channel_name}`);
      }
      if (done.length) toast.success(`Sent — ${done.join(" · ")}`, { description: "Replying confirms the pending asks in this thread." });
      onSent();
      onClose();
    } catch (e) { toast.error(formatApiError(e)); } finally { setBusy(null); }
  };

  return (
    <div className="border-t border-line bg-surface px-4 py-4 md:px-6 safe-bottom md:pb-4">
      <div className="mb-3 flex items-center gap-2">
        <Reply size={15} className="text-fg-tertiary" />
        <p className="flex-1 text-title-s">Draft reply <span className="font-normal text-body-s text-fg-tertiary">· written by Bracket, not sent</span></p>
        <Button size="s" variant="ghost" onClick={onClose}>Close</Button>
      </div>
      {!draft ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && generate(instruction)}
            placeholder="What should the reply say? e.g. confirm Oct 17, ask for brand assets"
            className="h-9 flex-1 rounded-md border border-line-control/60 bg-app px-3 text-body-m text-fg placeholder:text-fg-disabled focus:outline-none focus:border-fg-secondary"
            aria-label="Reply instruction"
          />
          <Button variant="primary" icon={Sparkles} loading={busy === "draft"} onClick={() => generate(instruction)}>Draft</Button>
        </div>
      ) : (
        <div>
          {draft.based_on && (
            <div className="mb-2 flex flex-wrap items-center gap-2 text-body-s text-fg-tertiary">
              Based on <EvidenceChip provider={draft.based_on.provider}>{draft.based_on.title}</EvidenceChip>
            </div>
          )}
          <Textarea ref={box} rows={6} value={draft.text} onChange={(e) => setDraft((d) => ({ ...d, text: e.target.value }))} aria-label="Reply text" className="bg-app" />
          <p className="mt-1.5 flex items-center gap-1.5 text-body-s text-fg-tertiary"><Info size={12} /> Check names, dates and numbers — Bracket drafts from memory and doesn’t know your capacity.</p>
          {targets && targets.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Send to">
              {targets.map((t) => (
                <label key={keyOf(t)} htmlFor={`t-${keyOf(t)}`} className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-md border border-line px-2.5 text-body-s text-fg-secondary">
                  <Checkbox id={`t-${keyOf(t)}`} checked={chosen.has(keyOf(t))} onChange={(v) => setChosen((s) => { const n = new Set(s); v ? n.add(keyOf(t)) : n.delete(keyOf(t)); return n; })} label={t.label} />
                  <SourceMark provider={t.provider} size={12} /> <span className="max-w-[220px] truncate">{t.label}</span>
                </label>
              ))}
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="s" icon={RotateCcw} loading={busy === "draft"} onClick={() => generate(instruction || "Rewrite this reply")}>Rewrite</Button>
            <Button variant="ghost" size="s" icon={Copy} onClick={() => { navigator.clipboard.writeText(draft.text); toast.success("Copied"); }}>Copy</Button>
            <div className="flex-1" />
            {targets && targets.length > 0 ? (
              <Button variant="primary" icon={Send} loading={busy === "send"} onClick={send}>Send</Button>
            ) : (
              <Button variant="primary" icon={ExternalLink} onClick={() => window.open(draft.deep_links?.gmail_web, "_blank", "noopener")}>Open in Gmail</Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
const keyOf = (t) => (t.provider === "slack" ? `s:${t.channel_id}` : `g:${t.thread_id}:${t.to}`);
