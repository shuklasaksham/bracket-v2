import React, { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Search, Check, Lock, Loader2, Link2, ExternalLink, AlertTriangle, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError, isPaywall } from "../lib/data";
import { Badge, Button, Card, Checkbox, EmptyState, Input, SourceMark, Spinner } from "../ui/primitives";
import { cn } from "../../lib/utils";

/* Connect flow — shared by "Add source" (inside a workspace) and the
   "New workspace" / first-run page.
   1 provider → 2 OAuth (popup) → 3 choose sources → 4 preview → 5 establish
   GET /connect/providers · GET /connect/:p/auth-url · GET /connect/:p/sources
   POST /connect/preview · POST /connect/establish                            */

export function useOAuthConnect() {
  const [waiting, setWaiting] = useState(null);
  const connect = useCallback((provider) => new Promise((resolve, reject) => {
    const popup = window.open("about:blank", "bracket-oauth", "width=560,height=700");
    setWaiting(provider);
    let done = false;
    const finish = (ok, err) => {
      if (done) return;
      done = true;
      window.removeEventListener("message", onMsg);
      clearInterval(poll);
      setWaiting(null);
      ok ? resolve(true) : reject(err || new Error("cancelled"));
    };
    const onMsg = (e) => {
      if (typeof e.data !== "string" || !e.data.startsWith(`bracket-oauth:${provider}:`)) return;
      e.data.endsWith(":ok") ? finish(true) : finish(false, new Error("Authorization was cancelled."));
    };
    window.addEventListener("message", onMsg);
    // Cross-origin fallback: when the popup closes, verify by listing sources.
    const poll = setInterval(async () => {
      if (popup && popup.closed) {
        clearInterval(poll);
        try { await api.get(`/connect/${provider}/sources`); finish(true); } catch { finish(false, new Error("cancelled")); }
      }
    }, 700);
    api.get(`/connect/${provider}/auth-url`)
      .then(({ data }) => { if (popup) popup.location = data.url; else window.open(data.url, "_blank"); })
      .catch((e) => { try { popup?.close(); } catch { /* */ } finish(false, new Error(formatApiError(e))); });
  }), []);
  return { connect, waiting };
}

