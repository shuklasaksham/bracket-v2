import React, { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertTriangle, ArrowRight, Clock, HelpCircle, Plug, RefreshCw, Plus, MessageCircleQuestion, Sparkles, CheckCircle2, Mail,
} from "lucide-react";
import { useWorkspace } from "../../lib/workspace";
import { CATEGORIES, catSingular, isPending, shortTime, timeAgo, toDate } from "../../lib/data";
import { Badge, Button, Card, EmptyState, EvidenceChip, Kbd, SectionHeader, Skeleton, providerLabel } from "../../ui/primitives";
import { useAskPanel } from "../../shell/AskPanel";
import { cn } from "../../../lib/utils";

/* Overview — "what needs me, what's coming, what changed". */
export default function Overview() {
  const ws = useWorkspace();
  const { project, memory, items, pending, connections, history, lastSeen, projectId } = ws;
  const navigate = useNavigate();
  const ask = useAskPanel();
  const base = `/w/${projectId}`;

  const attention = useMemo(() => buildAttention({ pending, items, connections, base }), [pending, items, connections, base]);
  const comingUp = useMemo(
    () => items.filter((m) => (m.display_category === "deadline" || m.display_category === "timeline") && m.status === "confirmed").slice(0, 6),
    [items],
  );
  const since = useMemo(() => {
    if (!history) return [];
    const cut = lastSeen ? toDate(lastSeen) : null;
    const list = cut ? history.filter((e) => toDate(e.at) > cut) : history;
    return (list.length ? list : history).slice(0, 6);
  }, [history, lastSeen]);

  if (!project || !memory) return <OverviewSkeleton />;

  const noSources = (connections || []).length === 0 && (memory?.total || 0) === 0;
  const lastUpdate = items.reduce((max, m) => (m.updated_at > max ? m.updated_at : max), "");

  return (
    <div className="scroll-pane h-full">
      <div className="mx-auto max-w-[1360px] px-4 py-5 md:px-8 md:py-7 xl:px-10">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-title-l md:text-[22px] md:leading-7 text-fg truncate">{project.name}</h1>
            <p className="mt-1 text-body-m text-fg-tertiary">
              {[project.client_name, attention.length ? `${attention.length} thing${attention.length > 1 ? "s" : ""} need you` : "Nothing needs you right now"].filter(Boolean).join(" · ")}
            </p>
          </div>
          {lastUpdate && (
            <span className="hidden md:inline-flex items-center gap-1.5 font-mono text-mono-s text-fg-tertiary">
              <Clock size={13} /> Memory updated {timeAgo(lastUpdate)}
            </span>
          )}
        </div>

        {noSources ? (
          <Card className="mt-6">
            <EmptyState
              icon={Plug}
              title="Connect a source to start"
              action={
                <>
                  <Button variant="primary" icon={Plus} onClick={() => navigate(`${base}/sources?add=1`)}>Connect a source</Button>
                  <Button variant="secondary" onClick={() => navigate(`${base}/sources?note=1`)}>Add a note</Button>
                </>
              }
            >
              Bracket learns scope, decisions and commitments from the conversations you choose. Nothing is read until you pick it.
            </EmptyState>
          </Card>
        ) : (
          <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
            {/* Left column */}
            <div className="min-w-0 space-y-8">
              <section aria-labelledby="attn">
                <SectionHeader title={<span id="attn">Needs your attention</span>} count={attention.length} />
                {attention.length === 0 ? (
                  <Card>
                    <EmptyState icon={CheckCircle2} title="You’re all caught up">
                      Bracket will surface scope changes, conflicts and anything you’re waiting on here.
                    </EmptyState>
                  </Card>
                ) : (
                  <Card className="divide-y divide-line-subtle overflow-hidden">
                    {attention.map((a) => <AttentionItem key={a.key} a={a} />)}
                  </Card>
                )}
              </section>

              <section aria-labelledby="coming">
                <SectionHeader
                  title={<span id="coming">Coming up</span>}
                  count={comingUp.length}
                  action={<Link to={`${base}/memory?cat=deadline`} className="inline-flex items-center gap-1 text-body-s text-fg-tertiary hover:text-fg">All deadlines <ArrowRight size={13} /></Link>}
                />
                {comingUp.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-body-s text-fg-tertiary">No confirmed deadlines yet. Bracket adds them when a date is agreed.</p>
                ) : (
                  <Card className="overflow-hidden">
                    {comingUp.map((m) => (
                      <Link key={m.id} to={`${base}/memory?item=${m.id}`} className="flex items-center gap-3 border-b border-line-subtle px-4 py-3 last:border-0 hover:bg-hover">
                        <span className="w-24 shrink-0 font-mono text-mono-s text-fg-tertiary">{catSingular(m.display_category)}</span>
                        <span className="flex-1 min-w-0 truncate text-body-m text-fg">{m.title}</span>
                        <span className="hidden sm:block truncate max-w-[200px] text-body-s text-fg-tertiary">{m.requested_by || providerLabel(m.provider)}</span>
                        <ArrowRight size={14} className="text-fg-tertiary" />
                      </Link>
                    ))}
                  </Card>
                )}
              </section>
            </div>

            {/* Right column */}
            <aside className="min-w-0 space-y-8">
              <section aria-labelledby="mem">
                <SectionHeader
                  title={<span id="mem">Memory</span>}
                  count={memory.total}
                  action={<Link to={`${base}/memory`} className="inline-flex items-center gap-1 text-body-s text-fg-tertiary hover:text-fg">Open <ArrowRight size={13} /></Link>}
                />
                <Card className="overflow-hidden">
                  {CATEGORIES.filter((c) => (memory.counts?.[c.key] || 0) > 0 || ["scope", "decision", "deliverable", "requirement"].includes(c.key)).map((c) => {
                    const pend = (memory.grouped?.[c.key] || []).filter(isPending).length;
                    return (
                      <Link key={c.key} to={`${base}/memory?cat=${c.key}`} className="flex h-11 items-center gap-3 border-b border-line-subtle px-4 last:border-0 hover:bg-hover">
                        <span className="flex-1 text-body-m text-fg-secondary">{c.label}</span>
                        {pend > 0 && <Badge tone="warning" dot>{pend} change{pend > 1 ? "s" : ""}</Badge>}
                        <span className="w-6 text-right num text-body-s text-fg-tertiary">{memory.counts?.[c.key] || 0}</span>
                        <ArrowRight size={14} className="text-fg-tertiary" />
                      </Link>
                    );
                  })}
                </Card>
              </section>

              <section aria-labelledby="since">
                <SectionHeader
                  title={<span id="since">{lastSeen ? "Since your last visit" : "Recent activity"}</span>}
                  action={<Link to={`${base}/timeline`} className="inline-flex items-center gap-1 text-body-s text-fg-tertiary hover:text-fg">Timeline <ArrowRight size={13} /></Link>}
                />
                <Card className="p-1.5">
                  {since.length === 0 ? (
                    <p className="px-3 py-4 text-body-s text-fg-tertiary">Nothing new yet.</p>
                  ) : (
                    since.map((e) => (
                      <Link key={e.id} to={`${base}/timeline?e=${encodeURIComponent(e.id)}`} className="flex items-start gap-3 rounded-md px-2.5 py-2 hover:bg-hover">
                        <HistoryIcon kind={e.kind} provider={e.provider} />
                        <span className="flex-1 min-w-0 text-body-m text-fg-secondary line-clamp-2">{e.title}</span>
                        <span className="shrink-0 font-mono text-mono-s text-fg-tertiary">{shortTime(e.at)}</span>
                      </Link>
                    ))
                  )}
                </Card>
              </section>
            </aside>
          </div>
        )}
      </div>

      {/* Ask Bracket — floating (desktop) */}
      <button
        onClick={() => ask.open()}
        className="fixed bottom-6 right-6 z-20 hidden md:inline-flex h-10 items-center gap-2 rounded-lg border border-line-strong bg-raised px-3.5 text-body-m text-fg shadow-popover hover:bg-[#1b1c20]"
      >
        <MessageCircleQuestion size={16} /> Ask Bracket <Kbd>⌘J</Kbd>
      </button>
    </div>
  );
}

