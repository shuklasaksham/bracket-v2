import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { Command } from "cmdk";
import * as RDialog from "@radix-ui/react-dialog";
import {
  Search, LayoutGrid, Layers, MessagesSquare, History, MessageCircleQuestion, Folder, Plus, Settings, CreditCard, Plug, Keyboard,
} from "lucide-react";
import { useProjects } from "../lib/workspace";
import { Kbd } from "../ui/primitives";

/* ⌘K — Search or jump to. Navigates workspaces, views and settings. */
const Ctx = createContext({ open: () => {} });
export const useCommand = () => useContext(Ctx);

function currentProjectId(pathname) {
  const m = pathname.match(/^\/w\/([^/]+)/);
  return m ? m[1] : null;
}

export function CommandProvider({ children }) {
  const [open, setOpen] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { projects } = useProjects();
  const pid = currentProjectId(location.pathname);

  useEffect(() => {
    const onKey = (e) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test(e.target?.tagName) || e.target?.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); }
      else if (e.key === "?" && !typing) { e.preventDefault(); setShowKeys(true); }
      else if (!typing && pid && e.key.toLowerCase() === "g") {
        const next = (ev) => {
          const map = { o: "", m: "/memory", c: "/conversations", t: "/timeline", s: "/sources", a: "/ask" };
          const k = ev.key.toLowerCase();
          if (k in map) navigate(`/w/${pid}${map[k]}`);
          window.removeEventListener("keydown", next, true);
        };
        window.addEventListener("keydown", next, true);
        setTimeout(() => window.removeEventListener("keydown", next, true), 1200);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, pid]);

  const go = useCallback((to) => { setOpen(false); navigate(to); }, [navigate]);
  const views = pid
    ? [
        { label: "Overview", icon: LayoutGrid, to: `/w/${pid}`, keys: "G O" },
        { label: "Memory", icon: Layers, to: `/w/${pid}/memory`, keys: "G M" },
        { label: "Conversations", icon: MessagesSquare, to: `/w/${pid}/conversations`, keys: "G C" },
        { label: "Timeline", icon: History, to: `/w/${pid}/timeline`, keys: "G T" },
        { label: "Ask Bracket", icon: MessageCircleQuestion, to: `/w/${pid}/ask`, keys: "G A" },
        { label: "Sources & files", icon: Folder, to: `/w/${pid}/sources`, keys: "G S" },
      ]
    : [];

  const value = useMemo(() => ({ open: () => setOpen(true), showKeys: () => setShowKeys(true) }), []);
  return (
    <Ctx.Provider value={value}>
      {children}
      <RDialog.Root open={open} onOpenChange={setOpen}>
        <RDialog.Portal>
          <RDialog.Overlay className="fixed inset-0 z-50 bg-overlay animate-fade-in" />
          <RDialog.Content className="bk fixed left-1/2 top-[14vh] z-50 w-[calc(100vw-24px)] max-w-[600px] -translate-x-1/2 overflow-hidden rounded-xl border border-line-strong bg-raised shadow-overlay animate-scale-in focus:outline-none">
            <RDialog.Title className="sr-only">Search or jump to</RDialog.Title>
            <RDialog.Description className="sr-only">Type to find a workspace, view or setting</RDialog.Description>
            <Command loop className="flex flex-col">
              <div className="flex items-center gap-2.5 border-b border-line-subtle px-4">
                <Search size={16} className="text-fg-tertiary" />
                <Command.Input autoFocus placeholder="Search workspaces, views and settings…" className="h-12 flex-1 bg-transparent text-body-l text-fg placeholder:text-fg-disabled focus:outline-none" />
                <Kbd>Esc</Kbd>
              </div>
              <Command.List className="scroll-pane max-h-[min(420px,60vh)] p-1.5">
                <Command.Empty className="px-3 py-8 text-center text-body-s text-fg-tertiary">No results</Command.Empty>
                {views.length > 0 && (
                  <Command.Group heading="This workspace" className="[&_[cmdk-group-heading]]:eyebrow [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-2">
                    {views.map((v) => (
                      <Item key={v.label} icon={v.icon} onSelect={() => go(v.to)} keys={v.keys}>{v.label}</Item>
                    ))}
                  </Command.Group>
                )}
                <Command.Group heading="Workspaces" className="[&_[cmdk-group-heading]]:eyebrow [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-2">
                  {(projects || []).filter((p) => !p.archived).map((p) => (
                    <Item key={p.id} icon={LayoutGrid} onSelect={() => go(`/w/${p.id}`)}>{p.name || "Untitled"}</Item>
                  ))}
                  <Item icon={Plus} onSelect={() => go("/connect?new=1")}>New workspace</Item>
                </Command.Group>
                <Command.Group heading="Account" className="[&_[cmdk-group-heading]]:eyebrow [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-2">
                  <Item icon={Plug} onSelect={() => go("/connect")}>Connect a tool</Item>
                  <Item icon={Settings} onSelect={() => go("/settings")}>Settings</Item>
                  <Item icon={CreditCard} onSelect={() => go("/settings/billing")}>Billing</Item>
                  <Item icon={Keyboard} onSelect={() => { setOpen(false); setShowKeys(true); }} keys="?">Keyboard shortcuts</Item>
                </Command.Group>
              </Command.List>
            </Command>
          </RDialog.Content>
        </RDialog.Portal>
      </RDialog.Root>
      <ShortcutsDialog open={showKeys} onOpenChange={setShowKeys} />
    </Ctx.Provider>
  );
}

function Item({ icon: Icon, children, onSelect, keys }) {
  return (
    <Command.Item
      onSelect={onSelect}
      className="flex h-10 cursor-pointer items-center gap-3 rounded-md px-2.5 text-body-m text-fg-secondary data-[selected=true]:bg-hover data-[selected=true]:text-fg"
    >
      <Icon size={15} strokeWidth={1.75} />
      <span className="flex-1 truncate">{children}</span>
      {keys && <span className="font-mono text-[11px] text-fg-tertiary">{keys}</span>}
    </Command.Item>
  );
}

const SHORTCUTS = [
  ["Global", [["Search or jump to", "⌘K"], ["Ask Bracket", "⌘J"], ["Show shortcuts", "?"]]],
  ["Navigate", [["Overview", "G O"], ["Memory", "G M"], ["Conversations", "G C"], ["Timeline", "G T"], ["Sources", "G S"]]],
  ["Review", [["Next / previous update", "J / K"], ["Select / deselect", "X"], ["Accept selected", "⌘↵"], ["Close panel", "Esc"]]],
];
function ShortcutsDialog({ open, onOpenChange }) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-50 bg-overlay animate-fade-in" />
        <RDialog.Content className="bk fixed left-1/2 top-1/2 z-50 w-[calc(100vw-24px)] max-w-[560px] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-line-strong bg-raised p-5 shadow-overlay animate-scale-in focus:outline-none">
          <RDialog.Title className="text-title-m mb-4">Keyboard shortcuts</RDialog.Title>
          <RDialog.Description className="sr-only">All keyboard shortcuts</RDialog.Description>
          <div className="space-y-5 scroll-pane max-h-[60vh]">
            {SHORTCUTS.map(([group, rows]) => (
              <div key={group}>
                <p className="eyebrow mb-2">{group}</p>
                {rows.map(([label, key]) => (
                  <div key={label} className="flex items-center justify-between py-1.5 text-body-m text-fg-secondary">
                    {label}
                    <span className="flex gap-1">{key.split(" ").map((k) => <Kbd key={k}>{k}</Kbd>)}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}
