import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, AlertTriangle, CheckCheck } from "lucide-react";
import { api, timeAgo } from "../lib/data";
import { IconButton, SourceMark, Spinner, Button } from "../ui/primitives";
import { Popover, PopoverTrigger, PopoverContent } from "../ui/overlays";
import { cn } from "../../lib/utils";

/* Updates bell — GET /notifications, POST /notifications/read.
   Only scope-creep / risk alerts land here; everything else lives in the
   workspace's Needs-your-attention list (restrained notification feed). */
export default function NotificationsButton({ size = "m" }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState({ items: [], unread: 0 });
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/notifications?limit=30");
      setData({ items: data.items || [], unread: data.unread || 0 });
    } catch {
      /* bell is best-effort */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => document.visibilityState === "visible" && load(), 90000);
    return () => clearInterval(t);
  }, [load]);

  const markAll = async () => {
    try {
      await api.post("/notifications/read", {});
      setData((d) => ({ unread: 0, items: d.items.map((n) => ({ ...n, read: true })) }));
    } catch { /* ignore */ }
  };
  const openItem = async (n) => {
    setOpen(false);
    if (!n.read) api.post("/notifications/read", { ids: [n.id] }).catch(() => {});
    setData((d) => ({ unread: Math.max(0, d.unread - (n.read ? 0 : 1)), items: d.items.map((x) => (x.id === n.id ? { ...x, read: true } : x)) }));
    if (n.project_id) navigate(`/w/${n.project_id}/review`);
  };

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) load(); }}>
      <PopoverTrigger asChild>
        <IconButton icon={Bell} size={size} label={data.unread ? `Updates, ${data.unread} unread` : "Updates"}>
          {data.unread > 0 && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-warning" aria-hidden="true" />}
        </IconButton>
      </PopoverTrigger>
      <PopoverContent className="w-[min(380px,calc(100vw-24px))] p-0">
        <div className="flex items-center justify-between border-b border-line-subtle px-4 py-3">
          <p className="text-title-s">Updates</p>
          {data.unread > 0 && <Button size="s" variant="ghost" icon={CheckCheck} onClick={markAll}>Mark all read</Button>}
        </div>
        <div className="scroll-pane max-h-[420px]">
          {loading && !data.items.length ? (
            <div className="flex justify-center py-10"><Spinner /></div>
          ) : data.items.length === 0 ? (
            <div className="px-6 py-10 text-center">
              <p className="text-title-s">You’re all caught up</p>
              <p className="mt-1 text-body-s text-fg-tertiary">Bracket alerts you here when a conversation may change scope.</p>
            </div>
          ) : (
            data.items.map((n) => (
              <button key={n.id} onClick={() => openItem(n)} className={cn("flex w-full gap-3 border-b border-line-subtle px-4 py-3 text-left last:border-0 hover:bg-hover", !n.read && "bg-white/[0.02]")}>
                <span className="mt-0.5">{n.type === "scope_creep" ? <AlertTriangle size={15} className="text-warning" /> : <SourceMark provider={n.provider} size={15} />}</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-caption text-warning">{n.type === "scope_creep" ? "Potential scope change" : "Update"}</span>
                  <span className="block text-body-m text-fg line-clamp-2">{n.title}</span>
                  <span className="mt-1 flex items-center gap-1.5 text-body-s text-fg-tertiary">
                    <SourceMark provider={n.provider} size={12} />
                    <span className="truncate">{n.project_name} · {n.source_label}</span>
                    <span>· {timeAgo(n.created_at)}</span>
                  </span>
                </span>
                {!n.read && <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-warning" aria-label="Unread" />}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
