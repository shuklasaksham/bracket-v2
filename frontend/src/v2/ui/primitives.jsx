import React, { forwardRef } from "react";
import { Loader2, AlertTriangle, CheckCircle2, Info, XCircle, X, Check } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "../../lib/utils";
import { BRAND_PATHS } from "../../lib/brandIcons";
import { PROVIDER_META } from "../../lib/providersMeta";

/* ───────────────────────── Button ─────────────────────────
   Figma: Button · Variant (Primary/Secondary/Ghost/Danger) · Size (M/S) */
const BTN_VARIANT = {
  primary: "bg-inverse text-fg-inverse hover:bg-inverse-hover",
  secondary: "bg-raised text-fg border border-line hover:bg-white/[0.04]",
  ghost: "text-fg hover:bg-white/[0.04]",
  danger: "bg-danger-bg text-danger border border-danger hover:bg-danger/[0.16]",
  link: "text-fg-secondary hover:text-fg underline-offset-4 hover:underline px-0",
};
const BTN_SIZE = {
  s: "h-7 px-2 text-[12px] leading-[18px] gap-1.5 rounded-md",
  m: "h-8 px-3 text-[12px] leading-[18px] gap-2 rounded-md",
  l: "h-11 px-4 text-body-m gap-2 rounded-lg", // touch targets (mobile)
};
export const Button = forwardRef(function Button(
  { variant = "secondary", size = "m", icon: Icon, iconRight: IconRight, loading, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center font-medium whitespace-nowrap select-none",
        "transition-[color,background-color,border-color,transform] duration-fast ease-out active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none",
        BTN_VARIANT[variant],
        BTN_SIZE[size],
        className,
      )}
      disabled={loading || rest.disabled}
      {...rest}
    >
      {loading ? <Loader2 size={14} className="animate-spin" /> : Icon ? <Icon size={size === "s" ? 13 : 15} strokeWidth={1.75} /> : null}
      {children}
      {IconRight ? <IconRight size={size === "s" ? 13 : 15} strokeWidth={1.75} /> : null}
    </button>
  );
});

/* Icon button — M 28px (pointer) / L 44px (touch). Always needs aria-label. */
export const IconButton = forwardRef(function IconButton(
  { icon: Icon, label, size = "m", active, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      aria-label={label}
      title={label}
      className={cn(
        "relative inline-flex items-center justify-center rounded-md text-fg-secondary",
        "transition-[color,background-color,transform] duration-fast ease-out hover:text-fg hover:bg-hover active:scale-[0.94] disabled:opacity-40 disabled:pointer-events-none",
        size === "l" ? "h-11 w-11" : size === "s" ? "h-6 w-6" : "h-7 w-7",
        active && "bg-selected text-fg",
        className,
      )}
      {...rest}
    >
      {Icon && <Icon size={size === "l" ? 20 : 16} strokeWidth={1.75} />}
      {children}
    </button>
  );
});

/* ───────────────────────── Badge ─────────────────────────
   Semantic status only. Tone: neutral / warning / danger / success / info */
const BADGE_TONE = {
  neutral: "bg-white/[0.06] text-fg-secondary",
  warning: "bg-warning-bg text-warning",
  danger: "bg-danger-bg text-danger",
  success: "bg-success-bg text-success",
  info: "bg-info-bg text-info",
};
export function Badge({ tone = "neutral", dot, className, children }) {
  return (
    <span className={cn("inline-flex items-center gap-1 h-5 px-2 rounded-[4px] text-[12px] font-medium leading-4 whitespace-nowrap", BADGE_TONE[tone], className)}>
      {dot && <span className="h-[6px] w-[6px] rounded-full bg-current" aria-hidden="true" />}
      {children}
    </span>
  );
}

