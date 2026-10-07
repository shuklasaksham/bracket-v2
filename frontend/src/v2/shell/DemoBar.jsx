import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Play, RotateCcw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "../lib/data";
import { useWorkspace } from "../lib/workspace";
import { Button } from "../ui/primitives";

/* Demo workspace controls (POST /demo/simulate/next, /demo/reset).
   Only renders inside the seeded demo workspace. */
export default function DemoBar() {
  const ws = useWorkspaceSafe();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(null);
  if (!ws?.project?.is_demo) return null;
  const next = async () => {
    setBusy("next");
    try {
      const { data } = await api.post("/demo/simulate/next");
      if (data?.beat) toast.success(data.beat.summary || "A new client message just arrived.", { description: data.done ? "That was the last message — reset to replay, or connect your real work." : `Message ${data.step} of ${data.total}` });
      else if (data?.done) toast("That’s the whole demo. Reset to replay it, or connect your real work.");
      await ws.refresh();
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusy(null);
    }
  };
  const reset = async () => {
    setBusy("reset");
    try {
      const { data } = await api.post("/demo/reset");
      toast.success("Demo reset");
      navigate(`/w/${data.project_id}`, { replace: true });
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-line-subtle bg-surface px-4 py-2" role="region" aria-label="Demo controls">
      <Sparkles size={14} className="text-fg-tertiary shrink-0" />
      <p className="flex-1 truncate text-body-s text-fg-secondary">
        <span className="text-fg">Demo workspace.</span> <span className="hidden sm:inline">Nothing here touches your real accounts.</span>
      </p>
      <Button size="s" variant="secondary" icon={Play} loading={busy === "next"} onClick={next}>Simulate next message</Button>
      <Button size="s" variant="ghost" icon={RotateCcw} loading={busy === "reset"} onClick={reset} className="hidden sm:inline-flex">Reset</Button>
      <Button size="s" variant="primary" onClick={() => navigate("/connect?new=1")} className="hidden md:inline-flex">Connect real work</Button>
    </div>
  );
}

function useWorkspaceSafe() {
  try {
    return useWorkspace();
  } catch {
    return null;
  }
}
