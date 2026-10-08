import React from "react";
import * as RDialog from "@radix-ui/react-dialog";
import * as RMenu from "@radix-ui/react-dropdown-menu";
import * as RTooltip from "@radix-ui/react-tooltip";
import * as RPopover from "@radix-ui/react-popover";
import { Drawer } from "vaul";
import { X, Check } from "lucide-react";
import { cn } from "../../lib/utils";
import { IconButton } from "./primitives";
import { useIsMobile } from "../lib/useMedia";

/* ───────────────────────── Dialog ─────────────────────────
   Figma: Dialog (desktop) → bottom Sheet on mobile (< 768px).
   Traps focus, Esc + scrim close, returns focus to the trigger. */
export function Dialog({ open, onOpenChange, title, description, children, footer, size = "m", hideClose }) {
  const mobile = useIsMobile();
  if (mobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange} title={title} description={description} footer={footer}>
        {children}
      </Sheet>
    );
  }
  const width = size === "s" ? "max-w-[420px]" : size === "l" ? "max-w-[720px]" : "max-w-[520px]";
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-50 bg-overlay data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out" />
        <RDialog.Content
          className={cn(
            "bk fixed left-1/2 top-1/2 z-50 w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2",
            "max-h-[calc(100vh-64px)] flex flex-col rounded-xl border border-line-strong bg-raised shadow-overlay",
            "data-[state=open]:animate-scale-in data-[state=closed]:animate-scale-out focus:outline-none",
            width,
          )}
        >
          <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-1">
            <div className="min-w-0">
              <RDialog.Title className="text-title-m text-fg">{title}</RDialog.Title>
              {description ? (
                <RDialog.Description className="mt-1 text-body-s text-fg-tertiary">{description}</RDialog.Description>
              ) : (
                <RDialog.Description className="sr-only">{title}</RDialog.Description>
              )}
            </div>
            {!hideClose && (
              <RDialog.Close asChild>
                <IconButton icon={X} label="Close" />
              </RDialog.Close>
            )}
          </div>
          <div className="scroll-pane px-5 py-4 flex-1 min-h-0">{children}</div>
          {footer && <div className="flex items-center justify-end gap-2 border-t border-line-subtle px-5 py-3">{footer}</div>}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

/* ───────────────────────── Sheet (mobile bottom sheet) ───────────────────────── */
export function Sheet({ open, onOpenChange, title, description, children, footer, hideTitle }) {
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} shouldScaleBackground={false}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-50 bg-overlay" />
        <Drawer.Content className="bk fixed inset-x-0 bottom-0 z-50 flex max-h-[92vh] flex-col rounded-t-xl border-t border-line-strong bg-raised focus:outline-none">
          <div className="mx-auto mt-2 mb-1 h-1 w-9 rounded-full bg-white/20" aria-hidden="true" />
          <div className="px-4 pt-2 pb-1">
            <Drawer.Title className={hideTitle ? "sr-only" : "text-title-m text-fg"}>{title}</Drawer.Title>
            {description ? (
              <Drawer.Description className="mt-1 text-body-s text-fg-tertiary">{description}</Drawer.Description>
            ) : (
              <Drawer.Description className="sr-only">{title}</Drawer.Description>
            )}
          </div>
          <div className="scroll-pane px-4 py-3 flex-1 min-h-0">{children}</div>
          {footer && <div className="flex flex-col-reverse gap-2 px-4 pt-2 safe-bottom [&>*]:w-full [&>button]:h-11">{footer}</div>}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

