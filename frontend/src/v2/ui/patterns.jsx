import React, { forwardRef } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ChevronRight, MoreHorizontal, FileText } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "../../lib/utils";
import { SourceMark } from "./primitives";
import { shortTime } from "../lib/data";

/* Product patterns, measured from Figma › 02 Components + core screens.
   Section header: title 14/SemiBold + mono count 12; action 12/Medium + arrow.
   List box: 1px white/9% border, radius 8, no fill; rows divided by white/6%.
   Row: padding 12/16, gap 12. Evidence chip: 22px, #15161a, white/6% border. */

export function SectionTitle({ title, count, action, to, onClick, actionIcon = true, className, id }) {
  const Act = to ? Link : "button";
  return (
    <div className={cn("mb-3 flex min-h-[20px] items-center gap-2", className)}>
      <h2 id={id} className="text-title-s text-fg">{title}</h2>
      {count != null && <span className="font-mono text-[12px] leading-4 text-fg-tertiary">{count}</span>}
      <span className="flex-1" />
      {action && (to || onClick) ? (
        <Act to={to} onClick={onClick} className="group flex items-center gap-1 text-[12px] font-medium leading-[18px] text-fg-secondary transition-colors duration-fast hover:text-fg">
          {action}{actionIcon && <ArrowRight size={16} className="transition-transform duration-fast group-hover:translate-x-0.5" />}
        </Act>
      ) : action ? <span className="text-[12px] leading-[18px] text-fg-tertiary">{action}</span> : null}
    </div>
  );
}

export const ListBox = forwardRef(function ListBox({ as: Tag = "ul", className, children, ...rest }, ref) {
  return (
    <Tag ref={ref} className={cn("overflow-hidden rounded-lg border border-line divide-y divide-line-subtle", className)} {...rest}>
      {children}
    </Tag>
  );
});

/* Row — list row (Figma: List row). Renders a Link when `to`, a button when
   `onClick`, else a div. `prefix` (mono date), `title`, `meta`, `trailing`. */
export function Row({ to, onClick, prefix, title, meta, trailing, chevron = true, className, selected, children, ...rest }) {
  const Tag = to ? Link : onClick ? "button" : "div";
  return (
    <Tag
      to={to}
      onClick={onClick}
      className={cn(
        "group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-fast",
        (to || onClick) && "hover:bg-hover",
        selected && "bg-selected",
        className,
      )}
      {...rest}
    >
      {prefix != null && <span className="w-[72px] shrink-0 font-mono text-[12px] leading-4 text-fg-secondary">{prefix}</span>}
      {children || (
        <span className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className="truncate text-body-m font-medium text-fg">{title}</span>
          {meta != null && <span className="truncate text-body-s text-fg-tertiary">{meta}</span>}
        </span>
      )}
      {trailing}
      {chevron && (to || onClick) && <ChevronRight size={16} className="shrink-0 text-fg-tertiary transition-transform duration-fast group-hover:translate-x-0.5" />}
    </Tag>
  );
}

/* Evidence chip — provider mark + "Sarah Chen · 09:41". */
export function Chip({ provider, label, at, onClick, to, className }) {
  const Tag = to ? Link : onClick ? "button" : "span";
  return (
    <Tag
      to={to}
      onClick={onClick}
      className={cn(
        "inline-flex h-[22px] max-w-full items-center gap-2 rounded-[4px] border border-line-subtle bg-raised px-2 text-[12px] font-medium leading-4 text-fg-secondary",
        (to || onClick) && "transition-colors duration-fast hover:border-line-strong hover:text-fg",
        className,
      )}
    >
      {provider === "notes" || provider === "file" ? <FileText size={12} className="shrink-0" /> : provider ? <SourceMark provider={provider} size={12} /> : null}
      <span className="truncate">{label}{at ? ` · ${typeof at === "string" && /^\d{4}-\d{2}-\d{2}T/.test(at) ? shortTime(at) : at}` : ""}</span>
    </Tag>
  );
}

export const MoreButton = forwardRef(function MoreButton({ label = "More actions", className, ...rest }, ref) {
  return (
    <button
      ref={ref}
      aria-label={label}
      className={cn(
        "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/[0.04] text-fg-secondary transition-[background-color,color,transform] duration-fast hover:bg-white/[0.08] hover:text-fg active:scale-[0.94] disabled:pointer-events-none disabled:opacity-40",
        className,
      )}
      {...rest}
    >
      <MoreHorizontal size={16} />
    </button>
  );
});

/* Page header used on Memory/Conversations/Timeline/Sources/Files. */
export function PageHeader({ title, count, description, actions, className }) {
  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between", className)}>
      <div className="min-w-0">
        <h1 className="text-title-l text-fg">
          {title}{count != null && <span className="ml-2 font-mono text-[12px] font-normal text-fg-tertiary align-middle">{count}</span>}
        </h1>
        {description && <p className="mt-1 max-w-[720px] text-body-s text-fg-tertiary">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/* Panel header — "COMMITMENT  ✎ ⋯ ✕" for docked detail panels. */
export function PanelHeader({ eyebrow, children }) {
  return (
    <div className="flex h-14 shrink-0 items-center justify-between gap-2 px-5">
      <p className="eyebrow">{eyebrow}</p>
      <div className="flex items-center gap-1">{children}</div>
    </div>
  );
}

/* Tabs — underline-less pill tabs (Current / Changed / Superseded). */
export function Tabs({ value, onChange, options, className, layoutId = "tabs" }) {
  return (
    <div role="tablist" className={cn("inline-flex items-center gap-1 rounded-md border border-line p-0.5", className)}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={o.value} role="tab" aria-selected={on} onClick={() => onChange(o.value)}
            className={cn("relative h-7 rounded-[5px] px-3 text-[12px] font-medium transition-colors duration-fast", on ? "text-fg" : "text-fg-secondary hover:text-fg")}>
            {on && <TabsPill layoutId={layoutId} />}
            <span className="relative">{o.label}{o.count != null && <span className="ml-1.5 font-mono text-fg-tertiary">{o.count}</span>}</span>
          </button>
        );
      })}
    </div>
  );
}
function TabsPill({ layoutId }) {
  return <motion.span layoutId={layoutId} className="absolute inset-0 rounded-[5px] bg-selected" transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }} />;
}
