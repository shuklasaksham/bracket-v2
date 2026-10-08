import React, { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Plus, RefreshCw, MoreHorizontal, FileText, Upload, Lock, Mic, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { useWorkspace } from "../../lib/workspace";
import { v2 } from "../../lib/api2";
import { useResource } from "../../lib/data";
import { useIsMobile } from "../../lib/useMedia";
import { Badge, Button, IconButton, SourceMark } from "../../ui/primitives";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "../../ui/overlays";
import { Stagger, StaggerItem, motion, t as T } from "../../ui/motion";
import { AddNoteDialog, AddSourceDialog, ChooseItemsDialog, SourceStatus, UploadDialog, num } from "../../features/sources";
import { FileStatus } from "./Files";
import { cn } from "../../../lib/utils";

/* Sources — Figma › ✓ Sources — Desktop 1440, Sources · After disconnecting
   Gmail, Add source (picker), Add Slack — choose channels, Add note, Note added;
   Sources — Mobile 390. */
export default function Sources() {
  const { projectId, canEdit } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const mobile = useIsMobile();
  const navigate = useNavigate();
  const base = `/w/${projectId}`;
  const { data, reload } = useResource(() => Promise.all([v2.sources(projectId), v2.files(projectId)]).then(([s, f]) => ({ ...s, files: f.files })), [projectId]);
  const [picker, setPicker] = useState(false);
  const [choose, setChoose] = useState(null);
  const [note, setNote] = useState(false);
  const [upload, setUpload] = useState(false);

  useEffect(() => {
    const add = params.get("add");
    if (add === "1") setPicker(true); else if (add === "gmail" || add === "slack") setChoose(add);
    if (params.get("note") === "1") setNote(true);
    if (add || params.get("note")) setParams({}, { replace: true });
  }, [params, setParams]);
  useEffect(() => {
    const on = () => reload();
    window.addEventListener("bk:refresh", on);
    const id = setInterval(reload, 4000);
    return () => { window.removeEventListener("bk:refresh", on); clearInterval(id); };
  }, [reload]);

  const pick = (key) => {
    setPicker(false);
    if (key === "slack") setChoose("slack");
    else if (key === "gmail") { const g = data?.sources.find((s) => s.provider === "gmail"); if (g && g.status !== "disconnected") navigate(`${base}/sources/${g.id}?add=1`); else setChoose("gmail"); }
    else if (key === "notes") setNote(true);
    else if (key === "files") setUpload(true);
    else toast(`${key[0].toUpperCase() + key.slice(1)} connects through OAuth`, { description: "You’ll pick exactly what Bracket can read next." });
  };
  const sync = async (s) => { await v2.syncSource(projectId, s.id); reload(); };
  const reconnect = (s) => navigate(`${base}/sources/${s.id}?reconnect=1`);

  const sources = data?.sources || [];
  return (
    <div className="scroll-pane h-full">
      <div className="mx-auto grid max-w-[1600px] gap-8 px-4 pt-4 pb-12 md:px-8 md:pt-6 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-title-l text-fg">Sources</h1>
              <p className="mt-1 text-[12px] text-fg-tertiary">Where Bracket learns about this workspace. It reads only what you choose and never changes your tools.</p>
            </div>
            <Button variant="primary" icon={Plus} onClick={() => setPicker(true)} disabled={!canEdit}>Add source</Button>
          </div>

          <p className="eyebrow mt-6 mb-3">Connected · {sources.length}</p>
          <div className="overflow-hidden rounded-lg border border-line">
            {!mobile && (
              <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_72px] gap-4 border-b border-line-subtle px-4 py-3 text-[12px] text-fg-tertiary">
                <span>Source</span><span>What Bracket reads</span><span>Status</span><span />
              </div>
            )}
            <Stagger>
              {sources.map((s) => (
                <StaggerItem key={s.id} className="border-b border-line-subtle last:border-0">
                  <div className={cn("grid items-center gap-4 px-4 py-4", mobile ? "grid-cols-[minmax(0,1fr)_auto]" : "grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_72px]")}>
                    <Link to={`${base}/sources/${s.id}`} className="flex min-w-0 items-center gap-3">
                      <span className={cn("shrink-0", s.status === "disconnected" && "opacity-50")}>{s.provider === "notes" ? <FileText size={18} className="text-fg-secondary" /> : <SourceMark provider={s.provider} size={18} />}</span>
                      <span className="min-w-0">
                        <span className="block text-body-m text-fg">{s.label}</span>
                        <span className="block truncate text-[12px] text-fg-tertiary">{s.account}</span>
                        <span className="block text-[12px] text-fg-tertiary">{s.provider === "notes" ? `${s.items} notes` : `${num(s.messages)} messages`}</span>
                        {mobile && <span className="mt-1 block"><SourceStatus s={s} short /></span>}
                      </span>
                    </Link>
                    {!mobile && <span className="truncate text-[12px] text-fg-secondary">{s.reads_summary}</span>}
                    {!mobile && <SourceStatus s={s} />}
                    <span className="flex items-center justify-end gap-1">
                      {s.status === "disconnected" || s.status === "error" ? (
                        <Button size="s" onClick={() => reconnect(s)} disabled={!canEdit}>Reconnect</Button>
                      ) : (
                        <>
                          {!mobile && <IconButton icon={RefreshCw} label={`Sync ${s.label} now`} onClick={() => sync(s)} className={s.status === "checking" ? "animate-spin" : ""} />}
                          <Menu>
                            <MenuTrigger asChild><IconButton icon={MoreHorizontal} label={`${s.label} options`} /></MenuTrigger>
                            <MenuContent>
                              <MenuItem onSelect={() => navigate(`${base}/sources/${s.id}`)}>Open {s.label}</MenuItem>
                              <MenuItem onSelect={() => sync(s)}>Sync now</MenuItem>
                              <MenuItem onSelect={() => navigate(`${base}/sources/${s.id}?add=1`)}>{s.provider === "slack" ? "Add channels" : s.provider === "gmail" ? "Add threads" : "Add note"}</MenuItem>
                              <MenuSeparator />
                              <MenuItem danger onSelect={() => navigate(`${base}/sources/${s.id}?disconnect=1`)}>Disconnect…</MenuItem>
                            </MenuContent>
                          </Menu>
                        </>
                      )}
                    </span>
                  </div>
                </StaggerItem>
              ))}
            </Stagger>
            {data && !sources.length && <p className="px-4 py-6 text-[12px] text-fg-tertiary">No sources yet. Add Gmail or Slack, or paste a note.</p>}
          </div>

          <p className="eyebrow mt-8 mb-3">Add knowledge directly</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              { icon: FileText, title: "Paste notes or a transcript", body: "Meeting notes, call transcripts, brainstorms. Bracket extracts decisions, requirements and commitments.", cta: "Add note", on: () => setNote(true) },
              { icon: Upload, title: "Upload files", body: "Briefs, contracts, PDFs, research. Used as context — Bracket isn’t a file store.", cta: "Upload", on: () => setUpload(true) },
            ].map((c) => (
              <motion.div key={c.title} whileHover={{ y: -1 }} transition={T.fast} className="rounded-lg border border-dashed border-line-control p-4">
                <c.icon size={16} className="text-fg-secondary" />
                <p className="mt-3 text-body-m text-fg">{c.title}</p>
                <p className="mt-1 text-[12px] text-fg-tertiary">{c.body}</p>
                <Button size="s" className="mt-3" onClick={c.on} disabled={!canEdit}>{c.cta}</Button>
              </motion.div>
            ))}
          </div>

          <div className="mt-8 mb-3 flex items-center"><p className="eyebrow flex-1">Files · {data?.files?.length ?? 0}</p><Link to={`${base}/files`} className="flex items-center gap-1 text-[12px] font-medium text-fg-secondary hover:text-fg">All files <ChevronRight size={14} /></Link></div>
          <div className="overflow-hidden rounded-lg border border-line divide-y divide-line-subtle">
            {(data?.files || []).slice(0, 2).map((f) => (
              <Link key={f.id} to={`${base}/files/${f.id}`} className="flex items-center gap-3 px-4 py-3 transition-colors duration-fast hover:bg-hover">
                <FileText size={16} className="text-fg-secondary" />
                <span className="min-w-0 flex-1"><span className="block truncate text-[12px] text-fg">{f.name}</span><span className="block text-[12px] text-fg-tertiary">Uploaded {format(new Date(f.added_at), "MMM d")}{f.pages ? ` · ${f.pages} pages` : ""}{f.contributed?.memories ? ` · ${f.contributed.memories} memories referenced` : ""}</span></span>
                <FileStatus f={f} />
              </Link>
            ))}
          </div>
        </div>

        <aside className="space-y-6">
          <div>
            <p className="eyebrow mb-3">Available</p>
            <div className="space-y-2">
              {(data?.connectors || []).map((c) => (
                <div key={c.key} className="flex items-center gap-3 rounded-md border border-line px-3 py-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center">{c.key === "meetings" ? <Mic size={16} className="text-fg-secondary" /> : <span className="flex h-5 w-5 items-center justify-center rounded bg-white/[0.08] text-[10px] font-semibold text-fg-secondary">{c.label[0]}</span>}</span>
                  <span className="min-w-0 flex-1"><span className="block text-[12px] font-medium text-fg">{c.label}</span><span className="block text-[12px] text-fg-tertiary">{c.desc}</span></span>
                  {c.status === "soon" ? <Badge>Soon</Badge> : <Button size="s" variant="ghost" onClick={() => pick(c.key)} disabled={!canEdit}>Connect</Button>}
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-lg border border-line p-4">
            <Lock size={16} className="text-fg-secondary" />
            <p className="mt-3 text-body-m font-medium text-fg">What Bracket can and can’t do</p>
            <ul className="mt-3 space-y-3 text-[12px] text-fg-secondary">
              {["Reads only the threads, channels and files you choose.", "Never sends, edits or deletes anything without your explicit approval.", "Keeps a record of every source it used — visible on each memory.", "Disconnecting stops syncing. You choose whether to keep or remove what was learned."].map((x) => (
                <li key={x} className="flex gap-2"><span aria-hidden="true">•</span>{x}</li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
      <AddSourceDialog open={picker} onOpenChange={setPicker} sources={sources} onPick={pick} />
      <ChooseItemsDialog open={!!choose} onOpenChange={(o) => !o && setChoose(null)} wid={projectId} provider={choose} onDone={() => { setChoose(null); reload(); }} onBack={() => { setChoose(null); setPicker(true); }} />
      <AddNoteDialog open={note} onOpenChange={setNote} wid={projectId} onAdded={() => reload()} />
      <UploadDialog open={upload} onOpenChange={(o) => { setUpload(o); if (!o) reload(); }} wid={projectId} />
    </div>
  );
}

