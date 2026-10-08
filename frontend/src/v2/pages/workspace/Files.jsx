import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Upload, FileText, X, ExternalLink, MoreHorizontal, RefreshCw, Trash2, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { useWorkspace, refreshAll } from "../../lib/workspace";
import { v2 } from "../../lib/api2";
import { useResource } from "../../lib/data";
import { useIsMobile, useMedia } from "../../lib/useMedia";
import { Badge, Button, IconButton, Skeleton } from "../../ui/primitives";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "../../ui/overlays";
import { AnimatePresence, Stagger, StaggerItem, motion, t as T } from "../../ui/motion";
import { MobileSubHeader } from "../../shell/AppShell";
import { ChoiceConfirm, UploadDialog } from "../../features/sources";
import { cn } from "../../../lib/utils";

/* Files — Figma › ✓ Files, Files · Uploading, Files · File detail, Files ·
   Delete file (confirm), Sources & files — states; Files — Mobile 390 frames. */
export function FileStatus({ f }) {
  const map = {
    in_memory: ["neutral", "In memory"], reading: ["info", "Reading…"], not_supported: ["danger", "Not supported"],
    failed: ["danger", "Couldn’t read"], too_large: ["danger", "Too large"], nothing_new: ["success", "Nothing new found"],
  };
  const [tone, label] = map[f.status] || map.in_memory;
  return <Badge tone={tone} dot>{label}</Badge>;
}
const contributed = (f) => {
  if (f.status === "reading") return f.progress ? `Reading ${f.progress.done} of ${f.progress.total} pages…` : `Reading ${f.pages} pages…`;
  if (f.reason) return f.reason;
  if (f.contributed?.note) return f.contributed.note;
  if (f.contributed?.memories) return `${f.contributed.memories} memories · ${f.contributed.categories.join(", ")}`;
  return "—";
};

