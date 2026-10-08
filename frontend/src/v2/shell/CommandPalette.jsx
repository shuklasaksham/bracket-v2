import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Command } from "cmdk";
import * as RDialog from "@radix-ui/react-dialog";
import {
  Search, LayoutGrid, Layers, MessagesSquare, History, MessageCircleQuestion, Folder, Plus, Settings, CreditCard, Plug, Keyboard,
  Check, Reply, Users, X,
} from "lucide-react";
import { useProjects } from "../lib/workspace";
import { v2 } from "../lib/api2";
import { shortTime } from "../lib/data";
import { Kbd, SourceMark, IconButton } from "../ui/primitives";
import { useAskPanel } from "./AskPanel";

/* ⌘K — Search or jump to (Figma › Overview · Command palette).
   Empty query: jump to views, workspaces and settings. With a query: Memory,
   Conversations, People and Actions from the current workspace. */
const Ctx = createContext({ open: () => {} });
export const useCommand = () => useContext(Ctx);

const currentProjectId = (pathname) => (pathname.match(/^\/w\/([^/]+)/) || [])[1] || null;
const CAT = { scope: "Scope", decision: "Decision", deliverable: "Deliverable", requirement: "Requirement", commitment: "Commitment", person: "Person" };
const groupCls = "[&_[cmdk-group-heading]]:eyebrow [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1.5";

