import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../../lib/AuthContext";
import { api, formatApiError } from "../lib/data";
import { SANDBOX_LOCKED_MESSAGE } from "../../lib/api";
import { refreshAll, fetchProjects } from "../lib/workspace";
import { loadBilling } from "../lib/account";
import { Button } from "../ui/primitives";
import { Dialog } from "../ui/overlays";
import Tour from "./Tour";

/* Sandbox — Figma › 12 Sandbox. A guest session on the seeded Acme Finance
   project: no sign-up, nothing connected, nothing paid. This provider owns the
   session (start / play next message / reset / leave), the 5-step guided tour,
   and the prompts shown when the visitor tries something that needs a real
   account. Everything renders only while `user.is_sandbox` is true. */

export const SANDBOX_WID = "p1";

/* The tour: steps 1–4 are coachmarks over real screens, step 5 is the
   "What you pay for" page (SandboxPlans). `value` is the "In your workspace"
   line — what a plan adds on top of what the visitor is looking at. */
export const TOUR = [
  { step: 1, path: (w) => `/w/${w}`, target: "attention", place: "right",
    title: "This is what needs you today",
    body: "Bracket read 23 emails, 2 Slack channels and 4 meeting notes from Acme Finance, then pulled out the things to act on. Every item links to its source.",
    value: "In your workspace this reads your own Gmail, Slack and notes, and stays current as clients write." },
  { step: 2, path: (w) => `/w/${w}/review/r1`, target: "proposals", place: "left",
    title: "Nothing changes without you",
    body: "Sarah asked for tablet layouts. Bracket shows exactly what that changes in scope, deliverables and the timeline. Accept or dismiss each change.",
    value: "Every client message is checked against what was agreed, so scope creep doesn’t slip past you." },
  { step: 3, path: (w) => `/w/${w}/ask?ask=${encodeURIComponent("What did we agree about the launch date?")}`, match: (w) => `/w/${w}/ask`, target: "ask-answer", place: "right",
    title: "Ask anything about the project",
    body: "Answers come from the project’s own history, with a source for every claim. Try your own question next.",
    value: "Ask across every project you bring in: up to 10 on Monthly." },
  { step: 4, path: (w) => `/w/${w}`, target: "sandbox-play", place: "bottom", next: "See what you pay for",
    title: "Watch a client message arrive",
    body: "Play the next scripted message. Bracket reads it, updates the memory and flags what changed, just like it will with your inbox.",
    value: "With your tools connected this happens on its own, every few minutes." },
  { step: 5, path: (w) => `/w/${w}/sandbox` },
];

const LOCKED_TITLE = {
  connect: "Connecting your own tools starts a free trial",
  note: "Adding your own notes starts a free trial",
  upload: "Adding your own files starts a free trial",
  invite: "Inviting your team starts a free trial",
  send: "Sending replies starts a free trial",
  workspace: "Your own workspaces start with a free trial",
  billing: "Plans start after the sandbox",
  account: "The sandbox doesn’t have an account",
};
const TRIAL_INCLUDES = [
  "Connect Gmail and Slack, choosing exactly which threads and channels Bracket reads",
  "Add notes, meeting transcripts and files from your own projects",
  "Bring up to 10 projects into Bracket",
  "Send replies you approve, from your own inbox",
];

const TOUR_KEY = "bk.sandbox.tour";
const readTour = () => { try { return Number(sessionStorage.getItem(TOUR_KEY) || 0); } catch { return 0; } };
const writeTour = (n) => { try { sessionStorage.setItem(TOUR_KEY, String(n)); } catch { /* storage unavailable */ } };

// Callers' error toasts for locked actions are silenced — the prompt explains instead.
const _toastError = toast.error;
toast.error = (msg, opts) => (msg === SANDBOX_LOCKED_MESSAGE ? undefined : _toastError(msg, opts));

const Ctx = createContext({ active: false });
export const useSandbox = () => useContext(Ctx);