export default function Files() {
  const { fid } = useParams();
  const [params, setParams] = useSearchParams();
  const { projectId, canEdit } = useWorkspace();
  const mobile = useIsMobile();
  const docked = useMedia("(min-width: 1280px)");
  const navigate = useNavigate();
  const base = `/w/${projectId}`;
  const { data, reload } = useResource(() => v2.files(projectId), [projectId]);
  const [upload, setUpload] = useState(false);
  const [dropped, setDropped] = useState(null);
  const [drag, setDrag] = useState(false);
  const [del, setDel] = useState(null);
  const [uploading, setUploading] = useState([]);
  const fileRef = useRef(null);

  useEffect(() => { if (params.get("upload") === "1") { setUpload(true); setParams({}, { replace: true }); } }, [params, setParams]);
  useEffect(() => {
    if (!data?.files?.some((f) => f.status === "reading")) return undefined;
    const id = setInterval(reload, 1200);
    return () => clearInterval(id);
  }, [data, reload]);

  const files = data?.files || [];
  const open = (id) => navigate(`${base}/files/${id}`);
  const close = () => navigate(`${base}/files`);
  const onDrop = (e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files?.length && canEdit) { setDropped(e.dataTransfer.files); setUpload(true); } };
  const askDelete = async (id) => { const f = await v2.file(projectId, id); setDel(f); };

  const confirmDelete = (
      <ChoiceConfirm open={!!del} onOpenChange={(o) => !o && setDel(null)} title="Delete this file?" cta="Delete file"
        mobileIntro={del && `${del.name} is removed from Bracket. Memories only this file supports are removed too.`}
        mobileOptions={del?.impact.total ? [{ value: true, label: "Keep what Bracket learned", help: `${del.impact.total} memories stay, marked “file deleted”.` }, { value: false, label: "Remove its memories", help: `${del.impact.only_here} removed; ${del.impact.supported_elsewhere} supported elsewhere stay.` }] : undefined}
        intro={del && (del.impact.total ? `${del.name} contributed ${del.impact.total} memories. ${del.impact.supported_elsewhere} are also supported by email or notes.` : `${del.name} didn’t contribute any memories.`)}
        options={del?.impact.total ? [
          { value: true, label: "Delete the file, keep memories", help: `The ${del.impact.only_here} memories only it supported are marked “source removed”.` },
          { value: false, label: `Delete the file and those ${del.impact.only_here} memories`, help: "Recorded in Timeline · restorable for 30 days." },
        ] : [{ value: true, label: "Delete the file", help: "Nothing in memory changes." }]}
        onConfirm={async (keep) => { await v2.deleteFile(projectId, del.id, keep); setDel(null); refreshAll(); reload(); if (fid) close(); toast(`Deleted ${del.name}`); }} />
  );
  /* Mobile — Figma › Files — Mobile 390 (112:5941), Uploading (147:1299), File detail (147:1205), Delete file (147:1349). */
  if (mobile) {
    const meta = (f) => (f.status === "in_memory" ? `${f.contributed?.memories || 0} memories` : f.status === "reading" ? "Reading…" : f.status === "not_supported" ? "Add a transcript instead" : contributed(f));
    const pick = (list) => {
      [...list].forEach((file) => {
        const key = `${file.name}-${Date.now()}`;
        setUploading((u) => [{ key, name: file.name, size: file.size, pct: 0 }, ...u]);
        const tick = setInterval(() => setUploading((u) => u.map((x) => (x.key === key ? { ...x, pct: Math.min(96, x.pct + 9) } : x))), 120);
        v2.uploadFile(projectId, { name: file.name, size: file.size }).finally(() => {
          clearInterval(tick);
          setUploading((u) => u.map((x) => (x.key === key ? { ...x, pct: 100 } : x)));
          setTimeout(() => { setUploading((u) => u.filter((x) => x.key !== key)); reload(); refreshAll(); }, 400);
        });
      });
    };
    const mb = (n) => `${(n / 1e6).toFixed(1)}`;
    return (
      <div className="flex h-full flex-col">
        {fid ? <FileDetail wid={projectId} fid={fid} onClose={close} mobile canEdit={canEdit} onDelete={askDelete} /> : (
          <>
            <MobileSubHeader title="Files" onBack={() => navigate(`${base}/sources`)} />
            <div className="scroll-pane min-h-0 flex-1 pb-6">
              <div className="px-4 pt-4">
                <Button size="l" className="h-12 w-full" icon={Upload} disabled={!canEdit} onClick={() => fileRef.current?.click()}>Upload a file</Button>
                <input ref={fileRef} type="file" multiple hidden onChange={(e) => { if (e.target.files?.length) pick(e.target.files); e.target.value = ""; }} />
              </div>
              <AnimatePresence initial={false}>
                {uploading.map((u) => (
                  <motion.div key={u.key} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={T.base} className="overflow-hidden px-0 pt-3">
                    <div className="border-y border-line-subtle bg-surface px-4 py-3">
                      <p className="flex items-center gap-3 text-body-m text-fg"><Upload size={16} className="text-fg-secondary" /><span className="min-w-0 flex-1 truncate">{u.name}</span><span className="font-mono text-[12px] text-fg-secondary">{u.pct}%</span></p>
                      <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/10"><motion.div className="h-full rounded-full bg-fg" animate={{ width: `${u.pct}%` }} transition={{ duration: 0.12 }} /></div>
                      <p className="mt-2 text-body-s text-fg-tertiary">Uploading · {mb((u.size * u.pct) / 100)} of {mb(u.size)} MB · Bracket reads it after upload</p>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
              {!data ? <div className="space-y-3 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div> : (
                <Stagger as="ul" className="mt-3 border-t border-line-subtle">
                  {files.map((f) => (
                    <StaggerItem as="li" key={f.id} className="border-b border-line-subtle">
                      <button onClick={() => open(f.id)} className="flex min-h-[68px] w-full items-center gap-3 px-4 py-3 text-left active:bg-hover">
                        <FileText size={16} className="shrink-0 text-fg-secondary" />
                        <span className="min-w-0 flex-1"><span className="block truncate text-body-s text-fg">{f.name}</span><span className="block text-body-s text-fg-tertiary">{meta(f)}</span></span>
                        <FileStatus f={f} />
                      </button>
                    </StaggerItem>
                  ))}
                  {!files.length && <li className="px-4 py-6 text-[12px] text-fg-tertiary">No files yet. Upload a proposal, SOW or contract and Bracket will use it as context.</li>}
                </Stagger>
              )}
            </div>
          </>
        )}
        {confirmDelete}
      </div>
    );
  }


  return (
    <div className="flex h-full" onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}>
      <div className="scroll-pane min-w-0 flex-1">
        <div className="mx-auto max-w-[1600px] px-4 pt-4 pb-12 md:px-8 md:pt-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-title-l text-fg">Files</h1>
              <p className="mt-1 text-[12px] text-fg-tertiary">Briefs, contracts and documents Bracket uses as context. Files stay yours — Bracket keeps what it learned and a link back.</p>
            </div>
            <Button variant="primary" icon={Upload} onClick={() => setUpload(true)} disabled={!canEdit}>Upload</Button>
          </div>
          <motion.button onClick={() => fileRef.current?.click()} disabled={!canEdit} animate={{ borderColor: drag ? "rgba(247,248,248,0.8)" : "rgba(255,255,255,0.14)", backgroundColor: drag ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0)" }} transition={T.fast}
            className="mt-5 flex w-full items-center gap-3 rounded-lg border border-dashed px-4 py-4 text-left text-[12px] text-fg-secondary">
            <Upload size={16} /> {drag ? "Drop to upload" : "Drop files here — PDF, DOCX, TXT, images · up to 50 MB each"}
          </motion.button>
          <input ref={fileRef} type="file" multiple hidden onChange={(e) => { if (e.target.files?.length) { setDropped(e.target.files); setUpload(true); } }} />

          <div className="mt-5 overflow-hidden rounded-lg border border-line">
            {!mobile && (
              <div className={cn("grid gap-4 border-b border-line-subtle px-4 py-3 eyebrow", fid && !docked ? "grid-cols-[minmax(0,1fr)_120px_40px]" : fid ? "grid-cols-[minmax(0,1fr)_120px]" : "grid-cols-[minmax(0,1.4fr)_120px_minmax(0,1fr)_130px_40px]")}>
                <span>Name</span><span>Added</span>{!fid && <><span>Contributed</span><span>Status</span><span /></>}
              </div>
            )}
            {!data ? <div className="p-4 space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-5 w-full" />)}</div> : (
              <Stagger>
                {files.map((f) => (
                  <StaggerItem key={f.id} className="border-b border-line-subtle last:border-0">
                    <div className={cn("grid cursor-pointer items-center gap-4 px-4 py-3 transition-colors duration-fast", fid === f.id ? "bg-surface" : "hover:bg-hover",
                      mobile ? "grid-cols-[minmax(0,1fr)_auto]" : fid ? "grid-cols-[minmax(0,1fr)_120px]" : "grid-cols-[minmax(0,1.4fr)_120px_minmax(0,1fr)_130px_40px]")}
                      onClick={() => open(f.id)} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && open(f.id)} aria-current={fid === f.id ? "true" : undefined}>
                      <span className="flex min-w-0 items-center gap-3"><FileText size={16} className="shrink-0 text-fg-secondary" /><span className="min-w-0"><span className="block truncate text-[12px] text-fg">{f.name}</span>{mobile && <span className="block text-[12px] text-fg-tertiary">{contributed(f)}</span>}</span></span>
                      {mobile ? <FileStatus f={f} /> : (
                        <>
                          <span className="text-[12px] text-fg-tertiary">{format(new Date(f.added_at), "MMM d")} · {f.added_by}</span>
                          {!fid && <span className={cn("text-[12px]", ["not_supported", "failed", "too_large"].includes(f.status) ? "text-fg-tertiary" : "text-fg-tertiary")}>{contributed(f)}</span>}
                          {!fid && <span><FileStatus f={f} /></span>}
                          {!fid && (
                            <span onClick={(e) => e.stopPropagation()}>
                              <Menu>
                                <MenuTrigger asChild><button aria-label={`${f.name} options`} className="flex h-7 w-7 items-center justify-center rounded-md bg-white/[0.04] text-fg-secondary hover:bg-white/[0.08] hover:text-fg"><MoreHorizontal size={16} /></button></MenuTrigger>
                                <MenuContent>
                                  <MenuItem icon={ExternalLink} onSelect={() => open(f.id)}>Open details</MenuItem>
                                  <MenuItem icon={RefreshCw} disabled={!canEdit} onSelect={async () => { await v2.replaceFile(projectId, f.id, {}); reload(); toast("Reading the new version…"); }}>Replace</MenuItem>
                                  <MenuSeparator />
                                  <MenuItem icon={Trash2} danger disabled={!canEdit} onSelect={() => askDelete(f.id)}>Delete</MenuItem>
                                </MenuContent>
                              </Menu>
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </StaggerItem>
                ))}
                {!files.length && <p className="px-4 py-6 text-[12px] text-fg-tertiary">No files yet. Upload a proposal, SOW or contract and Bracket will use it as context.</p>}
              </Stagger>
            )}
          </div>
        </div>
      </div>
      <AnimatePresence initial={false}>
        {fid && !mobile && (
          <motion.aside key="file" initial={{ x: 32, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 32, opacity: 0 }} transition={T.base}
            className={cn("flex h-full w-[400px] shrink-0 flex-col border-l border-line bg-sidebar", !docked && "fixed right-0 top-0 bottom-0 z-40 shadow-overlay")} aria-label="File detail">
            <FileDetail wid={projectId} fid={fid} onClose={close} canEdit={canEdit} onDelete={askDelete} />
          </motion.aside>
        )}
      </AnimatePresence>
      <UploadDialog open={upload} onOpenChange={(o) => { setUpload(o); if (!o) { setDropped(null); reload(); } }} wid={projectId} initialFiles={dropped} />
      {confirmDelete}
    </div>
  );
}

function FileDetail({ wid, fid, onClose, mobile, canEdit, onDelete }) {
  const { data: f } = useResource(() => v2.file(wid, fid), [wid, fid]);
  const navigate = useNavigate();
  const [all, setAll] = useState(false);
  const mems = f?.memories || [];
  return (
    <div className="flex h-full flex-col">
      {mobile ? <MobileSubHeader title="File" onBack={onClose} /> : (
        <div className="flex h-14 shrink-0 items-center gap-1 border-b border-line-subtle pl-6 pr-3">
          <p className="eyebrow flex-1">File</p>
          <IconButton icon={MoreHorizontal} label="More" />
          <IconButton icon={X} label="Close (Esc)" onClick={onClose} />
        </div>
      )}
      {mobile ? (
        <>
          <div className="scroll-pane min-h-0 flex-1 px-4 py-4">
            {!f ? <Skeleton className="h-32 w-full rounded-lg" /> : (
              <motion.div key={f.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={T.base}>
                <div className="flex items-start gap-3">
                  <FileText size={18} className="mt-0.5 shrink-0 text-fg-secondary" />
                  <div className="min-w-0 flex-1"><p className="break-all text-body-m text-fg">{f.name}</p><p className="text-body-s text-fg-tertiary">{(f.name.split(".").pop() || "").toUpperCase()}{f.pages ? ` · ${f.pages} pages` : ""} · uploaded by {f.added_by} · {format(new Date(f.added_at), "MMM d")}</p></div>
                  <span className="shrink-0">{f.status === "in_memory" ? <Badge tone="success" dot>In memory</Badge> : <FileStatus f={f} />}</span>
                </div>
                {f.status === "in_memory" ? (
                  <>
                    <p className="eyebrow mt-5 mb-3">Bracket learned · {f.contributed?.memories || mems.length}</p>
                    <ul className="overflow-hidden rounded-lg border border-line divide-y divide-line-subtle">
                      {(all ? mems : mems.slice(0, 4)).map((m) => (
                        <li key={m.id}>
                          <button onClick={() => navigate(`/w/${wid}/memory?item=${m.id}`)} className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-hover">
                            <span className="min-w-0 flex-1"><span className="block text-body-m text-fg">{m.text}</span><span className="block text-body-s text-fg-tertiary">{m.category}{m.page ? ` · page ${m.page}` : ""}</span></span>
                            <ChevronRight size={16} className="text-fg-tertiary" />
                          </button>
                        </li>
                      ))}
                    </ul>
                    {mems.length > 4 && <button onClick={() => setAll((x) => !x)} className="mt-3 text-body-s text-fg-tertiary">{all ? "Show less" : `+${mems.length - 4} more`}</button>}
                  </>
                ) : <p className="mt-4 text-body-s text-fg-secondary">{contributed(f)}</p>}
              </motion.div>
            )}
          </div>
          {f && (
            <div className="flex shrink-0 gap-3 border-t border-line-subtle px-4 pt-3 pb-3 safe-bottom">
              <Button size="l" className="flex-1" disabled={!canEdit} onClick={async () => { await v2.replaceFile(wid, f.id, {}); toast("Reading the new version…"); }}>Replace file</Button>
              <Button size="l" variant="danger" className="flex-1" disabled={!canEdit} onClick={() => onDelete(f.id)}>Delete</Button>
            </div>
          )}
        </>
      ) : (
      <div className="scroll-pane min-h-0 flex-1 px-4 py-5 md:px-6">
        {!f ? <Skeleton className="h-32 w-full rounded-lg" /> : (
          <motion.div key={f.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={T.base} className="space-y-5">
            <div>
              <h2 className="break-all text-title-m text-fg">{f.name}</h2>
              <p className="mt-2 text-[12px] text-fg-tertiary">{f.pages ? `${f.pages} pages · ` : ""}uploaded {format(new Date(f.added_at), "MMM d")} by {f.added_by === "Maya" ? "Maya Rao" : f.added_by}</p>
            </div>
            {f.status !== "in_memory" ? (
              <div className="rounded-lg border border-line p-4"><FileStatus f={f} /><p className="mt-2 text-[12px] text-fg-secondary">{contributed(f)}</p></div>
            ) : (
              <section>
                <p className="eyebrow mb-3">Contributed {f.contributed?.memories || mems.length} memories</p>
                <div className="space-y-3">
                  {(all ? mems : mems.slice(0, 4)).map((m) => (
                    <button key={m.id} onClick={() => navigate(`/w/${wid}/memory?item=${m.id}`)} className="block w-full border-l border-line pl-3 text-left hover:border-fg">
                      <span className="block text-[12px] text-fg-tertiary">{m.category}</span><span className="block text-[12px] text-fg">{m.text}</span>
                    </button>
                  ))}
                </div>
                {mems.length > 4 && <button onClick={() => setAll((a) => !a)} className="mt-3 text-[12px] text-fg-secondary hover:text-fg">{all ? "Show less" : `+${mems.length - 4} more`}</button>}
              </section>
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="s" icon={ExternalLink} onClick={() => toast("Opening the original file…")}>Open file</Button>
              <Button size="s" disabled={!canEdit} onClick={async () => { await v2.replaceFile(wid, f.id, {}); toast("Reading the new version…"); }}>Replace</Button>
              <Button size="s" variant="danger" disabled={!canEdit} onClick={() => onDelete(f.id)}>Delete</Button>
            </div>
          </motion.div>
        )}
      </div>
      )}
    </div>
  );
}
