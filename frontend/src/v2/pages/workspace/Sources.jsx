import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Plus, RefreshCw, MoreHorizontal, Unlink, MessagesSquare, FileText, Upload, Lock, Plug, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "../../lib/workspace";
import { api, formatApiError, timeAgo, longDate } from "../../lib/data";
import {
  Badge, Banner, Button, Card, EmptyState, Field, IconButton, Input, Skeleton, SourceMark, SyncStatus, Textarea, providerLabel,
} from "../../ui/primitives";
import { Dialog, Menu, MenuTrigger, MenuContent, MenuItem, MenuSeparator } from "../../ui/overlays";
import { ConnectFlow, useOAuthConnect } from "../../features/connect";
import { cn } from "../../../lib/utils";

export default function Sources() {
  const { connections, notes, items, projectId, refresh } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [adding, setAdding] = useState(params.get("add") === "1");
  const [noting, setNoting] = useState(params.get("note") === "1");
  const [disc, setDisc] = useState(null);
  const [busy, setBusy] = useState(null);
  const { connect } = useOAuthConnect();
  const focusId = params.get("c");
  const focusRef = useRef(null);

  useEffect(() => { if (focusRef.current) focusRef.current.scrollIntoView({ block: "center" }); }, [connections]);
  const clearParam = (k) => { const n = new URLSearchParams(params); n.delete(k); setParams(n, { replace: true }); };

  const sync = async (c) => {
    setBusy(c.id);
    try {
      const { data } = await api.post(`/connect/connections/${c.id}/sync`);
      await refresh("connections", "memory", "history");
      if (data?.status === "expired" || data?.status === "needs_attention") toast.error(`${providerLabel(c.provider)} needs reconnecting`, { description: "Choose Reconnect to sign in again." });
      else if (data?.status === "error") toast.error("Couldn’t sync right now — try again in a minute.");
      else if (data?.rate_limited) toast("The provider is rate-limiting requests — Bracket will retry automatically.");
      else toast.success(data?.new_items ? `${data.new_items} new update${data.new_items > 1 ? "s" : ""} found — waiting in review` : "Up to date — nothing new");
    } catch (e) { toast.error(formatApiError(e)); } finally { setBusy(null); }
  };
  const reconnect = async (c) => {
    try {
      await connect(c.provider);
      toast.success(`${providerLabel(c.provider)} reconnected — catching up`);
      sync(c);
    } catch (e) { if (e.message !== "cancelled") toast.error(e.message); }
  };
  const disconnect = async () => {
    setBusy("disc");
    try {
      const { data } = await api.delete(`/connect/connections/${disc.id}`);
      await refresh("connections", "history");
      toast.success(`Disconnected ${disc.source_name}`, { description: data.account_removed ? `That was your last ${providerLabel(disc.provider)} source, so Bracket also signed out of ${providerLabel(disc.provider)}.` : "Memory Bracket learned from it stays." });
      setDisc(null);
    } catch (e) { toast.error(formatApiError(e)); } finally { setBusy(null); }
  };

  if (!connections) return <div className="p-8 space-y-3" aria-busy="true"><Skeleton className="h-8 w-60" /><Skeleton className="h-16" /><Skeleton className="h-16" /></div>;
  const learnedFrom = (id) => items.filter((m) => m.connection_id === id).length;

  return (
    <div className="scroll-pane h-full">
      <div className="mx-auto max-w-[1100px] px-4 py-6 md:px-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-title-l">Sources & files</h1>
            <p className="mt-0.5 text-body-s text-fg-tertiary flex items-center gap-1.5"><Lock size={12} /> Bracket reads only what you choose and never sends without your approval.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" icon={FileText} onClick={() => setNoting(true)}>Add note</Button>
            <Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>Add source</Button>
          </div>
        </div>

        <section className="mt-6" aria-labelledby="connected">
          <p id="connected" className="eyebrow mb-2">Connected · {connections.length}</p>
          {connections.length === 0 ? (
            <Card><EmptyState icon={Plug} title="No sources connected" action={<Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>Add source</Button>}>Connect the Gmail threads, Slack channels or files about this work.</EmptyState></Card>
          ) : (
            <Card className="overflow-hidden">
              {connections.map((c) => {
                const h = c.health || {};
                const bad = h.level && h.level !== "green";
                return (
                  <div key={c.id} ref={c.id === focusId ? focusRef : null} className={cn("flex flex-col gap-3 border-b border-line-subtle px-4 py-4 last:border-0 sm:flex-row sm:items-center", c.id === focusId && "bg-selected")}>
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <SourceMark provider={c.provider} size={20} className="mt-0.5" />
                      <div className="min-w-0">
                        <p className="truncate text-body-m text-fg">{c.source_name}</p>
                        <p className="truncate text-body-s text-fg-tertiary">{providerLabel(c.provider)} · {learnedFrom(c.id)} memories · connected {longDate(c.created_at)}</p>
                        <div className="mt-1.5">
                          {bad ? <SyncStatus state={h.level === "red" ? "error" : "warning"} label={h.message} />
                            : c.status === "error" ? <SyncStatus state="error" label="Last sync failed" />
                              : <SyncStatus state={busy === c.id ? "syncing" : "synced"} label={busy === c.id ? "Syncing…" : `Synced ${timeAgo(c.last_synced_at)}`} />}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 sm:shrink-0">
                      {bad ? (
                        <Button size="s" variant="primary" icon={RefreshCw} onClick={() => reconnect(c)}>Reconnect</Button>
                      ) : (
                        <Button size="s" variant="secondary" icon={RefreshCw} loading={busy === c.id} onClick={() => sync(c)}>Sync now</Button>
                      )}
                      <Button size="s" variant="ghost" icon={MessagesSquare} onClick={() => navigate(`/w/${projectId}/conversations?c=${c.id}`)}>View</Button>
                      <Menu>
                        <MenuTrigger asChild><IconButton icon={MoreHorizontal} label={`More actions for ${c.source_name}`} /></MenuTrigger>
                        <MenuContent>
                          {c.source_url && <MenuItem onSelect={() => window.open(c.source_url, "_blank", "noopener")}>Open in {providerLabel(c.provider)}</MenuItem>}
                          <MenuItem icon={RefreshCw} onSelect={() => reconnect(c)}>Reconnect account</MenuItem>
                          <MenuSeparator />
                          <MenuItem icon={Unlink} danger onSelect={() => setDisc(c)}>Disconnect…</MenuItem>
                        </MenuContent>
                      </Menu>
                    </div>
                  </div>
                );
              })}
            </Card>
          )}
        </section>

        <section className="mt-8" aria-labelledby="notes">
          <div className="mb-2 flex items-center justify-between">
            <p id="notes" className="eyebrow">Notes & files · {(notes || []).length}</p>
            <Button size="s" variant="ghost" icon={Upload} onClick={() => setNoting(true)}>Upload</Button>
          </div>
          {(notes || []).length === 0 ? (
            <button onClick={() => setNoting(true)} className="w-full rounded-lg border border-dashed border-line px-4 py-6 text-center hover:border-line-strong">
              <p className="text-body-m text-fg-secondary">Paste notes or a transcript</p>
              <p className="mt-0.5 text-body-s text-fg-tertiary">Meeting notes, call transcripts, briefs — .txt, .md, .docx or .pdf. Bracket reads it once and links what it learns.</p>
            </button>
          ) : (
            <Card className="overflow-hidden">
              {notes.map((n) => (
                <button key={n.id} onClick={() => navigate(`/w/${projectId}/conversations?c=${n.id}`)} className="flex w-full items-center gap-3 border-b border-line-subtle px-4 py-3 text-left last:border-0 hover:bg-hover">
                  <FileText size={16} className="text-fg-tertiary" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body-m text-fg">{n.title}</span>
                    <span className="block text-body-s text-fg-tertiary">Added {longDate(n.created_at)}</span>
                  </span>
                  <Badge>{n.items} memor{n.items === 1 ? "y" : "ies"}</Badge>
                </button>
              ))}
            </Card>
          )}
        </section>
      </div>

      <Dialog open={adding} onOpenChange={(o) => { setAdding(o); if (!o) clearParam("add"); }} title="Add a source" size="l">
        {adding && (
          <ConnectFlow projectId={projectId} mode="existing" onCancel={() => setAdding(false)}
            onDone={async () => { setAdding(false); clearParam("add"); await refresh(); }} />
        )}
      </Dialog>

      <AddNoteDialog open={noting} onOpenChange={(o) => { setNoting(o); if (!o) clearParam("note"); }} projectId={projectId} onAdded={() => refresh()} />

      <Dialog open={!!disc} onOpenChange={(o) => !o && setDisc(null)} size="s" title={`Disconnect ${disc?.source_name || "source"}?`}
        description="Bracket stops reading it. Everything it already learned stays in memory, marked with this source, and the timeline keeps the history."
        footer={<><Button variant="ghost" onClick={() => setDisc(null)}>Cancel</Button><Button variant="danger" icon={Unlink} loading={busy === "disc"} onClick={disconnect}>Disconnect</Button></>}>
        {disc && <Banner tone="neutral" title={`${learnedFrom(disc.id)} memories came from this source`}>They stay. You can remove individual items from Memory at any time.</Banner>}
      </Dialog>
    </div>
  );
}