export function ConnectFlow({ projectId, mode = "existing", onDone, onCancel, initialProvider }) {
  const [step, setStep] = useState(initialProvider ? "sources" : "provider");
  const [providers, setProviders] = useState(null);
  const [provider, setProvider] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const { connect, waiting } = useOAuthConnect();

  const loadProviders = useCallback(async () => {
    const { data } = await api.get("/connect/providers");
    setProviders(data);
    return data;
  }, []);
  useEffect(() => {
    loadProviders().then((d) => {
      if (initialProvider) {
        const p = d.providers.find((x) => x.key === initialProvider);
        if (p) choose(p, d);
      }
    }).catch(() => setProviders({ providers: [], categories: [] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const choose = async (p) => {
    if (p.status === "coming_soon" || p.status === "setup_required") return;
    if (p.status !== "connected") {
      try {
        await connect(p.key);
        toast.success(`${p.label} connected`);
        await loadProviders();
      } catch (e) {
        if (e.message !== "cancelled") toast.error(e.message);
        return;
      }
    }
    setProvider(p);
    setStep("sources");
  };

  const runPreview = async (sources) => {
    setBusy(true);
    try {
      const { data } = await api.post("/connect/preview", { provider: provider.key, sources });
      setPreview(data);
      setStep("preview");
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusy(false);
    }
  };

  const establish = async (target) => {
    setBusy(true);
    try {
      const body = target === "new" ? { preview_id: preview.preview_id, mode: "new" } : { preview_id: preview.preview_id, mode: "existing", project_id: target };
      const { data } = await api.post("/connect/establish", body);
      toast.success(`Connected — Bracket learned ${data.memory_count} thing${data.memory_count === 1 ? "" : "s"}`);
      onDone?.(data);
    } catch (e) {
      if (isPaywall(e)) toast.error(formatApiError(e), { description: "Archive a finished workspace, or change plan in Settings → Billing." });
      else toast.error(formatApiError(e));
    } finally {
      setBusy(false);
    }
  };

  if (step === "provider") {
    return <ProviderPicker providers={providers} onChoose={choose} waiting={waiting} onCancel={onCancel} />;
  }
  if (step === "sources" && provider) {
    return <SourcePicker provider={provider} onBack={() => setStep("provider")} onNext={runPreview} busy={busy} />;
  }
  if (step === "preview" && preview) {
    return <PreviewStep preview={preview} provider={provider} mode={mode} projectId={projectId} busy={busy} onBack={() => setStep("sources")} onConfirm={establish} />;
  }
  return <div className="flex justify-center py-12"><Spinner /></div>;
}

function ProviderPicker({ providers, onChoose, waiting, onCancel }) {
  if (!providers) return <div className="flex justify-center py-12"><Spinner /></div>;
  const cats = providers.categories?.length ? providers.categories : [...new Set(providers.providers.map((p) => p.category))];
  return (
    <div>
      <p className="mb-4 text-body-s text-fg-tertiary flex items-center gap-1.5"><Lock size={13} /> Bracket only reads what you choose in the next step. It never posts without you.</p>
      {cats.map((c) => {
        const list = providers.providers.filter((p) => p.category === c);
        if (!list.length) return null;
        return (
          <div key={c} className="mb-5">
            <p className="eyebrow mb-2">{c}</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {list.map((p) => {
                const disabled = p.status === "coming_soon" || p.status === "setup_required";
                return (
                  <button key={p.key} disabled={disabled} onClick={() => onChoose(p)}
                    className={cn("flex items-center gap-3 rounded-lg border border-line px-3 py-3 text-left transition-colors", disabled ? "opacity-50 cursor-not-allowed" : "hover:border-line-strong hover:bg-hover")}>
                    <SourceMark provider={p.key} size={20} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-body-m text-fg">{p.label}</span>
                      <span className="block truncate text-body-s text-fg-tertiary">
                        {p.status === "connected" ? (p.account_label || "Connected") : p.status === "coming_soon" ? "Coming soon" : p.status === "setup_required" ? "Not configured yet" : p.desc}
                      </span>
                    </span>
                    {waiting === p.key ? <Loader2 size={15} className="animate-spin text-fg-tertiary" /> : p.status === "connected" ? <Badge tone="success" dot>Connected</Badge> : null}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      {waiting && <p className="text-body-s text-fg-tertiary" role="status">Finish signing in to {waiting} in the window that opened…</p>}
      {onCancel && <div className="mt-2 flex justify-end"><Button variant="ghost" onClick={onCancel}>Cancel</Button></div>}
    </div>
  );
}

function SourcePicker({ provider, onBack, onNext, busy }) {
  const [q, setQ] = useState("");
  const [url, setUrl] = useState("");
  const [list, setList] = useState(null);
  const [err, setErr] = useState("");
  const [picked, setPicked] = useState(new Map());
  const t = useRef(null);
  const max = 5;
  const load = useCallback(async (query, link) => {
    setErr("");
    try {
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      if (link) params.set("url", link);
      const { data } = await api.get(`/connect/${provider.key}/sources?${params}`);
      setList(data.sources || []);
    } catch (e) {
      setErr(formatApiError(e));
      setList([]);
    }
  }, [provider.key]);
  useEffect(() => { load("", ""); }, [load]);
  const onQ = (v) => { setQ(v); clearTimeout(t.current); t.current = setTimeout(() => load(v, url), 350); };
  const toggle = (s) => setPicked((m) => {
    const n = new Map(m);
    if (n.has(s.id)) n.delete(s.id);
    else if (n.size < max) n.set(s.id, { id: s.id, name: s.name, url: s.url || "" });
    else toast(`Pick up to ${max} at a time.`);
    return n;
  });
  return (
    <div>
      <button onClick={onBack} className="mb-3 inline-flex items-center gap-1.5 text-body-s text-fg-tertiary hover:text-fg"><ArrowLeft size={14} /> All tools</button>
      <div className="flex items-center gap-2.5">
        <SourceMark provider={provider.key} size={20} />
        <div className="min-w-0">
          <p className="text-title-m">{provider.label}</p>
          <p className="text-body-s text-fg-tertiary truncate">{provider.account_label ? `Signed in as ${provider.account_label} · ` : ""}{provider.select_hint}</p>
        </div>
      </div>
      {provider.select_mode === "figma" && (
        <div className="mt-4 flex gap-2">
          <div className="relative flex-1">
            <Link2 size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-tertiary" />
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste a Figma file or team link" className="pl-8" aria-label="Figma link" />
          </div>
          <Button onClick={() => load(q, url)}>Find</Button>
        </div>
      )}
      <div className="relative mt-3">
        <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-tertiary" />
        <Input value={q} onChange={(e) => onQ(e.target.value)} placeholder={`Search ${provider.label}`} className="pl-8" aria-label={`Search ${provider.label}`} />
      </div>
      <div className="mt-3 max-h-[46vh] overflow-y-auto rounded-lg border border-line">
        {list === null ? <div className="flex justify-center py-10"><Spinner /></div> : err ? (
          <div className="px-4 py-6 text-center">
            <AlertTriangle size={16} className="mx-auto text-warning" />
            <p className="mt-2 text-body-s text-fg-secondary">{err}</p>
          </div>
        ) : list.length === 0 ? (
          <p className="px-4 py-8 text-center text-body-s text-fg-tertiary">Nothing found. Try another search.</p>
        ) : list.map((s) => (
          <label key={s.id} htmlFor={`src-${s.id}`} className="flex cursor-pointer items-start gap-3 border-b border-line-subtle px-3 py-2.5 last:border-0 hover:bg-hover">
            <Checkbox id={`src-${s.id}`} checked={picked.has(s.id)} onChange={() => toggle(s)} label={s.name} className="mt-0.5" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body-m text-fg">{s.name}</span>
              <span className="block truncate text-body-s text-fg-tertiary">{[s.meta?.detail, s.meta?.extra, s.meta?.updated].filter(Boolean).join(" · ")}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-body-s text-fg-tertiary">{picked.size ? `${picked.size} selected` : "Choose what Bracket should read"}</p>
        <Button variant="primary" disabled={!picked.size} loading={busy} onClick={() => onNext([...picked.values()])}>
          {busy ? "Reading…" : `Continue with ${picked.size || ""}`.trim()}
        </Button>
      </div>
      {busy && <p className="mt-2 text-right text-body-s text-fg-tertiary" role="status">Bracket is reading these and extracting scope, decisions and deadlines…</p>}
    </div>
  );
}

const COUNT_LABELS = { requirements: "Requirements", decisions: "Decisions", deliverables: "Deliverables", deadlines: "Deadlines", open_questions: "Open questions" };

function PreviewStep({ preview, provider, mode, projectId, busy, onBack, onConfirm }) {
  const [target, setTarget] = useState(mode === "existing" && projectId ? projectId : preview.match?.id || "new");
  const total = Object.values(preview.counts || {}).reduce((a, b) => a + b, 0);
  return (
    <div>
      <button onClick={onBack} className="mb-3 inline-flex items-center gap-1.5 text-body-s text-fg-tertiary hover:text-fg"><ArrowLeft size={14} /> Change selection</button>
      <div className="flex items-center gap-2 text-body-s text-fg-tertiary"><Sparkles size={14} /> Bracket read {preview.sources.length} source{preview.sources.length > 1 ? "s" : ""}{preview.failed ? ` · ${preview.failed} couldn’t be read` : ""}</div>
      <p className="mt-1 text-title-l">{preview.project?.name || "What Bracket found"}</p>
      {preview.project?.client && <p className="text-body-m text-fg-tertiary">{preview.project.client}</p>}
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {Object.entries(COUNT_LABELS).map(([k, l]) => (
          <Card key={k} className="px-3 py-2.5">
            <p className="num text-title-l">{preview.counts?.[k] || 0}</p>
            <p className="text-body-s text-fg-tertiary">{l}</p>
          </Card>
        ))}
      </div>
      {total > 0 && (
        <div className="mt-4 max-h-[26vh] overflow-y-auto rounded-lg border border-line p-3">
          {Object.entries(preview.items || {}).filter(([, v]) => v?.length).map(([k, v]) => (
            <div key={k} className="mb-3 last:mb-0">
              <p className="eyebrow mb-1">{COUNT_LABELS[k]}</p>
              <ul className="space-y-1">{v.map((it, i) => <li key={i} className="text-body-m text-fg-secondary">· {it.title}</li>)}</ul>
            </div>
          ))}
        </div>
      )}
      {mode !== "existing" && (
        <fieldset className="mt-5">
          <legend className="eyebrow mb-2">Add to</legend>
          <div className="space-y-2">
            {preview.match && (
              <RadioRow checked={target === preview.match.id} onChange={() => setTarget(preview.match.id)} title={preview.match.name} desc={`Looks like your existing workspace (${preview.match.confidence}% match) — ${preview.match.reason || "same client and topic"}`} />
            )}
            <RadioRow checked={target === "new"} onChange={() => setTarget("new")} title="A new workspace" desc={`“${preview.project?.name || "New workspace"}” — counts toward your plan’s active projects`} />
          </div>
        </fieldset>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="primary" loading={busy} onClick={() => onConfirm(target)}>{mode === "existing" ? "Add to this workspace" : target === "new" ? "Create workspace" : "Add to workspace"}</Button>
      </div>
    </div>
  );
}

function RadioRow({ checked, onChange, title, desc }) {
  return (
    <label className={cn("flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3", checked ? "border-fg-secondary bg-hover" : "border-line hover:border-line-strong")}>
      <input type="radio" checked={checked} onChange={onChange} className="mt-1 h-4 w-4 accent-white" />
      <span className="min-w-0">
        <span className="block text-body-m text-fg">{title}</span>
        <span className="block text-body-s text-fg-tertiary">{desc}</span>
      </span>
    </label>
  );
}