/* ───────── attention model ───────── */
function buildAttention({ pending, items, connections, base }) {
  const out = [];
  if (pending.length) {
    const scope = pending.filter((m) => m.is_scope_change || m.display_category === "scope");
    const lead = scope[0] || pending[0];
    const cats = [...new Set(pending.map((m) => m.display_category))].map(catSingular).slice(0, 3).join(", ");
    out.push({
      key: "updates",
      tone: scope.length ? "warning" : "info",
      icon: scope.length ? AlertTriangle : Sparkles,
      kicker: scope.length ? `Potential scope change · affects ${pending.length} memor${pending.length > 1 ? "ies" : "y"}` : `${pending.length} proposed update${pending.length > 1 ? "s" : ""}`,
      title: lead.title,
      detail: `Touches ${cats.toLowerCase()}. Nothing changes until you accept.`,
      evidence: { provider: lead.provider, label: [lead.requested_by || lead.source_label, shortTime(lead.created_at)].filter(Boolean).join(" · ") },
      action: { label: `Review ${pending.length} change${pending.length > 1 ? "s" : ""}`, to: `${base}/review`, primary: true },
    });
  }
  const questions = items.filter((m) => m.display_category === "question" && m.status !== "confirmed" && !isPending(m)).slice(0, 2);
  questions.forEach((q) =>
    out.push({
      key: `q-${q.id}`,
      tone: "neutral",
      icon: HelpCircle,
      kicker: "Open question",
      title: q.title,
      detail: q.detail,
      evidence: { provider: q.provider, label: [q.requested_by || q.source_label, shortTime(q.created_at)].filter(Boolean).join(" · ") },
      action: { label: "Draft reply", to: `${base}/conversations?draft=${q.id}` },
    }),
  );
  (connections || []).filter((c) => c.health && c.health.level && c.health.level !== "green").forEach((c) =>
    out.push({
      key: `c-${c.id}`,
      tone: c.health.level === "red" ? "danger" : "warning",
      icon: RefreshCw,
      kicker: `${providerLabel(c.provider)} needs attention`,
      title: c.health.message || `${c.source_name} can’t sync`,
      detail: "New messages aren’t being read. Memory you’ve already reviewed is unaffected.",
      evidence: { provider: c.provider, label: c.source_name },
      action: { label: "Fix source", to: `${base}/sources?c=${c.id}` },
    }),
  );
  return out;
}