/* POST /projects/:id/ingest-notes (multipart: text, title, file) */
function AddNoteDialog({ open, onOpenChange, projectId, onAdded }) {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setTitle(""); setText(""); setFile(null); } }, [open]);
  const submit = async () => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("title", title.trim());
      fd.append("text", text);
      if (file) fd.append("file", file);
      const { data } = await api.post(`/projects/${projectId}/ingest-notes`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success(`Note added · Bracket found ${data.added} update${data.added === 1 ? "" : "s"}`, { description: data.added ? "They’re waiting in review — nothing changes until you accept." : "Nothing in it changes scope, decisions or commitments." });
      onOpenChange(false);
      onAdded();
    } catch (e) { toast.error(formatApiError(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Add a note" description="Paste notes or a transcript, or upload a file. Bracket reads it once and proposes updates for your review."
      footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" loading={busy} disabled={!text.trim() && !file} onClick={submit}>Add to Bracket</Button></>}>
      <div className="space-y-4">
        <Field label="Title" htmlFor="n-title"><Input id="n-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Call with Sarah — Oct 7" /></Field>
        <Field label="Note" htmlFor="n-text" helper="Paste anything — Bracket ignores small talk."><Textarea id="n-text" rows={7} value={text} onChange={(e) => setText(e.target.value)} placeholder="Sarah confirmed tablet is a nice-to-have…" /></Field>
        <div>
          <p className="mb-1.5 text-body-s font-medium text-fg-secondary">Or upload a file</p>
          <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-line px-4 py-3 hover:border-line-strong">
            <Upload size={16} className="text-fg-tertiary" />
            <span className="flex-1 truncate text-body-m text-fg-secondary">{file ? file.name : "Choose .txt, .md, .docx or .pdf (max 8 MB)"}</span>
            <input type="file" accept=".txt,.md,.docx,.pdf" className="sr-only" onChange={(e) => {
              const f = e.target.files?.[0];
              if (f && f.size > 8 * 1024 * 1024) { toast.error("That file is over 8 MB."); return; }
              setFile(f || null);
            }} />
          </label>
        </div>
      </div>
    </Dialog>
  );
}