export function SandboxProvider({ children }) {
  const { user, refresh } = useAuth();
  const active = !!user?.is_sandbox;
  const navigate = useNavigate();
  const [state, setState] = useState(null); // { beat, total, done }
  const [tour, setTourState] = useState(readTour);
  const [locked, setLocked] = useState(null); // { action, detail }
  const [resetOpen, setResetOpen] = useState(false);
  const [busy, setBusy] = useState(null);

  const setTour = useCallback((n) => { writeTour(n); setTourState(n); }, []);
  const track = useCallback((body) => api.post("/v2/sandbox/events", body).catch(() => {}), []);

  useEffect(() => {
    if (!active) return;
    api.get("/v2/sandbox").then(({ data }) => setState(data.sandbox)).catch(() => {});
  }, [active]);

  useEffect(() => {
    const on = (e) => setLocked(e.detail || { action: "connect" });
    window.addEventListener("bk:sandbox-locked", on);
    return () => window.removeEventListener("bk:sandbox-locked", on);
  }, []);

  const resync = async () => {
    await Promise.all([refresh(), fetchProjects(true).catch(() => {}), loadBilling(true).catch(() => {})]);
  };

  const start = useCallback(async () => {
    setBusy("start");
    try {
      const { data } = await api.post("/v2/sandbox/start");
      setState(data.sandbox);
      await resync();
      setTour(1);
      navigate(`/w/${data.workspace_id}`, { replace: true });
      return true;
    } catch (e) {
      toast.error(formatApiError(e));
      return false;
    } finally {
      setBusy(null);
    }
  }, [navigate, setTour]); // eslint-disable-line react-hooks/exhaustive-deps

  const next = useCallback(async () => {
    setBusy("next");
    try {
      const { data } = await api.post("/v2/sandbox/next");
      setState((s) => ({ ...(s || {}), beat: data.step, total: data.total, done: data.done }));
      refreshAll();
      if (data.beat) {
        const review = { blog: "r3", launch: "r4" }[data.beat.key];
        toast.success(data.beat.summary, {
          description: `Message ${data.step} of ${data.total}`,
          action: review ? { label: "Review", onClick: () => navigate(`/w/${SANDBOX_WID}/review/${review}`) } : undefined,
        });
      } else toast("That’s every scripted message. Reset to play them again.");
      return data;
    } catch (e) {
      toast.error(formatApiError(e));
      return null;
    } finally {
      setBusy(null);
    }
  }, [navigate]);

  const reset = useCallback(async () => {
    setBusy("reset");
    try {
      const { data } = await api.post("/v2/sandbox/reset");
      setState(data.sandbox);
      refreshAll();
      setResetOpen(false);
      navigate(`/w/${data.workspace_id}`, { replace: true });
      toast.success("Sandbox reset", { description: "Back to the start, with every client message ready to play." });
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setBusy(null);
    }
  }, [navigate]);

  const leave = useCallback(async (to = "/") => {
    setBusy("leave");
    try { await api.post("/v2/sandbox/leave"); } catch { /* leaving anyway */ }
    setTour(0);
    setState(null);
    setLocked(null);
    await resync();
    setBusy(null);
    navigate(to, { replace: true });
  }, [navigate, setTour]); // eslint-disable-line react-hooks/exhaustive-deps

  const startTrial = useCallback((plan) => leave(`/signup?from=sandbox${plan ? `&plan=${plan}` : ""}`), [leave]);

  const goStep = useCallback((n) => {
    const s = TOUR.find((x) => x.step === n);
    setTour(n >= 5 ? 0 : n);
    track({ type: "tour_step", step: n });
    if (s) navigate(s.path(SANDBOX_WID));
  }, [navigate, setTour, track]);

  const value = useMemo(() => ({
    active, state, busy, tour, start, next, reset, leave, startTrial, track,
    openReset: () => setResetOpen(true),
    startTour: () => goStep(1),
    nextStep: () => goStep(tour + 1),
    skipTour: () => { track({ type: "tour_skip", step: tour }); setTour(0); },
  }), [active, state, busy, tour, start, next, reset, leave, startTrial, track, goStep, setTour]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {active && <Tour />}
      <LockedDialog locked={active ? locked : null} onClose={() => setLocked(null)} onTrial={() => { setLocked(null); startTrial(); }} />
      <Dialog open={active && resetOpen} onOpenChange={setResetOpen} size="s" title="Reset the sandbox?"
        description={`Everything goes back to the start: the same things need attention and ${state?.total || 5} client messages are ready to play. Anything you accepted, dismissed or asked is cleared.`}
        footer={<>
          <Button variant="ghost" onClick={() => setResetOpen(false)}>Cancel</Button>
          <Button variant="primary" icon={RotateCcw} loading={busy === "reset"} onClick={reset}>Reset sandbox</Button>
        </>} />
    </Ctx.Provider>
  );
}

/* Figma › Sandbox · 6 Connect is locked (195:23795) — Dialog on desktop, sheet on mobile. */
function LockedDialog({ locked, onClose, onTrial }) {
  const action = locked?.action || "connect";
  const account = action === "account";
  return (
    <Dialog open={!!locked} onOpenChange={(o) => !o && onClose()} title={LOCKED_TITLE[action] || LOCKED_TITLE.connect}
      description={account ? "You’re exploring sample data as Maya Rao, so there’s no profile, password or data to change." : "The sandbox runs on sample data from Acme Finance, so it can’t connect to your Gmail, Slack or notes."}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Keep exploring</Button>
        <Button variant="primary" onClick={onTrial}>Start 14-day free trial</Button>
      </>}>
      <div className="rounded-lg border border-line-subtle bg-surface p-4">
        <p className="text-body-s font-medium text-fg-secondary">With the 14-day free trial you can</p>
        <ul className="mt-2.5 space-y-2.5">
          {TRIAL_INCLUDES.map((t) => (
            <li key={t} className="flex gap-2.5 text-body-m text-fg"><Check size={16} className="mt-0.5 shrink-0 text-success" />{t}</li>
          ))}
        </ul>
      </div>
      <p className="mt-4 text-body-s text-fg-tertiary">No card needed for the trial. Your data is never used to train AI models.</p>
    </Dialog>
  );
}
