import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, GitFork, Info, Check, FileText } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { useWorkspace, refreshAll } from "../../lib/workspace";
import { v2 } from "../../lib/api2";
import { useResource } from "../../lib/data";
import { Button, IconButton, SourceMark, Skeleton, Input } from "../../ui/primitives";
import { AnimatePresence, Stagger, StaggerItem, motion, t as T } from "../../ui/motion";
import { cn } from "../../../lib/utils";

/* Resolve conflict — two sources disagree; the person decides.
   Figma › ✓ Resolve conflict · Timeline (desktop) / Resolve conflict — Mobile 390. */
export default function Resolve() {
  const { cid } = useParams();
  const { projectId, canEdit } = useWorkspace();
  const navigate = useNavigate();
  const base = `/w/${projectId}`;
  const { data, error } = useResource(() => v2.conflict(projectId, cid), [projectId, cid]);
  const [choice, setChoice] = useState(null);
  const [dates, setDates] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data && !choice) {
      setChoice(data.options[0].id);
      setDates(Object.fromEntries(data.options.filter((o) => o.date).map((o) => [o.id, o.date.slice(0, 10)])));
    }
  }, [data, choice]);

  const back = () => (window.history.length > 1 ? navigate(-1) : navigate(base));
  const opt = data?.options.find((o) => o.id === choice);

  const submit = async () => {
    setBusy(true);
    try {
      const date = dates[choice] ? new Date(`${dates[choice]}T09:00:00`).toISOString() : undefined;
      const res = await v2.resolveConflict(projectId, cid, choice, date);
      refreshAll();
      toast.success(choice === "ask" ? "Reply drafted — the conflict stays open" : "Memory updated", { description: choice === "ask" ? undefined : opt.effect });
      navigate(`${base}/conversations/${res.draft_thread || "t1"}?draft=resolve-${choice}${date ? `&date=${dates[choice]}` : ""}`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn’t resolve this conflict");
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="text-body-l text-fg">This conflict was already resolved</p>
        <Button onClick={() => navigate(base)}>Back to Overview</Button>
      </div>
    );
  }

  return (
    <div className="scroll-pane h-full">
      <header className="flex items-start gap-3 border-b border-line-subtle px-4 py-5 md:px-6">
        <IconButton icon={ArrowLeft} label="Back" onClick={back} className="mt-5 border border-line" />
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 font-mono text-[12px] text-danger"><GitFork size={14} /> Conflicting information</p>
          {data ? <h1 className="mt-1 text-title-l text-fg">{data.title}</h1> : <Skeleton className="mt-2 h-6 w-96" />}
        </div>
      </header>
      {data && (
        <div className="grid gap-8 px-4 py-6 md:px-6 lg:grid-cols-2">
          <section>
            <p className="eyebrow mb-3">What disagrees</p>
            <Stagger className="space-y-3">
              {data.sides.map((s, i) => (
                <StaggerItem key={i} className="rounded-lg border border-line bg-surface p-4">
                  <p className="flex items-center gap-2 text-body-s font-medium text-fg">
                    {s.provider === "notes" ? <FileText size={14} className="text-fg-secondary" /> : <SourceMark provider={s.provider} size={14} />} {s.label}
                  </p>
                  <p className="mt-2 text-body-m text-fg-secondary">{s.quote}</p>
                  <p className="mt-2 text-body-s text-fg-tertiary">{s.meta}</p>
                </StaggerItem>
              ))}
              <StaggerItem className="flex gap-3 rounded-lg border border-line px-4 py-3 text-body-s text-fg-secondary">
                <Info size={14} className="mt-0.5 shrink-0 text-fg-tertiary" /> {data.note}
              </StaggerItem>
            </Stagger>
          </section>
          <section>
            <p className="eyebrow mb-3">How do you want to resolve it?</p>
            <div role="radiogroup" aria-label="Resolution" className="space-y-3">
              {data.options.map((o) => {
                const on = choice === o.id;
                return (
                  <motion.div layout transition={T.base} key={o.id}
                    className={cn("rounded-lg border bg-surface transition-colors duration-fast", on ? "border-line-control bg-raised" : "border-line hover:border-line-strong")}>
                    <button role="radio" aria-checked={on} onClick={() => setChoice(o.id)} className="flex w-full items-start gap-3 px-4 py-3 text-left">
                      <span className={cn("mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors duration-fast", on ? "border-fg bg-fg" : "border-line-control")}>
                        <AnimatePresence>{on && <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={T.fast} className="h-1.5 w-1.5 rounded-full bg-app" />}</AnimatePresence>
                      </span>
                      <span>
                        <span className="block text-body-m font-medium text-fg">{o.title}</span>
                        <span className="block text-body-s text-fg-tertiary">{o.detail}</span>
                      </span>
                    </button>
                    <AnimatePresence initial={false}>
                      {on && o.date_label && (
                        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={T.base} className="overflow-hidden">
                          <label className="block px-4 pb-4 pl-11">
                            <span className="mb-1.5 block text-body-s text-fg-secondary">{o.date_label}</span>
                            <Input type="date" value={dates[o.id] || ""} onChange={(e) => setDates((d) => ({ ...d, [o.id]: e.target.value }))} />
                            {dates[o.id] && <span className="mt-1 block text-body-s text-fg-tertiary">{format(new Date(`${dates[o.id]}T09:00:00`), "EEE, MMM d")}</span>}
                          </label>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })}
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <Button variant="ghost" onClick={back}>Cancel</Button>
              <Button variant="primary" icon={Check} loading={busy} disabled={!canEdit} onClick={submit}>{opt?.cta || "Update memory"}</Button>
            </div>
            <AnimatePresence mode="wait">
              <motion.p key={choice} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={T.fast} className="mt-3 text-body-s text-fg-tertiary">{opt?.effect}</motion.p>
            </AnimatePresence>
          </section>
        </div>
      )}
    </div>
  );
}
