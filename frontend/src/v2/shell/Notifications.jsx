import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, AlertTriangle, CalendarClock, RefreshCw, CheckCircle2, SlidersHorizontal, GitPullRequestArrow, Info } from "lucide-react";
import { cn } from "../../lib/utils";
import { v2 } from "../lib/api2";
import { shortTime } from "../lib/data";
import { IconButton } from "../ui/primitives";
import { Popover, PopoverTrigger, PopoverContent, Tooltip } from "../ui/overlays";
import { Stagger, StaggerItem } from "../ui/motion";

/* Updates — restrained feed: attention first, then memory changes, then system.
   Figma › Overview · Updates open. */
const GROUPS = [
  { key: "attention", label: "Needs your attention" },
  { key: "memory", label: "Memory updated" },
  { key: "system", label: "System" },
];
const ICON = {
  warning: [AlertTriangle, "text-warning"],
  calendar: [CalendarClock, "text-info"],
  changed: [RefreshCw, "text-fg-secondary"],
  synced: [CheckCircle2, "text-success"],
  conflict: [GitPullRequestArrow, "text-danger"],
  info: [Info, "text-fg-secondary"],
};

export default function NotificationsButton({ size = "m" }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState({ items: [], unread: 0 });
  const navigate = useNavigate();
  const load = useCallback(() => v2.updates().then(setData).catch(() => {}), []);
  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    window.addEventListener("bk:refresh", load);
    return () => { clearInterval(t); window.removeEventListener("bk:refresh", load); };
  }, [load]);

  const markAll = async () => {
    setData((d) => ({ items: d.items.map((i) => ({ ...i, read: true })), unread: 0 }));
    await v2.readUpdates().catch(() => {});
  };
  const openItem = async (it) => {
    setOpen(false);
    if (!it.read) {
      setData((d) => ({ items: d.items.map((i) => (i.id === it.id ? { ...i, read: true } : i)), unread: Math.max(0, d.unread - 1) }));
      v2.readUpdates([it.id]).catch(() => {});
    }
    const w = it.link?.workspace;
    const id = it.link?.id;
    const to = {
      review: `/w/${w}/review/${id}`, resolve: `/w/${w}?resolve=${id}`, memory: `/w/${w}/memory?item=${id}`,
      event: `/w/${w}/timeline/${id}`, source: `/w/${w}/sources/${id}`, thread: `/w/${w}/conversations/${id}`,
    }[it.link?.kind];
    if (to) navigate(to);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip content="Updates">
        <PopoverTrigger asChild>
          <IconButton
            icon={Bell}
            size={size}
            label={data.unread ? `Updates, ${data.unread} unread` : "Updates"}
          >
            {data.unread > 0 && <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-warning ring-2 ring-app" />}
          </IconButton>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent className="w-[min(400px,calc(100vw-24px))] p-0">
        <div className="flex h-12 items-center justify-between border-b border-line-subtle pl-4 pr-2">
          <p className="text-body-m font-medium text-fg">Updates</p>
          <div className="flex items-center gap-1">
            <button onClick={markAll} disabled={!data.unread} className="h-7 rounded-md px-2 text-body-s text-fg-secondary hover:bg-hover hover:text-fg disabled:opacity-40">Mark all read</button>
            <IconButton icon={SlidersHorizontal} label="Notification settings" size="s" onClick={() => { setOpen(false); const w = data.items[0]?.link?.workspace || window.location.pathname.split("/")[2]; navigate(`/w/${w}/settings/notifications`); }} />
          </div>
        </div>
        <div className="max-h-[440px] overflow-y-auto py-1">
          {data.items.length === 0 && (
            <div className="px-4 py-8 text-center">
              <p className="text-body-m text-fg">You’re all caught up</p>
              <p className="mt-1 text-body-s text-fg-tertiary">New attention items show up here first.</p>
            </div>
          )}
          {GROUPS.map((g) => {
            const list = data.items.filter((i) => i.group === g.key);
            if (!list.length) return null;
            return (
              <div key={g.key} className="pb-1">
                <p className="eyebrow px-4 pt-3 pb-1.5">{g.label}</p>
                <Stagger step={0.02}>
                  {list.map((it) => {
                    const [Icon, color] = ICON[it.icon] || ICON.info;
                    return (
                      <StaggerItem key={it.id}>
                        <button onClick={() => openItem(it)} className="flex w-full items-start gap-3 px-4 py-2 text-left transition-colors duration-fast hover:bg-hover">
                          <Icon size={16} className={cn("mt-0.5 shrink-0", color)} aria-hidden="true" />
                          <span className="min-w-0 flex-1">
                            <span className={cn("block text-body-s", it.read ? "text-fg-secondary" : "text-fg")}>{it.title}</span>
                            <span className="block text-body-s text-fg-tertiary">{[it.sub, it.at ? shortTime(it.at) : null].filter(Boolean).join(" · ")}</span>
                          </span>
                          {!it.read && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-info" aria-label="Unread" />}
                        </button>
                      </StaggerItem>
                    );
                  })}
                </Stagger>
              </div>
            );
          })}
        </div>
        <p className="border-t border-line-subtle px-4 py-3 text-body-s text-fg-tertiary">Real-time alerts only for attention items. Everything else arrives in your daily digest.</p>
      </PopoverContent>
    </Popover>
  );
}