export function CommandProvider({ children }) {
  const [open, setOpen] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const [q, setQ] = useState("");
  const [res, setRes] = useState(null);
  const [reviews, setReviews] = useState([]);
  const navigate = useNavigate();
  const location = useLocation();
  const { projects } = useProjects();
  const ask = useAskPanel();
  const pid = currentProjectId(location.pathname);

  useEffect(() => {
    const onKey = (e) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test(e.target?.tagName) || e.target?.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); }
      else if (e.key === "?" && !typing) { e.preventDefault(); setShowKeys(true); }
      else if (!typing && pid && e.key.toLowerCase() === "g" && !e.metaKey && !e.ctrlKey) {
        const next = (ev) => {
          const map = { o: "", m: "/memory", c: "/conversations", t: "/timeline", s: "/sources", a: "/ask", f: "/files" };
          const k = ev.key.toLowerCase();
          if (k in map) { ev.preventDefault(); navigate(`/w/${pid}${map[k]}`); }
          window.removeEventListener("keydown", next, true);
        };
        window.addEventListener("keydown", next, true);
        setTimeout(() => window.removeEventListener("keydown", next, true), 1200);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, pid]);

  useEffect(() => {
    if (!open) { setQ(""); setRes(null); return; }
    if (pid) v2.reviews(pid).then((d) => setReviews(d.reviews || [])).catch(() => setReviews([]));
  }, [open, pid]);
  useEffect(() => {
    if (!open || !pid || q.trim().length < 2) { setRes(null); return undefined; }
    const id = setTimeout(() => v2.search(pid, q.trim()).then(setRes).catch(() => setRes(null)), 140);
    return () => clearTimeout(id);
  }, [q, pid, open]);

  const go = useCallback((to) => { setOpen(false); navigate(to); }, [navigate]);
  const value = useMemo(() => ({ open: () => setOpen(true), showKeys: () => setShowKeys(true) }), []);
  const has = q.trim().length >= 2;
  const ql = q.trim().toLowerCase();
  const match = (s) => !ql || s.toLowerCase().includes(ql);

  const views = pid ? [
    { label: "Overview", icon: LayoutGrid, to: `/w/${pid}`, keys: "G O" },
    { label: "Memory", icon: Layers, to: `/w/${pid}/memory`, keys: "G M" },
    { label: "Conversations", icon: MessagesSquare, to: `/w/${pid}/conversations`, keys: "G C" },
    { label: "Timeline", icon: History, to: `/w/${pid}/timeline`, keys: "G T" },
    { label: "Ask Bracket", icon: MessageCircleQuestion, to: `/w/${pid}/ask`, keys: "G A" },
    { label: "Sources", icon: Plug, to: `/w/${pid}/sources`, keys: "G S" },
    { label: "Files", icon: Folder, to: `/w/${pid}/files`, keys: "G F" },
  ] : [];
  const settings = pid ? [
    { label: "Settings", icon: Settings, to: `/w/${pid}/settings/profile` },
    { label: "Members", icon: Users, to: `/w/${pid}/settings/members` },
    { label: "Billing", icon: CreditCard, to: `/w/${pid}/settings/billing` },
  ] : [];
  const firstReview = reviews[0];

  return (
    <Ctx.Provider value={value}>
      {children}
      <RDialog.Root open={open} onOpenChange={setOpen}>
        <RDialog.Portal>
          <RDialog.Overlay className="fixed inset-0 z-50 bg-overlay data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out" />
          <RDialog.Content className="bk fixed left-1/2 top-[10vh] z-50 w-[calc(100vw-24px)] max-w-[640px] -translate-x-1/2 overflow-hidden rounded-xl border border-line-strong bg-raised shadow-overlay data-[state=open]:animate-pop-in data-[state=closed]:animate-scale-out focus:outline-none">
            <RDialog.Title className="sr-only">Search or jump to</RDialog.Title>
            <RDialog.Description className="sr-only">Search memory, conversations and people, or jump to a view</RDialog.Description>
            <Command loop shouldFilter={false} className="flex flex-col"
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && has) { e.preventDefault(); setOpen(false); ask.open(q); } }}>
              <div className="flex items-center gap-3 border-b border-line-subtle px-4">
                <Search size={16} className="text-fg-tertiary" />
                <Command.Input value={q} onValueChange={setQ} autoFocus placeholder="Search memory, people, conversations…" className="h-14 flex-1 bg-transparent text-body-l text-fg placeholder:text-fg-tertiary focus:outline-none" />
                <Kbd>esc</Kbd>
              </div>
              <Command.List className="scroll-pane max-h-[min(440px,60vh)] p-1.5">
                {has && res && !res.memory.length && !res.conversations.length && !res.people.length && (
                  <p className="px-3 pt-4 pb-2 text-body-s text-fg-tertiary">Nothing in memory matches “{q}”. Ask Bracket instead.</p>
                )}
                {has && res?.memory?.length > 0 && (
                  <Command.Group heading="Memory" className={groupCls}>
                    {res.memory.map((m) => (
                      <Item key={m.id} value={`m-${m.id}`} icon={Layers} meta={`${CAT[m.category] || m.category} · current`} onSelect={() => go(`/w/${pid}/memory/${m.category}?item=${m.id}`)}>{m.title}</Item>
                    ))}
                  </Command.Group>
                )}
                {has && res?.people?.length > 0 && (
                  <Command.Group heading="People" className={groupCls}>
                    {res.people.map((p) => <Item key={p.id} value={`p-${p.id}`} icon={Users} meta={p.role} onSelect={() => go(`/w/${pid}/memory/person?person=${p.id}`)}>{p.name}</Item>)}
                  </Command.Group>
                )}
                {has && res?.conversations?.length > 0 && (
                  <Command.Group heading="Conversations" className={groupCls}>
                    {res.conversations.map((c) => <Item key={c.id} value={`c-${c.id}`} mark={c.provider} meta={c.who} onSelect={() => go(`/w/${pid}/conversations/${c.id}`)}>{c.title}</Item>)}
                  </Command.Group>
                )}
                {pid && (has || firstReview) && (
                  <Command.Group heading="Actions" className={groupCls}>
                    {firstReview && <Item value="a-review" icon={Check} meta={`${firstReview.count} proposed updates`} keys="R" onSelect={() => go(`/w/${pid}/review/${firstReview.id}`)}>Review {firstReview.label.toLowerCase()}</Item>}
                    {has && <Item value="a-ask" icon={MessageCircleQuestion} meta="Ask Bracket" keys="⌘J" onSelect={() => { setOpen(false); ask.open(q); }}>Ask: “{q}”</Item>}
                    {!has && <Item value="a-reply" icon={Reply} meta="Uses scope + timeline" onSelect={() => go(`/w/${pid}/conversations?filter=needs_reply`)}>Draft a reply</Item>}
                  </Command.Group>
                )}
                {!has && views.length > 0 && (
                  <Command.Group heading="Go to" className={groupCls}>
                    {views.map((v) => <Item key={v.label} value={`v-${v.label}`} icon={v.icon} keys={v.keys} onSelect={() => go(v.to)}>{v.label}</Item>)}
                  </Command.Group>
                )}
                {(projects || []).filter((p) => p.status === "active" && p.id !== pid && match(p.name)).length > 0 && (
                  <Command.Group heading="Workspaces" className={groupCls}>
                    {(projects || []).filter((p) => p.status === "active" && p.id !== pid && match(p.name)).slice(0, has ? 3 : 6).map((p) => (
                      <Item key={p.id} value={`w-${p.id}`} icon={LayoutGrid} meta={p.client_name} onSelect={() => go(`/w/${p.id}`)}>{p.name}</Item>
                    ))}
                    {!has && <Item value="w-new" icon={Plus} onSelect={() => go("/connect?new=1")}>New workspace</Item>}
                  </Command.Group>
                )}
                {!has && (
                  <Command.Group heading="Account" className={groupCls}>
                    {settings.map((s) => <Item key={s.label} value={`s-${s.label}`} icon={s.icon} onSelect={() => go(s.to)}>{s.label}</Item>)}
                    <Item value="s-keys" icon={Keyboard} keys="?" onSelect={() => { setOpen(false); setShowKeys(true); }}>Keyboard shortcuts</Item>
                  </Command.Group>
                )}
              </Command.List>
              <div className="border-t border-line-subtle px-4 py-2.5 text-body-s text-fg-tertiary">↑↓ to move · ↵ to open{has ? " · ⌘↵ to ask in panel" : ""}</div>
            </Command>
          </RDialog.Content>
        </RDialog.Portal>
      </RDialog.Root>
      <ShortcutsDialog open={showKeys} onOpenChange={setShowKeys} />
    </Ctx.Provider>
  );
}

