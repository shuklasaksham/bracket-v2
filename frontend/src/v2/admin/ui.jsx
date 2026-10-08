import React from "react";
import { cn } from "../../lib/utils";
import { SourceMark, Skeleton } from "../ui/primitives";
import { motion, EASE, Stagger, StaggerItem } from "../ui/motion";

/* Admin building blocks — Figma › 13 Admin panel components:
   KPI card (204:105), panels, horizontal bars and column charts. */

export const fmtNum = (n) => (n == null ? "—" : Number(n).toLocaleString("en-US"));
export const fmtMoney = (n, cur = "usd", digits) => {
  if (n == null) return "—";
  const d = digits ?? (Math.abs(n) >= 1000 || Number.isInteger(n) ? 0 : 2);
  return cur === "inr"
    ? `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d })}`
    : `$${Number(n).toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d })}`;
};
export const signed = (n, f = fmtNum) => (n == null ? "—" : `${n > 0 ? "+" : n < 0 ? "−" : ""}${f(Math.abs(n))}`);
export const ago = (iso) => {
  if (!iso) return "—";
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86400) return `${Math.round(s / 3600)} h`;
  if (s < 172800) return "Yesterday";
  if (s < 7 * 86400) return `${Math.round(s / 86400)} d`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
};
export const shortDate = (iso) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—");

/* KPI card — delta is green when the change is good for the business. */
export function Kpi({ label, value, unit, delta, good = true, compare, loading }) {
  return (
    <StaggerItem className="min-w-0 rounded-lg border border-line-subtle bg-surface p-4">
      <p className="truncate text-body-s text-fg-tertiary">{label}</p>
      {loading ? <Skeleton className="mt-2 h-8 w-24" /> : (
        <p className="mt-1.5 flex items-baseline gap-2">
          <span className="num truncate text-display-s text-fg">{value}</span>
          {unit && <span className="truncate text-body-s text-fg-tertiary">{unit}</span>}
        </p>
      )}
      <p className="mt-1.5 flex min-w-0 items-center gap-1.5 text-body-s">
        {delta != null && <span className={cn("shrink-0 font-medium", good ? "text-success" : "text-danger")}>{delta}</span>}
        {compare && <span className="truncate text-fg-tertiary">{compare}</span>}
      </p>
    </StaggerItem>
  );
}
export function KpiRow({ children, className }) {
  return <Stagger className={cn("grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4", className)}>{children}</Stagger>;
}

export function Panel({ title, meta, children, className, bodyClassName }) {
  return (
    <section className={cn("min-w-0 rounded-lg border border-line-subtle bg-surface p-4", className)}>
      <div className="flex items-center gap-2">
        <h2 className="flex-1 truncate text-title-s text-fg">{title}</h2>
        {meta && <div className="shrink-0 text-body-s text-fg-tertiary">{meta}</div>}
      </div>
      <div className={cn("mt-3.5", bodyClassName)}>{children}</div>
    </section>
  );
}

/* Horizontal bar with label + value; width animates in. */
export function HBar({ label, value, pct, provider, strong }) {
  return (
    <div>
      <div className="flex items-center gap-2 text-body-s">
        {provider && <SourceMark provider={provider} size={14} />}
        <span className="min-w-0 flex-1 truncate text-fg-secondary">{label}</span>
        <span className="shrink-0 font-mono text-[12px] text-fg">{value}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-raised">
        <motion.div className={cn("h-full rounded-full", strong ? "bg-fg" : "bg-fg-secondary")} initial={{ width: 0 }} animate={{ width: `${Math.max(1, Math.min(100, pct))}%` }} transition={{ duration: 0.6, ease: EASE }} />
      </div>
    </div>
  );
}
export function HBars({ items, strong }) {
  return <div className="space-y-3.5">{items.map(({ key, ...i }) => <HBar key={key || i.label} strong={strong} {...i} />)}</div>;
}

/* Column chart. `series` = [{ label, values: [n, …] }] stacks bottom-up. */
export function Columns({ data, height = 150, highlightLast, labels, colors = ["bg-white/35", "bg-info"], format }) {
  const totals = data.map((d) => d.values.reduce((a, b) => a + b, 0));
  const max = Math.max(1, ...totals);
  return (
    <div>
      <div className="flex items-end gap-[3px] md:gap-1" style={{ height }} role="img" aria-label={labels?.aria}>
        {data.map((d, i) => (
          <div key={d.label + i} className="group relative flex h-full min-w-0 flex-1 flex-col justify-end" title={`${d.label}: ${format ? format(totals[i]) : totals[i]}`}>
            <motion.div className="flex w-full flex-col-reverse overflow-hidden rounded-t-[2px]" initial={{ height: 0 }} animate={{ height: `${(totals[i] / max) * 100}%` }} transition={{ duration: 0.6, ease: EASE, delay: i * 0.012 }}>
              {d.values.map((v, k) => (
                <div key={k} className={cn(highlightLast && i === data.length - 1 && k === 0 ? "bg-fg" : colors[k], "transition-opacity group-hover:opacity-80")} style={{ height: totals[i] ? `${(v / totals[i]) * 100}%` : 0 }} />
              ))}
            </motion.div>
          </div>
        ))}
      </div>
      {labels?.show && (
        <div className="mt-2 flex gap-[3px] md:gap-1">
          {data.map((d, i) => <span key={i} className="min-w-0 flex-1 truncate text-center font-mono text-[11px] text-fg-tertiary">{d.label}</span>)}
        </div>
      )}
    </div>
  );
}

export function Table({ columns, rows, empty = "Nothing here.", onRow }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4">
      <table className="w-full min-w-[560px] text-left">
        <thead>
          <tr>{columns.map((c) => <th key={c.key} className={cn("eyebrow pb-2 pr-3 font-semibold", c.className)}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={columns.length} className="border-t border-line-subtle py-6 text-center text-body-s text-fg-tertiary">{empty}</td></tr>}
          {rows.map((r, i) => (
            <tr key={r.id || i} onClick={onRow ? () => onRow(r) : undefined} className={cn("border-t border-line-subtle", onRow && "cursor-pointer transition-colors hover:bg-hover")}>
              {columns.map((c) => <td key={c.key} className={cn("py-2.5 pr-3 text-body-m text-fg", c.className)}>{c.render ? c.render(r) : r[c.key]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PanelSkeleton({ h = 180 }) {
  return <div style={{ height: h }}><Skeleton className="h-full w-full rounded-lg" /></div>;
}
