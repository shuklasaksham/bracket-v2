import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, AlertTriangle, CheckCircle2, Sparkles, Info, RotateCcw, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "../../lib/workspace";
import { api, formatApiError, catSingular, shortTime } from "../../lib/data";
import { Badge, Button, Card, Checkbox, EmptyState, EvidenceChip, Kbd, Skeleton, Spinner, providerLabel } from "../../ui/primitives";
import { Dialog } from "../../ui/overlays";
import { cn } from "../../../lib/utils";
import { useIsMobile } from "../../lib/useMedia";

/* Change review — ONE consolidated update for every pending change.
   POST /projects/:id/update/build → snapshot { summary, priority, impacts,
   direct[], downstream[] }. Accept → /approve with exclude lists (excluded
   direct items are dismissed). Dismiss all → /reject. Undo → /undo.         */
export default function Review() {
  const ws = useWorkspace();
  const { projectId, pending, refresh } = ws;
  const navigate = useNavigate();
  const mobile = useIsMobile();
  const [snap, setSnap] = useState(null);
  const [state, setState] = useState("loading"); // loading | ready | empty | error
  const [error, setError] = useState("");
  const [offDirect, setOffDirect] = useState(new Set());
  const [offDown, setOffDown] = useState(new Set());
  const [busy, setBusy] = useState(null);
  const [focus, setFocus] = useState(0);
  const [confirmDismiss, setConfirmDismiss] = useState(false);
  const [tab, setTab] = useState("updates"); // mobile: updates | source

  const build = useCallback(async () => {
    setState("loading");
    setError("");
    try {
      const { data } = await api.post(`/projects/${projectId}/update/build`);
      if (!data?.pending) { setSnap(null); setState("empty"); return; }
      setSnap(data.update);
      setOffDirect(new Set());
      setOffDown(new Set());
      setState("ready");
    } catch (e) {
      setError(formatApiError(e));
      setState("error");
    }
  }, [projectId]);

  useEffect(() => { build(); }, [build]);

  const direct = useMemo(() => snap?.direct || [], [snap]);
  const downstream = useMemo(() => snap?.downstream || [], [snap]);
  const downKey = (d) => `${d.category}|${d.title}`;
  const selectedDirect = direct.filter((d) => !offDirect.has(d.id));
  const selectedDown = downstream.filter((d) => !offDown.has(downKey(d)));
  const total = direct.length + downstream.length;
  const selected = selectedDirect.length + selectedDown.length;

  const toggleDirect = (id) => setOffDirect((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleDown = (k) => setOffDown((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

  const accept = useCallback(async () => {
    if (!snap || !selected) return;
    setBusy("accept");
    try {
      const { data } = await api.post(`/projects/${projectId}/update/${snap.id}/approve`, {
        exclude_direct: [...offDirect],
        exclude_downstream: [...offDown],
      });
      await refresh("memory", "history");
      toast.success(`${data.confirmed + data.added} update${data.confirmed + data.added === 1 ? "" : "s"} accepted`, {
        description: data.impact || "Memory updated.",
        duration: 8000,
        action: {
          label: "Undo",
          onClick: async () => {
            try {
              await api.post(`/projects/${projectId}/update/${snap.id}/undo`);
              await refresh("memory", "history");
              toast("Change undone — updates are back in review.");
              navigate(`/w/${projectId}/review`);
            } catch (e) { toast.error(formatApiError(e)); }
          },
        },
      });
      navigate(`/w/${projectId}`);
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusy(null);
    }
  }, [snap, selected, projectId, offDirect, offDown, refresh, navigate]);

  const dismissAll = async () => {
    setBusy("reject");
    try {
      const { data } = await api.post(`/projects/${projectId}/update/${snap.id}/reject`);
      await refresh("memory", "history");
      toast(`${data.discarded} update${data.discarded === 1 ? "" : "s"} dismissed — memory unchanged.`);
      setConfirmDismiss(false);
      navigate(`/w/${projectId}`);
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusy(null);
    }
  };

  // Keyboard: J/K move, X toggles, ⌘↵ accepts
  useEffect(() => {
    if (state !== "ready") return undefined;
    const rows = [...direct.map((d) => ({ t: "d", k: d.id })), ...downstream.map((d) => ({ t: "s", k: downKey(d) }))];
    const onKey = (e) => {
      if (/INPUT|TEXTAREA/.test(e.target?.tagName)) return;
      if (e.key === "j") { e.preventDefault(); setFocus((f) => Math.min(rows.length - 1, f + 1)); }
      else if (e.key === "k") { e.preventDefault(); setFocus((f) => Math.max(0, f - 1)); }
      else if (e.key === "x") { const r = rows[focus]; if (r) (r.t === "d" ? toggleDirect(r.k) : toggleDown(r.k)); }
      else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); accept(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, direct, downstream, focus, accept]);

  const sources = useMemo(() => {
    const map = new Map();
    for (const d of direct) {
      const k = `${d.provider}|${d.source_label}`;
      if (!map.has(k)) map.set(k, { provider: d.provider, label: d.source_label, by: d.requested_by, items: [] });
      map.get(k).items.push(d);
    }
    return [...map.values()];
  }, [direct]);

  const isScope = direct.some((d) => d.is_scope_change || d.category === "scope");

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-line-subtle px-4 py-4 md:px-8">
        <Link to={`/w/${projectId}`} className="inline-flex items-center gap-1.5 text-body-s text-fg-tertiary hover:text-fg">
          <ArrowLeft size={14} /> Overview
        </Link>
        {state === "ready" ? (
          <div className="mt-2">
            <p className={cn("text-body-s font-medium", isScope ? "text-warning" : "text-info")}>
              {isScope ? "Potential scope change" : "Proposed updates"} · {direct.length} detected{downstream.length ? ` · ${downstream.length} follow-on` : ""}
            </p>
            <h1 className="mt-1 text-title-l text-fg">{snap.summary || direct[0]?.title || "Review proposed updates"}</h1>
            <p className="mt-1 text-body-s text-fg-tertiary">Nothing changes until you accept. Low-confidence items can be unselected.</p>
          </div>
        ) : (
          <h1 className="mt-2 text-title-l">Review changes</h1>
        )}
      </div>

      {state === "loading" && (
        <div className="flex-1 px-4 py-6 md:px-8">
          <div className="flex items-center gap-2 text-body-s text-fg-tertiary" role="status"><Spinner size={14} /> Bracket is working out what these changes affect…</div>
          <div className="mt-5 grid gap-4 lg:grid-cols-2"><Skeleton className="h-72" /><Skeleton className="h-72" /></div>
        </div>
      )}
      {state === "error" && (
        <div className="flex-1 px-4 py-10">
          <EmptyState icon={AlertTriangle} title="Couldn’t prepare this review" action={<Button onClick={build} icon={RotateCcw}>Try again</Button>}>{error}</EmptyState>
        </div>
      )}
      {state === "empty" && (
        <div className="flex-1 px-4 py-10">
          <EmptyState icon={CheckCircle2} title="Nothing to review" action={<Button variant="primary" onClick={() => navigate(`/w/${projectId}`)}>Back to Overview</Button>}>
            Memory is up to date. Bracket will bring new changes here when a conversation affects scope, deadlines or decisions.
          </EmptyState>
        </div>
      )}

      {state === "ready" && (
        <>
          {mobile && (
            <div className="px-4 pt-3">
              <div className="grid grid-cols-2 rounded-md border border-line p-0.5">
                {[["updates", `Proposed updates · ${direct.length}`], ["source", "Source"]].map(([k, l]) => (
                  <button key={k} onClick={() => setTab(k)} className={cn("h-8 rounded-[4px] text-body-s font-medium", tab === k ? "bg-selected text-fg" : "text-fg-tertiary")}>{l}</button>
                ))}
              </div>
            </div>
          )}
          <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
            {/* What happened */}
            {(!mobile || tab === "source") && (
              <section className="scroll-pane min-h-0 border-r border-line-subtle px-4 py-5 md:px-8" aria-label="What happened">
                <p className="eyebrow mb-3">What happened</p>
                <div className="space-y-3">
                  {sources.map((s, i) => (
                    <Card key={i} className="p-4">
                      <div className="flex items-center gap-2"><EvidenceChip provider={s.provider}>{s.label || providerLabel(s.provider)}</EvidenceChip>{s.by && <span className="text-body-s text-fg-tertiary truncate">from {s.by}</span>}</div>
                      <ul className="mt-3 space-y-2">
                        {s.items.map((d) => (
                          <li key={d.id} className="rounded-md border-l-2 border-warning/70 bg-warning-bg/40 px-3 py-2">
                            <p className="text-body-m text-fg">{d.title}</p>
                            {d.detail && <p className="mt-0.5 text-body-s text-fg-tertiary">{d.detail}</p>}
                          </li>
                        ))}
                      </ul>
                    </Card>
                  ))}
                </div>
                {(snap.impacts || []).length > 0 && (
                  <div className="mt-6">
                    <p className="eyebrow mb-3">What this affects</p>
                    <Card className="divide-y divide-line-subtle">
                      {snap.impacts.map((im, i) => (
                        <div key={i} className="flex gap-3 px-4 py-3">
                          <Info size={14} className="mt-0.5 shrink-0 text-fg-tertiary" />
                          <div className="min-w-0">
                            {im?.kind && <p className="eyebrow">{im.kind}</p>}
                            <p className="text-body-m text-fg-secondary">{typeof im === "string" ? im : im.detail || im.text || ""}</p>
                          </div>
                        </div>
                      ))}
                    </Card>
                  </div>
                )}
              </section>
            )}

            {/* Bracket's interpretation */}
            {(!mobile || tab === "updates") && (
              <section className="scroll-pane min-h-0 px-4 py-5 md:px-8 pb-28" aria-label="Proposed updates">
                <div className="mb-3 flex items-center justify-between">
                  <p className="eyebrow">Proposed updates · {selected} of {total} selected</p>
                  <button
                    className="text-body-s text-fg-tertiary hover:text-fg"
                    onClick={() => {
                      if (selected === total) { setOffDirect(new Set(direct.map((d) => d.id))); setOffDown(new Set(downstream.map(downKey))); }
                      else { setOffDirect(new Set()); setOffDown(new Set()); }
                    }}
                  >
                    {selected === total ? "Deselect all" : "Select all"}
                  </button>
                </div>
                <Card className="overflow-hidden">
                  {direct.map((d, i) => (
                    <UpdateRow key={d.id} focused={focus === i} checked={!offDirect.has(d.id)} onToggle={() => toggleDirect(d.id)} onFocus={() => setFocus(i)}
                      category={d.category} tone={d.is_scope_change ? "warning" : "info"} tag={d.is_scope_change ? "Scope change" : "Update"} title={d.title} detail={d.detail}
                      meta={[d.requested_by, d.source_label].filter(Boolean).join(" · ")} provider={d.provider} />
                  ))}
                </Card>
                {downstream.length > 0 && (
                  <div className="mt-6">
                    <p className="eyebrow mb-1 flex items-center gap-1.5"><Sparkles size={12} /> Bracket will also add</p>
                    <p className="mb-3 text-body-s text-fg-tertiary">Follow-on changes these updates imply. Unselect anything that doesn’t apply.</p>
                    <Card className="overflow-hidden">
                      {downstream.map((d, j) => (
                        <UpdateRow key={downKey(d)} focused={focus === direct.length + j} checked={!offDown.has(downKey(d))} onToggle={() => toggleDown(downKey(d))} onFocus={() => setFocus(direct.length + j)}
                          category={d.category} tone="neutral" tag="Follow-on" title={d.title} detail={d.detail || d.reason} />
                      ))}
                    </Card>
                  </div>
                )}
              </section>
            )}
          </div>

          {/* Action bar */}
          <div className="sticky bottom-0 z-10 flex flex-col gap-2 border-t border-line-subtle bg-app/95 px-4 py-3 backdrop-blur md:flex-row md:items-center md:px-8 safe-bottom md:pb-3">
            <div className="flex-1 min-w-0">
              <p className="text-body-m text-fg"><span className="num">{selected}</span> of <span className="num">{total}</span> updates selected</p>
              <p className="hidden md:block text-body-s text-fg-tertiary">Unselected updates are dismissed. You can undo right after accepting.</p>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size={mobile ? "l" : "m"} className="flex-1 md:flex-none" onClick={() => setConfirmDismiss(true)} disabled={!!busy}>Dismiss all</Button>
              <Button variant="primary" size={mobile ? "l" : "m"} className="flex-[2] md:flex-none" loading={busy === "accept"} disabled={!selected || !!busy} onClick={accept}>
                Accept {selected} update{selected === 1 ? "" : "s"} {!mobile && <Kbd className="ml-1 border-black/10 bg-black/5 text-fg-inverse/60">⌘↵</Kbd>}
              </Button>
            </div>
          </div>

          <Dialog
            open={confirmDismiss}
            onOpenChange={setConfirmDismiss}
            title={`Dismiss all ${direct.length} updates?`}
            description="Memory stays exactly as it is. The source messages stay in Conversations, so you can revisit them."
            size="s"
            footer={
              <>
                <Button variant="ghost" onClick={() => setConfirmDismiss(false)}>Cancel</Button>
                <Button variant="danger" loading={busy === "reject"} onClick={dismissAll}>Dismiss all</Button>
              </>
            }
          >
            <p className="text-body-s text-fg-tertiary">Tip: to keep some updates, unselect the ones you don’t want and choose Accept instead.</p>
          </Dialog>
        </>
      )}
    </div>
  );
}

function UpdateRow({ checked, onToggle, focused, onFocus, category, tone, tag, title, detail, meta, provider }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cn("border-b border-line-subtle last:border-0", focused && "bg-hover")} onMouseEnter={onFocus}>
      <div className="flex items-start gap-3 px-4 py-3">
        <Checkbox checked={checked} onChange={onToggle} label={`Include: ${title}`} className="mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="eyebrow">{catSingular(category)}</span>
            <Badge tone={tone}>{tag}</Badge>
          </div>
          <p className={cn("mt-1 text-body-m", checked ? "text-fg" : "text-fg-tertiary line-through decoration-fg-disabled")}>{title}</p>
          {detail && open && <p className="mt-1 text-body-s text-fg-tertiary">{detail}</p>}
          {meta && <p className="mt-1 flex items-center gap-1.5 text-body-s text-fg-tertiary">{meta}</p>}
        </div>
        {detail && (
          <button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={open ? "Hide details" : "Show details"} className="rounded p-1 text-fg-tertiary hover:text-fg">
            <ChevronDown size={14} className={cn("transition-transform", open && "rotate-180")} />
          </button>
        )}
      </div>
    </div>
  );
}