function Item({ icon: Icon, mark, children, onSelect, keys, meta, value }) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="flex h-10 cursor-pointer items-center gap-3 rounded-md px-3 text-body-m text-fg-secondary transition-colors duration-fast data-[selected=true]:bg-hover data-[selected=true]:text-fg"
    >
      {mark ? <SourceMark provider={mark} size={15} /> : <Icon size={15} strokeWidth={1.75} />}
      <span className="truncate">{children}</span>
      {meta && <span className="truncate text-body-s text-fg-tertiary">{meta}</span>}
      <span className="flex-1" />
      {keys && <Kbd>{keys}</Kbd>}
    </Command.Item>
  );
}

const SHORTCUTS = [
  ["Global", [["Search or jump to", "⌘K"], ["Ask Bracket", "⌘J"], ["Switch workspace", "⌘O"], ["Collapse sidebar", "⌘\\"], ["Show shortcuts", "?"]]],
  ["Navigate", [["Overview", "G O"], ["Memory", "G M"], ["Conversations", "G C"], ["Timeline", "G T"], ["Sources", "G S"], ["Files", "G F"]]],
  ["Review", [["Next / previous proposal", "J / K"], ["Select / deselect", "X"], ["Accept selected", "⌘↵"], ["Dismiss", "⌫"], ["Undo", "⌘Z"]]],
];
function ShortcutsDialog({ open, onOpenChange }) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-50 bg-overlay data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out" />
        <RDialog.Content className="bk fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100vh-48px)] w-[calc(100vw-24px)] max-w-[520px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-line-strong bg-raised shadow-overlay data-[state=open]:animate-scale-in data-[state=closed]:animate-scale-out focus:outline-none">
          <div className="flex h-14 items-center justify-between pl-4 pr-3">
            <RDialog.Title className="text-body-l font-medium text-fg">Keyboard shortcuts</RDialog.Title>
            <RDialog.Close asChild><IconButton icon={X} label="Close" /></RDialog.Close>
          </div>
          <RDialog.Description className="sr-only">All keyboard shortcuts</RDialog.Description>
          <div className="scroll-pane px-4 pb-4">
            {SHORTCUTS.map(([group, rows]) => (
              <div key={group} className="pt-2">
                <p className="eyebrow py-2">{group}</p>
                {rows.map(([label, key]) => (
                  <div key={label} className="flex h-9 items-center justify-between text-body-m text-fg-secondary">
                    {label}
                    <span className="flex gap-1">{key.split(" ").map((k, i) => (k === "/" ? <span key={i} className="px-0.5 text-fg-tertiary">/</span> : <Kbd key={i}>{k}</Kbd>))}</span>
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
