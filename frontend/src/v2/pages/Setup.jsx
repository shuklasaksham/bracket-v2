import React, { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Sparkles, Plug, Check } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "../lib/data";
import { fetchProjects } from "../lib/workspace";
import { Banner, Button, Card } from "../ui/primitives";
import { Logo } from "../shell/Logo";
import { Seo } from "../shell/Seo";
import { ConnectFlow } from "../features/connect";

/* /welcome — first-run (no workspaces yet) and /connect — new workspace.
   Connecting a source with mode "new" creates the workspace (project). */
export default function Setup({ first = false }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [quota, setQuota] = useState(null);
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState(!first || params.get("tool"));
  useEffect(() => { api.get("/project-quota").then(({ data }) => setQuota(data)).catch(() => {}); }, []);

  const openDemo = async () => {
    setBusy(true);
    try {
      const { data } = await api.post("/demo/open");
      await fetchProjects(true);
      navigate(`/w/${data.project_id}`);
    } catch (e) { toast.error(formatApiError(e)); } finally { setBusy(false); }
  };
  const done = async (data) => {
    await fetchProjects(true);
    navigate(`/w/${data.project_id}`, { replace: true });
  };
  const atLimit = quota && quota.can_create === false;

  return (
    <div className="bk min-h-[100dvh] bg-app">
      <Seo title={first ? "Set up your first workspace" : "New workspace"} />
      <header className="flex h-16 items-center justify-between px-5 md:px-8">
        <Logo to="/app" />
        {!first && <Link to="/app" className="inline-flex items-center gap-1.5 text-body-s text-fg-tertiary hover:text-fg"><ArrowLeft size={14} /> Back to Bracket</Link>}
      </header>
      <main className="mx-auto max-w-[760px] px-4 pb-16 pt-4 md:pt-10">
        {first && <p className="eyebrow">Step 2 of 2</p>}
        <h1 className="mt-2 text-display-s">{first ? "Set up your first workspace" : "New workspace"}</h1>
        <p className="mt-2 text-body-l text-fg-tertiary">A workspace is one client, project or business. Connect the conversations about it — Bracket reads only what you pick, and builds the memory.</p>

        {atLimit && (
          <Banner tone="warning" className="mt-6" title={quota.plan_expired ? "Your plan has ended" : `You’re using all ${quota.limit} active workspaces`}
            action={<Button size="s" variant="primary" onClick={() => navigate(quota.plan_expired ? "/plan" : "/settings/workspaces")}>{quota.plan_expired ? "Choose a plan" : "Manage workspaces"}</Button>}>
            {quota.plan_expired ? "Renew to create new workspaces. Existing memory stays readable." : "Archive a finished workspace, or change plan, to add another."}
          </Banner>
        )}

        {!started ? (
          <div className="mt-8 grid gap-3 md:grid-cols-2">
            <button onClick={() => setStarted(true)} disabled={atLimit} className="rounded-xl border border-line bg-surface p-5 text-left hover:border-line-strong disabled:opacity-50">
              <Plug size={18} className="text-fg-secondary" />
              <p className="mt-4 text-title-m">Connect your work</p>
              <p className="mt-1 text-body-m text-fg-tertiary">Gmail threads, Slack channels, Figma files, GitHub repos or Notion pages.</p>
            </button>
            <button onClick={openDemo} disabled={busy} className="rounded-xl border border-line bg-surface p-5 text-left hover:border-line-strong">
              <Sparkles size={18} className="text-fg-secondary" />
              <p className="mt-4 text-title-m">Try a demo workspace</p>
              <p className="mt-1 text-body-m text-fg-tertiary">A sample client project you can play with. Simulate client messages and see Bracket react — nothing touches your accounts.</p>
            </button>
          </div>
        ) : (
          <Card className="mt-8 p-5 md:p-6">
            <ConnectFlow mode="new" onDone={done} initialProvider={params.get("tool") || undefined} onCancel={first ? () => setStarted(false) : undefined} />
          </Card>
        )}

        <ul className="mt-10 grid gap-3 text-body-s text-fg-tertiary sm:grid-cols-3">
          {["Reads only the threads and channels you choose", "Never sends, edits or deletes without you", "Every memory links to the message it came from"].map((t) => (
            <li key={t} className="flex gap-2"><Check size={14} className="mt-0.5 shrink-0 text-success" />{t}</li>
          ))}
        </ul>
      </main>
    </div>
  );
}