/* ───────────────────────── Avatar ───────────────────────── */
export function initialsOf(name = "", email = "") {
  const src = (name || email || "?").trim();
  const parts = src.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] || "?") + (parts[1]?.[0] || "")).toUpperCase();
}
export function Avatar({ name, email, src, size = "m", className }) {
  const px = size === "s" ? 24 : size === "l" ? 40 : 28;
  return (
    <span
      className={cn("inline-flex items-center justify-center rounded-full bg-white/[0.06] border border-line text-fg font-semibold shrink-0 overflow-hidden", className)}
      style={{ width: px, height: px, fontSize: size === "l" ? 14 : 12 }}
      aria-hidden="true"
    >
      {src ? <img src={src} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" /> : initialsOf(name, email)}
    </span>
  );
}

/* ───────────────────────── Kbd ───────────────────────── */
export function Kbd({ children, className }) {
  return (
    <kbd className={cn("inline-flex items-center justify-center min-w-[20px] h-5 px-1 rounded-[4px] border border-line bg-raised font-mono text-[12px] leading-4 text-fg-tertiary", className)}>
      {children}
    </kbd>
  );
}

/* ───────────────────────── Source mark ───────────────────────── */
export function SourceMark({ provider, size = 16, className }) {
  const meta = PROVIDER_META[provider] || PROVIDER_META.bracket;
  const path = meta.slug ? BRAND_PATHS[meta.slug] : null;
  const Icon = meta.icon;
  return (
    <span className={cn("inline-flex items-center justify-center shrink-0", className)} style={{ width: size, height: size }} aria-hidden="true">
      {path ? (
        <svg width={size} height={size} viewBox="0 0 24 24" fill={meta.brandColor || meta.color}>
          <path d={path} />
        </svg>
      ) : (
        <Icon size={size} strokeWidth={1.75} className="text-fg-secondary" />
      )}
    </span>
  );
}
export const providerLabel = (p) => (PROVIDER_META[p] || {}).label || (p ? p[0].toUpperCase() + p.slice(1) : "Source");

/* ───────────────────────── Evidence chip ───────────────────────── */
export function EvidenceChip({ provider, children, onClick, className }) {
  const Tag = onClick ? "button" : "span";
  return (
    <Tag
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 h-6 px-2 rounded-md border border-line bg-hover text-body-s text-fg-secondary max-w-full",
        onClick && "hover:border-line-strong hover:text-fg transition-colors duration-fast",
        className,
      )}
    >
      {provider && <SourceMark provider={provider} size={12} />}
      <span className="truncate">{children}</span>
    </Tag>
  );
}

/* ───────────────────────── Confidence ───────────────────────── */
export function Confidence({ level = "medium", showLabel = true }) {
  const lv = (level || "medium").toLowerCase();
  const bars = lv === "high" ? 3 : lv === "low" ? 1 : 2;
  const color = lv === "low" ? "text-warning" : "text-fg-tertiary";
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-body-s", color)}>
      <span className="inline-flex items-end gap-[2px]" aria-hidden="true">
        {[1, 2, 3].map((i) => (
          <span key={i} className={cn("w-[3px] rounded-[1px]", i <= bars ? "bg-current" : "bg-white/15")} style={{ height: 4 + i * 3 }} />
        ))}
      </span>
      {showLabel && <span>{lv[0].toUpperCase() + lv.slice(1)} confidence</span>}
    </span>
  );
}

/* ───────────────────────── Sync status ───────────────────────── */
export function SyncStatus({ state = "synced", label }) {
  const map = {
    synced: { dot: "bg-success", text: "text-fg-tertiary" },
    syncing: { dot: "bg-info animate-pulse", text: "text-fg-tertiary" },
    error: { dot: "bg-danger", text: "text-danger" },
    paused: { dot: "bg-fg-tertiary", text: "text-fg-tertiary" },
    warning: { dot: "bg-warning", text: "text-warning" },
  };
  const m = map[state] || map.synced;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-body-s", m.text)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", m.dot)} aria-hidden="true" />
      {label}
    </span>
  );
}

/* ───────────────────────── Banner ─────────────────────────
   Persistent page-level status. Tone: info / warning / danger / success / neutral */