/* ───────────────────────── Side panel (desktop detail panel) ───────────────────────── */
export function SidePanel({ open, onOpenChange, title, children, footer, width = 440 }) {
  const mobile = useIsMobile();
  if (mobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange} title={title} footer={footer}>
        {children}
      </Sheet>
    );
  }
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-40 bg-overlay/40 data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out" />
        <RDialog.Content
          className="bk fixed right-0 top-0 bottom-0 z-40 flex flex-col border-l border-line bg-surface shadow-overlay data-[state=open]:animate-slide-in-right data-[state=closed]:animate-slide-out-right focus:outline-none"
          style={{ width: `min(${width}px, 100vw)` }}
        >
          <div className="flex h-14 items-center justify-between gap-3 border-b border-line-subtle px-5">
            <RDialog.Title className="eyebrow">{title}</RDialog.Title>
            <RDialog.Description className="sr-only">{title}</RDialog.Description>
            <RDialog.Close asChild>
              <IconButton icon={X} label="Close panel" />
            </RDialog.Close>
          </div>
          <div className="scroll-pane flex-1 min-h-0 px-5 py-5">{children}</div>
          {footer && <div className="flex items-center gap-2 border-t border-line-subtle px-5 py-3">{footer}</div>}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

/* ───────────────────────── Dropdown menu ───────────────────────── */
export const Menu = RMenu.Root;
export const MenuTrigger = RMenu.Trigger;
export function MenuContent({ children, align = "end", className, ...rest }) {
  return (
    <RMenu.Portal>
      <RMenu.Content
        align={align}
        sideOffset={6}
        className={cn("bk z-50 min-w-[200px] rounded-lg border border-line-strong bg-raised p-1 shadow-popover origin-[var(--radix-popper-transform-origin)] data-[state=open]:animate-pop-in data-[state=closed]:animate-scale-out", className)}
        {...rest}
      >
        {children}
      </RMenu.Content>
    </RMenu.Portal>
  );
}
export function MenuItem({ icon: Icon, children, danger, shortcut, checked, className, ...rest }) {
  return (
    <RMenu.Item
      className={cn(
        "flex h-8 cursor-pointer select-none items-center gap-2 rounded-md px-2 text-body-m outline-none",
        danger ? "text-danger data-[highlighted]:bg-danger-bg" : "text-fg-secondary data-[highlighted]:bg-hover data-[highlighted]:text-fg",
        "data-[disabled]:opacity-40 data-[disabled]:pointer-events-none",
        className,
      )}
      {...rest}
    >
      {Icon && <Icon size={14} strokeWidth={1.75} />}
      <span className="flex-1 truncate">{children}</span>
      {checked && <Check size={14} />}
      {shortcut && <span className="font-mono text-[11px] text-fg-tertiary">{shortcut}</span>}
    </RMenu.Item>
  );
}
export function MenuLabel({ children }) {
  return <RMenu.Label className="px-2 pt-2 pb-1 eyebrow">{children}</RMenu.Label>;
}
export function MenuSeparator() {
  return <RMenu.Separator className="my-1 h-px bg-line-subtle" />;
}

/* ───────────────────────── Tooltip ───────────────────────── */
export const TooltipProvider = RTooltip.Provider;
export function Tooltip({ content, children, side = "top" }) {
  if (!content) return children;
  return (
    <RTooltip.Root delayDuration={350}>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content side={side} sideOffset={6} className="bk z-50 rounded-md border border-line-strong bg-raised px-2 py-1 text-body-s text-fg shadow-popover data-[state=delayed-open]:animate-fade-in data-[state=instant-open]:animate-fade-in data-[state=closed]:animate-fade-out">
          {content}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}

/* ───────────────────────── Popover ───────────────────────── */
export const Popover = RPopover.Root;
export const PopoverTrigger = RPopover.Trigger;
export function PopoverContent({ children, className, align = "end", ...rest }) {
  return (
    <RPopover.Portal>
      <RPopover.Content
        align={align}
        sideOffset={8}
        className={cn("bk z-50 rounded-lg border border-line-strong bg-raised shadow-popover origin-[var(--radix-popper-transform-origin)] data-[state=open]:animate-pop-in data-[state=closed]:animate-scale-out focus:outline-none", className)}
        {...rest}
      >
        {children}
      </RPopover.Content>
    </RPopover.Portal>
  );
}