function AttentionItem({ a }) {
  const navigate = useNavigate();
  const toneText = { warning: "text-warning", danger: "text-danger", info: "text-info", neutral: "text-fg-tertiary" }[a.tone];
  return (
    <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start md:px-5">
      <a.icon size={16} className={cn("mt-0.5 shrink-0 hidden sm:block", toneText)} strokeWidth={1.75} />
      <div className="flex-1 min-w-0">
        <p className={cn("text-body-s font-medium", toneText)}>{a.kicker}</p>
        <p className="mt-1 text-title-m text-fg">{a.title}</p>
        {a.detail && <p className="mt-1 text-body-m text-fg-tertiary line-clamp-2">{a.detail}</p>}
        {a.evidence?.label && (
          <div className="mt-2.5"><EvidenceChip provider={a.evidence.provider}>{a.evidence.label}</EvidenceChip></div>
        )}
      </div>
      <Button
        variant={a.action.primary ? "primary" : "secondary"}
        className="w-full sm:w-auto"
        size="m"
        onClick={() => navigate(a.action.to)}
      >
        {a.action.label}
      </Button>
    </div>
  );
}

export function HistoryIcon({ kind, provider }) {
  const map = {
    CHANGE_ACCEPTED: { i: CheckCircle2, c: "text-success" },
    SOURCE_CONNECTED: { i: Plug, c: "text-fg-tertiary" },
    SOURCE_DISCONNECTED: { i: Plug, c: "text-fg-tertiary" },
    SOURCE_UPDATED: { i: Mail, c: "text-fg-tertiary" },
    CREATED: { i: Plus, c: "text-fg-tertiary" },
    EDITED: { i: RefreshCw, c: "text-fg-tertiary" },
  };
  const m = map[kind] || { i: Clock, c: "text-fg-tertiary" };
  return <m.i size={15} className={cn("mt-0.5 shrink-0", m.c)} strokeWidth={1.75} aria-hidden="true" />;
}

function OverviewSkeleton() {
  return (
    <div className="mx-auto max-w-[1360px] px-4 py-7 md:px-8 xl:px-10" aria-busy="true">
      <Skeleton className="h-7 w-80" />
      <Skeleton className="mt-2 h-4 w-96 max-w-full" />
      <div className="mt-8 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-3"><Skeleton className="h-36" /><Skeleton className="h-36" /><Skeleton className="h-36" /></div>
        <div className="space-y-3"><Skeleton className="h-64" /><Skeleton className="h-40" /></div>
      </div>
    </div>
  );
}