const BANNER = {
  info: { cls: "bg-info-bg/60 border-info/25", icon: Info, ic: "text-info" },
  warning: { cls: "bg-warning-bg/60 border-warning/25", icon: AlertTriangle, ic: "text-warning" },
  danger: { cls: "bg-danger-bg/60 border-danger/25", icon: XCircle, ic: "text-danger" },
  success: { cls: "bg-success-bg/60 border-success/25", icon: CheckCircle2, ic: "text-success" },
  neutral: { cls: "bg-surface border-line", icon: Info, ic: "text-fg-tertiary" },
};
export function Banner({ tone = "info", title, children, action, onDismiss, className }) {
  const b = BANNER[tone] || BANNER.info;
  const Icon = b.icon;
  return (
    <div role={tone === "danger" || tone === "warning" ? "alert" : "status"} className={cn("flex items-start gap-3 rounded-lg border px-4 py-3", b.cls, className)}>
      <Icon size={16} className={cn("mt-0.5 shrink-0", b.ic)} strokeWidth={1.75} />
      <div className="flex-1 min-w-0">
        {title && <p className="text-title-s text-fg">{title}</p>}
        {children && <div className="text-body-s text-fg-secondary mt-0.5">{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
      {onDismiss && <IconButton icon={X} label="Dismiss" size="s" onClick={onDismiss} />}
    </div>
  );
}

/* ───────────────────────── Empty state ───────────────────────── */
export function EmptyState({ icon: Icon, title, children, action, className }) {
  return (
    <div className={cn("flex flex-col items-center text-center px-6 py-12", className)}>
      {Icon && (
        <span className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-full bg-raised border border-line">
          <Icon size={18} className="text-fg-secondary" strokeWidth={1.75} />
        </span>
      )}
      <p className="text-title-m text-fg">{title}</p>
      {children && <div className="mt-1.5 max-w-sm text-body-s text-fg-tertiary">{children}</div>}
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

/* ───────────────────────── Section header ───────────────────────── */
export function SectionHeader({ title, count, action, className }) {
  return (
    <div className={cn("flex items-center justify-between gap-3 mb-3", className)}>
      <h2 className="text-title-s text-fg flex items-center gap-2">
        {title}
        {count !== undefined && count !== null && <span className="text-body-s text-fg-tertiary num">{count}</span>}
      </h2>
      {action}
    </div>
  );
}

/* ───────────────────────── Card ───────────────────────── */
export function Card({ className, children, ...rest }) {
  return (
    <div className={cn("rounded-lg border border-line bg-surface", className)} {...rest}>
      {children}
    </div>
  );
}

/* ───────────────────────── Skeleton ───────────────────────── */
export function Skeleton({ className }) {
  return <div className={cn("skeleton", className)} aria-hidden="true" />;
}
export function SkeletonRows({ rows = 4, className }) {
  return (
    <div className={cn("space-y-2", className)} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-11 w-full" />
      ))}
    </div>
  );
}

/* ───────────────────────── Spinner ───────────────────────── */
export function Spinner({ size = 16, className }) {
  return <Loader2 size={size} className={cn("animate-spin text-fg-tertiary", className)} aria-label="Loading" />;
}

/* ───────────────────────── Form controls ───────────────────────── */
export const Input = forwardRef(function Input({ className, invalid, ...rest }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        "h-9 w-full rounded-md border bg-surface px-3 text-body-m text-fg placeholder:text-fg-disabled",
        "border-line-control/60 hover:border-line-control focus:border-fg-secondary focus:outline-none",
        "transition-colors duration-fast disabled:opacity-50",
        invalid && "border-danger focus:border-danger",
        className,
      )}
      {...rest}
    />
  );
});
export const Textarea = forwardRef(function Textarea({ className, invalid, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(
        "w-full rounded-md border bg-surface px-3 py-2 text-body-m text-fg placeholder:text-fg-disabled resize-y",
        "border-line-control/60 hover:border-line-control focus:border-fg-secondary focus:outline-none transition-colors duration-fast",
        invalid && "border-danger",
        className,
      )}
      {...rest}
    />
  );
});
export function Field({ label, htmlFor, helper, error, children, className }) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <label htmlFor={htmlFor} className="text-body-s font-medium text-fg-secondary">
          {label}
        </label>
      )}
      {children}
      {error ? (
        <p className="text-body-s text-danger" role="alert">{error}</p>
      ) : helper ? (
        <p className="text-body-s text-fg-tertiary">{helper}</p>
      ) : null}
    </div>
  );
}
export function NativeSelect({ className, children, ...rest }) {
  return (
    <select
      className={cn(
        "h-9 rounded-md border border-line-control/60 bg-surface px-2.5 text-body-m text-fg hover:border-line-control focus:outline-none focus:border-fg-secondary",
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  );
}

/* Checkbox — real <input> (keyboard + screen readers) with a drawn 16px box.
   Control border meets 3:1 contrast (border/control). */
export function Checkbox({ checked, indeterminate, onChange, label, className, ...rest }) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate;
  }, [indeterminate]);
  const on = !!checked || !!indeterminate;
  return (
    <span className={cn("relative inline-flex h-4 w-4 shrink-0", className)}>
      <input
        ref={ref}
        type="checkbox"
        checked={!!checked}
        onChange={(e) => onChange?.(e.target.checked)}
        aria-label={label}
        className="peer absolute inset-0 m-0 h-full w-full cursor-pointer opacity-0"
        {...rest}
      />
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none flex h-4 w-4 items-center justify-center rounded-[4px] border transition-colors duration-fast",
          "peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-fg",
          on ? "border-inverse bg-inverse text-fg-inverse" : "border-line-control bg-transparent",
        )}
      >
        {indeterminate ? <span className="h-0.5 w-2 rounded bg-current" /> : checked ? <Check size={12} strokeWidth={3} /> : null}
      </span>
    </span>
  );
}

/* Toggle (switch) */
export function Toggle({ checked, onChange, label, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!!checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className={cn(
        "relative inline-flex h-[18px] w-8 shrink-0 items-center rounded-full border transition-colors duration-fast",
        checked ? "bg-inverse border-inverse" : "bg-white/[0.06] border-line-control",
        disabled && "opacity-40",
      )}
    >
      <span
        className={cn(
          "inline-block h-3 w-3 rounded-full transition-transform duration-fast ease-out",
          checked ? "translate-x-[16px] bg-app" : "translate-x-[2px] bg-fg-tertiary",
        )}
      />
    </button>
  );
}

/* Segmented control */
/* Figma › Segmented control: 40px, radius 8, padding 4, #101113 + white/9%
   border; the selected segment slides (shared layout animation). */
let _segId = 0;
export function Segmented({ value, onChange, options, className, size = "m" }) {
  const [id] = React.useState(() => `seg-${++_segId}`);
  const stretch = /w-full/.test(className || "");
  return (
    <div role="tablist" className={cn("inline-flex rounded-lg border border-line bg-surface p-1", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "relative rounded-md px-3 text-[12px] font-medium transition-colors duration-fast",
              size === "s" ? "h-6" : "h-8",
              stretch && "flex-1",
              active ? "text-fg" : "text-fg-secondary hover:text-fg",
            )}
          >
            {active && <motion.span layoutId={id} className="absolute inset-0 rounded-md bg-selected" transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }} />}
            <span className="relative">{o.label}{o.count !== undefined && <span className="ml-1.5 font-mono text-fg-tertiary">{o.count}</span>}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ───────────────────────── List row ─────────────────────────
   Generic 40px+ row for lists (coming up, files, people, settings). */
export function ListRow({ as: Tag = "div", leading, title, meta, prefix, trailing, selected, onClick, className, ...rest }) {
  const interactive = !!onClick || Tag === "a" || Tag === "button";
  return (
    <Tag
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 px-4 py-2.5 text-left min-h-[44px]",
        "border-b border-line-subtle last:border-b-0",
        interactive && "cursor-pointer hover:bg-hover transition-colors duration-fast",
        selected && "bg-selected",
        className,
      )}
      {...rest}
    >
      {prefix && <span className="w-20 shrink-0 font-mono text-mono-s text-fg-tertiary">{prefix}</span>}
      {leading}
      <span className="flex-1 min-w-0">
        <span className="block truncate text-body-m text-fg">{title}</span>
        {meta && <span className="block truncate text-body-s text-fg-tertiary">{meta}</span>}
      </span>
      {trailing}
    </Tag>
  );
}

/* Google "G" — used on every Continue with Google button. */
export function GoogleG({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96h-3.98v3.09C3.26 21.3 7.31 24 12 24z" />
      <path fill="#FBBC05" d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z" />
      <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z" />
    </svg>
  );
}
