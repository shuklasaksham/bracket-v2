import React, { useEffect, useRef, useState } from "react";
import { useParams, Link, useSearchParams, useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  ArrowLeft,
  Lock,
  Check,
  Loader2,
  RefreshCw,
  Download,
  FileText,
  Layers,
  FolderOpen,
  Copy,
  Pencil,
  Sparkles,
  Info,
  Clock,
  Wand2,
  X,
} from "lucide-react";
import { api, formatApiError, API_BASE } from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import { useDialog } from "../components/Dialog";
import AutoBuildOverlay from "../components/AutoBuildOverlay";
import { toast } from "sonner";

// Downstream fields cleared when a user reworks an earlier step. Mirrors
// the backend `_STEP_DOWNSTREAM_FIELDS` — kept as a client-side hint so
// we know whether a cascade confirmation is even necessary.
const STEP_DOWNSTREAM_KEYS = {
  1: ["framing", "context", "decision", "artifacts", "locked_at"],
  2: ["context", "decision", "artifacts", "locked_at"],
  3: ["decision", "artifacts", "locked_at"],
  4: ["artifacts", "locked_at"],
  5: ["locked_at"],
};

/**
 * Guard the "rework an earlier step" flow. If any downstream output would
 * be invalidated, prompt the user, then hit the backend reset endpoint
 * so we start fresh. Returns:
 *  - false → cancelled, caller should abort.
 *  - true  → nothing to reset, caller can just re-run.
 *  - project (object) → reset succeeded, caller should setProject(...) THEN re-run.
 */
async function guardStepRework(step, project, confirmDialog) {
  const status = project?.share_status || "none";
  // Frozen only while the doc sits with the client (sent) or after they
  // accepted. Once concerns are raised the owner can edit again.
  if (!["none", "rejected", "awaiting_reply"].includes(status)) {
    toast.error("This project is with your client for review — steps can't be edited until they respond.");
    return false;
  }
  const keys = (STEP_DOWNSTREAM_KEYS[step] || []).filter(
    (k) => k !== "locked_at" && k !== "framing" && k !== "context" && k !== "decision" && k !== "artifacts"
      ? false
      : Boolean(project?.[k])
  );
  // Only flag if there's actual downstream data (framing exists is fine —
  // that's the CURRENT step's output; we care about steps AFTER `step`).
  const downstreamMap = {
    1: ["context", "decision", "artifacts"],
    2: ["decision", "artifacts"],
    3: ["artifacts"],
    4: [],
    5: [],
  };
  const hasDownstream = (downstreamMap[step] || []).some((k) => Boolean(project?.[k]));
  if (!hasDownstream) return true;

  const ok = await confirmDialog({
    title: "Rework this step?",
    message:
      "Editing this step will clear everything Bracket generated after it. You'll re-run the next steps with your new input. Your own paste inputs on later steps stay put.",
    confirmLabel: "Rework it",
    cancelLabel: "Keep as-is",
    tone: "danger",
  });
  if (!ok) return false;
  try {
    const { data } = await api.post(`/projects/${project.id}/reset-from-step/${step}`);
    return data;
  } catch (e) {
    toast.error(formatApiError(e));
    return false;
  }
}

const STEPS = [
  // `label` is what we render while the step is TODO or ACTIVE (task-oriented).
  // `chapter` is the consultant-framing title (Understand / Simplify / …).
  // `milestone` is rendered once the step is DONE — a completed achievement verb.
  // `nextUp` lists what the *next* step produces — used to reduce "what happens after?" anxiety.
  { n: 1, key: "situation",  label: "Understand",  chapter: "Understand", milestone: "Project understood",  glyph: "{ 01 }", nextUp: ["Compressed signals", "Noise cut", "Hidden assumptions"] },
  { n: 2, key: "context",    label: "Simplify",    chapter: "Simplify",   milestone: "Signals compressed",  glyph: "{ 02 }", nextUp: ["The call", "Alternatives", "Trade-offs", "Risks"] },
  { n: 3, key: "decision",   label: "Strategy",    chapter: "Strategy",   milestone: "Decision made",       glyph: "{ 03 }", nextUp: ["Scope doc", "Client message", "Assumptions", "Risk flags"] },
  { n: 4, key: "artifacts",  label: "Execution",   chapter: "Execution",  milestone: "Artifacts drafted",   glyph: "{ 04 }", nextUp: ["Locked doc", "PDF export", "Share link"] },
  { n: 5, key: "lock",       label: "Review",      chapter: "Review",     milestone: "Locked & signed",     glyph: "{ 05 }", nextUp: [] },
];

export default function ProjectFlow() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [currentStep, setCurrentStep] = useState(1);
  const dirtyRef = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get(`/projects/${id}`);
        setProject(data);
        // Allow ?step=N to jump directly into a step (from the overview's Edit
        // button). Clamp between 1 and the project's reached step.
        const requested = parseInt(searchParams.get("step") || "", 10);
        const reached = data.step || 1;
        if (requested >= 1 && requested <= 5) {
          setCurrentStep(Math.min(requested, Math.max(reached, requested)));
        } else {
          setCurrentStep(reached);
        }
      } catch (e) {
        setError(formatApiError(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [id, searchParams]);

  // Live-follow an uploaded brief's auto-advance: while the background chain
  // builds steps, refresh the project every 3s so outputs (and the AI title)
  // fill in as they're generated. Pauses while the user is mid-edit.
  useEffect(() => {
    if (project?.auto_advance_status !== "pending") return undefined;
    const t = setInterval(async () => {
      // Note: don't gate on dirtyRef here — step 1 flags itself dirty while
      // a raw paste has no framing yet, which is exactly the uploaded-brief
      // state. Step components hold their own local form state, so a
      // project refresh won't clobber in-progress typing.
      try {
        const { data } = await api.get(`/projects/${id}`);
        setProject(data);
        setCurrentStep((s) => Math.max(s, data.step || 1));
        const st = data.auto_advance_status;
        if (st && st !== "pending") {
          if (st === "advanced") toast.success("Brief complete — Bracket generated the full document.");
          else if (st === "partial") toast.info("Brief mostly ready — finish the last step manually.");
          else if (st === "insufficient") toast.info("The brief was thin — Bracket will guide you from Step 1.");
          else if (st === "failed") toast.info("Auto-build hit a snag — your brief text is loaded, continue from Step 1.");
        }
      } catch {
        /* transient — keep polling */
      }
    }, 3000);
    return () => clearInterval(t);
  }, [project?.auto_advance_status, id]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="mono-label">LOADING…</p>
      </div>
    );
  }
  if (error && !project) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="border border-danger p-6 bg-chalk" data-testid="flow-load-error">
          <p className="mono-tag text-danger">ERROR</p>
          <p className="mt-2">{error}</p>
          <Link to="/app" className="btn-ghost mt-4">
            Start a new project
          </Link>
        </div>
      </div>
    );
  }

  const isLocked = project?.status === "locked";
  const progress = (currentStep / 5) * 100;

  const downloadPdf = async () => {
    try {
      const res = await fetch(`${API_BASE}/projects/${project.id}/export.pdf`, { credentials: "include" });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${project.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      toast.error(`Couldn't download PDF — ${e.message || e}`);
    }
  };

  return (
    <div className="min-h-screen relative overflow-clip" data-testid="project-flow-page">
      {/* Cinematic dashboard backdrop — unified with /app so post-login pages share the same visual language. */}
      <div aria-hidden="true" className="hero-ambient hero-ambient--dashboard" />
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10"
        style={{ background: "var(--bg)" }}
      />
      <div className="flow-root">
      <main
        className="max-w-[1440px] mx-auto px-5 sm:px-6 md:px-10 pt-8 md:pt-10 pb-6 md:pb-8"
        key={currentStep}
      >
        {/* Page header — was previously a sticky top nav; now lives inline with
            the flow so the sidebar is the only chrome on screen. */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <p className="mono-tag text-muted text-[10px]">PROJECT</p>
            <h1
              className="mt-1 font-display font-semibold tracking-[-0.02em] leading-[1.15] text-[22px] sm:text-[26px] text-[var(--text)] truncate"
              data-testid="flow-project-name"
            >
              {project?.name}
            </h1>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isLocked && (
              <span className="status-pill status-pill--active hidden sm:inline-flex" data-testid="flow-locked-pill">
                <Lock size={11} className="-ml-0.5" /> Locked
              </span>
            )}
            {project?.artifacts && (
              <Link
                to={`/project/${project.id}/document`}
                className="flow-header-action"
                data-testid="flow-document-link"
                title="Document"
                aria-label="Document"
              >
                <FileText size={12} /> <span className="hidden sm:inline">Document</span>
              </Link>
            )}
            <Link
              to={`/project/${id}`}
              className="flow-header-action"
              data-testid="flow-overview-link"
              title="Overview"
              aria-label="Overview"
            >
              <Layers size={12} /> <span className="hidden sm:inline">Overview</span>
            </Link>
            <Link
              to="/app"
              className="flow-header-action"
              data-testid="flow-new-project-btn"
              title="All projects"
              aria-label="All projects"
            >
              <FolderOpen size={12} /> <span className="hidden sm:inline">All projects</span>
            </Link>
          </div>
        </div>

        {/* Uploaded-brief auto-build in progress — steps fill in live. */}
        {project?.auto_advance_status === "pending" && (
          <div
            className="mt-5 card-linear p-3.5 border-l-2 border-signal flex items-center gap-3"
            data-testid="auto-advance-banner"
          >
            <Loader2 size={15} className="animate-spin text-signal shrink-0" />
            <p className="text-[13px] text-[var(--text-2)]">
              Bracket is building your project from the brief — steps fill in automatically as
              they&apos;re generated. Feel free to review each one as it lands.
            </p>
          </div>
        )}

        {/* Journey pipeline */}
        <div className="mt-6">
          <p className="mono-tag text-muted mb-2 hidden sm:block text-[10px]" data-testid="milestone-tracker-label">
            YOUR JOURNEY
          </p>
          <div className="step-pipeline" data-testid="milestone-tracker">
            {STEPS.map((s, i) => {
              const done =
                (project?.step || 1) > s.n ||
                (project?.step === s.n && project?.status === "locked");
              const active = currentStep === s.n;
              // When a step is done, show its milestone verb ("Project understood");
              // otherwise show the task label ("Situation framing"). This turns
              // the pipeline into a completion-oriented journey tracker.
              const nodeLabel = done ? s.milestone : s.label;
              return (
                <React.Fragment key={s.n}>
                  <button
                    onClick={() => setCurrentStep(s.n)}
                    className={`step-node press ${active ? "is-active" : done ? "is-done" : ""}`}
                    data-testid={`step-nav-${s.n}`}
                    aria-current={active ? "step" : undefined}
                    title={done ? `Milestone reached: ${s.milestone}` : s.label}
                  >
                    <span className="step-num">{done && !active ? <Check size={11} strokeWidth={2.5} /> : s.n}</span>
                    <span className="hidden sm:inline">{nodeLabel}</span>
                  </button>
                  {i < STEPS.length - 1 && (
                    <span
                      className={`step-connector ${done ? "is-done" : ""}`}
                      aria-hidden="true"
                    />
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>

        <div
          key={project?.auto_advance_status === "pending" ? `arrive-${currentStep}` : "steps"}
          className={`mt-8 md:mt-10 ${project?.auto_advance_status === "pending" ? "ai-arrive" : ""}`}
        >
        {currentStep === 1 && (
          <Step1 project={project} setProject={setProject} dirtyRef={dirtyRef} onDone={(nextStep) => {
            // Step 1 calls onDone either with an explicit target step (from
            // the auto-build routing) OR — critically — from the plain
            // Continue button which forwards the React SyntheticEvent as
            // the first arg. Coerce anything non-numeric to 2 so we don't
            // set currentStep to NaN (which would blank the whole screen).
            const target = typeof nextStep === "number" ? nextStep : 2;
            setCurrentStep(Math.max(2, target));
          }} />
        )}
        {currentStep === 2 && (
          <Step2
            project={project}
            setProject={setProject}
            dirtyRef={dirtyRef}
            onDone={() => setCurrentStep(3)}
            onBack={() => setCurrentStep(1)}
          />
        )}
        {currentStep === 3 && (
          <Step3
            project={project}
            setProject={setProject}
            dirtyRef={dirtyRef}
            onDone={() => setCurrentStep(4)}
            onBack={() => setCurrentStep(2)}
          />
        )}
        {currentStep === 4 && (
          <Step4
            project={project}
            setProject={setProject}
            dirtyRef={dirtyRef}
            onDone={() => setCurrentStep(5)}
            onBack={() => setCurrentStep(3)}
          />
        )}
        {currentStep === 5 && (
          <Step5
            project={project}
            setProject={setProject}
            onBack={() => setCurrentStep(4)}
            onExport={downloadPdf}
            projectId={project.id}
          />
        )}
        </div>
      </main>
      </div>
    </div>
  );
}

// Workbench — split-screen "workbench" layout used by Steps 1-3.
// Left panel = user input (paste + CTA), Right panel = Bracket's live output.
// A compact bar above the panels shows the chapter title on the left and,
// once the AI has run, a celebration chip on the right — that's the dopamine
// hit condensed into the persistent top strip.
//
// Design choices:
// - Panels are separated by a subtle hairline; both sit inside a card frame
//   so they read as *one canvas split*, not two adjacent boxes.
// - Left panel bottom is anchored (CTA + hint stay put on expand/collapse).
// - Right panel scrolls internally when output is very long — the outer page
//   never scrolls.
function Workbench({
  num,
  chapterLabel,
  isDone,
  ask,
  title,
  kicker,
  nextUp,
  previously,
  celebration,
  left,
  right,
  bottom,
}) {
  const prevText = previously && previously.length > 160
    ? previously.slice(0, 157).trimEnd() + "…"
    : previously;
  return (
    <div className="workbench page-enter" data-testid={`workbench-step${num}`}>
      {/* Top strip: chapter meta on the left, live celebration chip on the right. */}
      <div className="workbench-topbar">
        <div className="flex items-center gap-3 min-w-0">
          <span className="workbench-num" aria-hidden="true">{`0${num}`}</span>
          <div className="min-w-0">
            <p className="mono-tag text-muted text-[10px]">CHAPTER {num} / 05</p>
            <p className="t-h3 text-[15px] truncate">{chapterLabel}</p>
          </div>
        </div>
        {isDone && celebration && (
          <div className="workbench-celebration animate-fade-up" data-testid={`step${num}-celebration`}>
            {celebration}
          </div>
        )}
      </div>

      {/* Split panels */}
      <div className="workbench-panels">
        {/* LEFT — input canvas */}
        <div className="workbench-panel workbench-panel--left" data-testid={`step${num}-left-panel`}>
          <div className="workbench-panel-body">
            {prevText && (
              <div className="mb-2 flex" data-testid={`step${num}-previously`}>
                <div className="story-rail">
                  <span className="label">↩ previously</span>
                  <span>{prevText}</span>
                </div>
              </div>
            )}
            {ask && !isDone && (
              <p className="mono-tag text-signal mt-1 mb-1 inline-flex items-center gap-1.5" data-testid={`step${num}-ask`}>
                <Sparkles size={11} /> BRACKET ASKS
              </p>
            )}
            <h1 className="t-hero mt-0 text-[22px] sm:text-[26px] md:text-[28px] leading-[1.15]">{title}</h1>
            {kicker && <p className="mt-2 text-muted text-[13px] leading-relaxed">{kicker}</p>}
            {nextUp && nextUp.length > 0 && !isDone && (
              <div className="mt-3 inline-flex items-center gap-2 flex-wrap text-[11px] text-muted" data-testid={`step${num}-next-up`}>
                <span className="mono-tag text-signal">NEXT →</span>
                {nextUp.map((n, i) => (
                  <span key={i} className="inline-flex items-center gap-1">
                    <Check size={10} className="text-signal" /> {n}
                  </span>
                ))}
              </div>
            )}
            <div className="mt-4">{left}</div>
          </div>
          {bottom && (
            <div className="workbench-panel-bottom">{bottom}</div>
          )}
        </div>

        {/* RIGHT — Bracket's output */}
        <div className="workbench-panel workbench-panel--right" data-testid={`step${num}-right-panel`}>
          <div className="workbench-panel-body workbench-panel-body--scroll">
            {right}
          </div>
        </div>
      </div>
    </div>
  );
}

// Small chip list for the top-bar celebration (e.g., "5 tensions · 42 clarity").
function CelebrationChips({ items = [], milestone }) {
  const filtered = items.filter((it) => (it.count ?? 0) > 0 || it.label === "clarity/100");
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="mono-tag text-signal inline-flex items-center gap-1.5">
        <Check size={11} strokeWidth={2.5} /> {milestone}
      </span>
      <span className="text-[var(--text-3)] text-[11px]">·</span>
      {filtered.map((it, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className="text-[var(--text-3)] text-[10px]">·</span>}
          <span className="inline-flex items-baseline gap-1 text-[12px]">
            <span className="font-display font-semibold text-signal tabular-nums">{it.count}</span>
            <span className="text-muted text-[10.5px]">{it.label}</span>
          </span>
        </React.Fragment>
      ))}
    </div>
  );
}

function StepShell({ num, label, title, kicker, previously, nextHint, nextUp, ask, celebration, children }) {
  // Truncate long "previously" summaries so the rail stays a single-line-ish reminder.
  const prevText = previously && previously.length > 160
    ? previously.slice(0, 157).trimEnd() + "…"
    : previously;
  const shouldReduce = useReducedMotion();
  // Staggered cinematic entry — top bar → previously rail → step body.
  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: shouldReduce ? 0 : 0.08, delayChildren: 0.05 },
    },
  };
  const item = {
    hidden: { opacity: 0, y: shouldReduce ? 0 : 14 },
    show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] } },
  };
  return (
    <motion.div
      key={num}
      variants={container}
      initial="hidden"
      animate="show"
    >
      {/* Workbench top bar — chapter meta on the left, celebration chip on the right when done. */}
      <motion.div variants={item} className="workbench-topbar" data-testid={`step${num}-topbar`}>
        <div className="flex items-center gap-4 sm:gap-5 min-w-0 flex-1">
          <span className="workbench-num" aria-hidden="true">{`0${num}`}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3 flex-wrap">
              <p className="mono-tag text-muted text-[10px]" data-testid={`step${num}-chapter-tag`}>CHAPTER {num} / 05 · {label}</p>
              {ask && !celebration && (
                <p className="mono-tag text-signal inline-flex items-center gap-1.5 text-[10px]" data-testid={`step${num}-ask`}>
                  <Sparkles size={11} /> BRACKET ASKS
                </p>
              )}
            </div>
            <h1 className="mt-1.5 font-display font-semibold tracking-[-0.024em] leading-[1.08] text-[24px] sm:text-[28px] md:text-[32px] text-[var(--text)]">{title}</h1>
          </div>
        </div>
        {celebration && (
          <div className="workbench-celebration animate-fade-up shrink-0" data-testid={`step${num}-celebration-topbar`}>
            {celebration}
          </div>
        )}
      </motion.div>

      {kicker && !celebration && (
        <motion.p variants={item} className="mt-3 text-muted text-[13.5px] leading-relaxed max-w-3xl">{kicker}</motion.p>
      )}

      {prevText && (
        <motion.div variants={item} className="mt-3 flex" data-testid={`step${num}-previously`}>
          <div className="story-rail">
            <span className="label">↩ previously</span>
            <span>{prevText}</span>
          </div>
        </motion.div>
      )}

      {nextUp && nextUp.length > 0 && !celebration && (
        <motion.div variants={item} className="mt-3 inline-flex items-center gap-2 flex-wrap text-[11px] text-muted" data-testid={`step${num}-next-up`}>
          <span className="mono-tag text-signal">NEXT →</span>
          {nextUp.map((n, i) => (
            <span key={i} className="inline-flex items-center gap-1">
              <Check size={10} className="text-signal" /> {n}
            </span>
          ))}
        </motion.div>
      )}

      <motion.div variants={item} className="mt-5 md:mt-6">{children}</motion.div>
    </motion.div>
  );
}

// NextHintRail — small "next ↪" story-rail rendered inline under a step's
// CTA button so it doesn't jump when the right column grows/shrinks on
// expand/collapse.
function NextHintRail({ text, testid }) {
  if (!text) return null;
  return (
    <div className="mt-3 flex" data-testid={testid}>
      <div className="story-rail is-next">
        <span className="label">next ↪</span>
        <span>{text}</span>
      </div>
    </div>
  );
}

function ErrorBox({ msg }) {
  if (!msg) return null;
  return (
    <div className="border border-danger bg-chalk p-3 mt-4" data-testid="step-error">
      <p className="mono-tag text-danger">SOMETHING BROKE</p>
      <p className="text-sm mt-1">{msg}</p>
    </div>
  );
}

// ---- Sample project pool (for "Try Sample Project") ----
// ---- Sample project pool (for "Try Sample Project") ----
// Each sample is a *realistic messy paste* — a WhatsApp thread, email, or
// notes chunk that a designer would receive from a client. Bracket's Haiku
// extractor pulls out what/who/unclear on the backend, exactly as it would
// for a real user's paste.
const SAMPLE_BRIEFS = [
  {
    key: "fintech-landing",
    raw_paste:
`Hey! So we finally got the greenlight to redo our landing page. Founder here is Ankit btw.

We've been sending you Stripe and Linear as references but honestly our product is way more technical - it's treasury management for startup CFOs. Also budget is 80k INR and we need it in 3 weeks max because we launch on Nov 15.

One thing that has us worried - the current site converts at 0.4% and our sales team is very sensitive about anything they think might hurt demo bookings.

Quick side question - should we do a full brand refresh in the same sprint or is that a separate scope? Let me know if you need anything else!

- Ankit`,
  },
  {
    key: "checkout-redesign",
    raw_paste:
`Notes from checkout audit call — 12 Aug 2025

Team: Head of Product (Deepika), 2 eng leads, 1 growth PM
Company: Fashion D2C, 800k MAU, in-house design team of 4

Problem: drop-off between cart -> payment is ~40%. Team is convinced it's a UI problem, wants a redesign. Analytics I saw actually suggests it's mostly form friction (address autocomplete broken on Android) and payment method failures (Razorpay UPI declines spiking).

Timeline: ship a v1 in 6 weeks. Engineering has 2 sprints allocated. If we do research first (2 wks), that leaves 4 sprints for design + build - tight but doable.

Awkward: no one on the team has actually watched a real user check out. Have proposed we do 5 sessions before touching Figma. Deepika seems open but the CEO wants a Figma prototype in "the next 2 weeks max" for the board.`,
  },
  {
    key: "coffee-brand",
    raw_paste:
`meeting notes // loop coffee brand kickoff

Priya (solo founder, ex-restaurant, launching 2 blends first) wants:
- brand naming + logo
- packaging: pouch + label
- IG launch kit (10-15 posts)

budget: 1.2L INR, timeline flexible-ish, needs to be ready before Diwali (early Nov)

references she loves: Blue Tokai for the design language, Third Wave for the tone, "but different"

honestly not sure what she means by that yet - she keeps flipping between wanting it to feel "premium" (matte, gold foil, coffee-nerdy) and "approachable" (playful, lifestyle, mass appeal). last meeting she said both in the same sentence.

my worry: 1.2L is tight for full naming + brand + packaging + launch kit. and she has strong opinions but hasn't defined a clear customer or price point yet. i think we should nail brand strategy first before touching design.`,
  },
];

function pickSample() {
  return SAMPLE_BRIEFS[Math.floor(Math.random() * SAMPLE_BRIEFS.length)];
}

// Very light gibberish detection: flag inputs that are clearly not a real
// answer (too short, only digits, single repeated char, keyboard mash).
function looksLikeGibberish(text) {
  const t = (text || "").trim();
  if (t.length < 12) return t.length > 0; // typed something but too short
  if (/^\d+$/.test(t)) return true;
  if (/^([a-z])\1{3,}$/i.test(t.replace(/\s+/g, ""))) return true;
  // Any word in the trio of common keyboard-mash tokens
  const mashy = /\b(asdf|qwer|hjkl|zxcv|hahaha|lol|test\s?test|123|abc)\b/i;
  if (mashy.test(t) && t.length < 40) return true;
  return false;
}

function wordCount(s) {
  return (s || "").trim().split(/\s+/).filter(Boolean).length;
}

// CelebrationCard — the dopamine hit rendered right after AI extraction.
// Bigger, prouder, more emotional than the TransformationCard: leads with
// "✓ Chapter N complete" then shows the count of things Bracket now understands.
function CelebrationCard({ chapter, milestone, items = [], testid }) {
  const filtered = items.filter((it) => (it.count ?? 0) > 0);
  if (!filtered.length) return null;
  return (
    <div
      className="mt-5 card-brut p-5 sm:p-6 border-l-2 border-signal animate-fade-up relative overflow-hidden"
      data-testid={testid || "celebration-card"}
      style={{
        background:
          "linear-gradient(135deg, rgba(255,255,255, 0.08) 0%, var(--surface) 60%)",
      }}
    >
      <div className="flex items-center gap-2 text-signal">
        <Check size={16} strokeWidth={2.5} />
        <p className="mono-label">{`CHAPTER ${chapter} · COMPLETE`}</p>
      </div>
      <h3 className="t-h2 mt-2 text-[20px] sm:text-[22px]">{milestone}</h3>
      <p className="mt-1 text-xs text-muted">Bracket now understands:</p>
      <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
        {filtered.map((it, i) => (
          <div
            key={i}
            className="text-center"
            data-testid={testid ? `${testid}-${it.key || i}` : undefined}
          >
            <p className="font-display text-2xl sm:text-3xl text-signal tabular-nums leading-none">{it.count}</p>
            <p className="mt-1 text-[11px] text-muted leading-tight">{it.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// TransformationCard — celebrates the AI's work by comparing what the user
// pasted (raw words) against what Bracket extracted (structured signals).
// Rendered at the end of Steps 1-3 once output exists. Reinforces perceived
// value ("I pasted a mess, Bracket returned a plan") and answers "why paste?".
function TransformationCard({ pasteText, items = [], testid, note }) {
  const wc = wordCount(pasteText);
  if (!wc) return null;
  const hasAny = items.some((it) => (it.count ?? 0) > 0);
  if (!hasAny) return null;
  return (
    <div
      className="mt-5 card-brut p-5 sm:p-6 border-l-2 border-signal animate-fade-up"
      data-testid={testid || "transformation-card"}
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="mono-label text-signal">{"< transformation >"}</p>
        <span className="mono-tag text-muted">from mess → to signal</span>
      </div>
      <div className="mt-4 flex items-baseline gap-2 flex-wrap">
        <span
          className="font-display text-3xl sm:text-4xl text-[var(--text)] tabular-nums"
          data-testid={testid ? `${testid}-word-count` : undefined}
        >
          {wc.toLocaleString()}
        </span>
        <span className="mono-tag text-muted">words in</span>
        <span className="mono-tag text-muted">→</span>
        {items.filter((it) => (it.count ?? 0) > 0).map((it, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="mono-tag text-muted">·</span>}
            <span
              className="font-display text-3xl sm:text-4xl text-signal tabular-nums"
              data-testid={testid ? `${testid}-${it.key || i}` : undefined}
            >
              {it.count}
            </span>
            <span className="mono-tag text-muted">{it.label}</span>
          </React.Fragment>
        ))}
      </div>
      {note && (
        <p className="mt-3 text-xs text-muted italic">{note}</p>
      )}
    </div>
  );
}

// Empty-state teaching card. Shown inside a section where an AI-extracted
// list came back empty — reassures the user Bracket looked and either found
// nothing worth flagging, or that they'll see items surface as they iterate.
function EmptyModuleHint({ title, blurb, testid }) {
  return (
    <div
      className="mt-3 border border-dashed border-[var(--hairline-strong)] rounded p-4 text-sm text-muted"
      data-testid={testid || "empty-module-hint"}
    >
      <p className="mono-tag text-signal">{title}</p>
      <p className="mt-2 leading-relaxed">{blurb}</p>
    </div>
  );
}

// Renders the targeted "still need to know" follow-up questions Bracket
// surfaced when the first-chatbox paste was too thin to auto-build the whole
// document. Numbered list, subtle callout, prompts the user to answer them
// in the paste field below. Hidden once the step's own output exists.
// Clicking a question calls `onPick(question)` — Step 2 / Step 3 wire this
// to append "Q: <question>\nA: " to their paste box so the user just types
// the answer.
function OpenQuestions({ label = "Bracket still needs your read on", items = [], testid, onPick }) {
  if (!items || items.length === 0) return null;
  return (
    <div
      className="rounded border border-signal/40 bg-signal/[0.06] px-4 py-3.5"
      data-testid={testid || "open-questions"}
    >
      <p className="mono-tag text-signal">{label}</p>
      <ol className="mt-2 space-y-1.5 text-sm leading-relaxed" data-testid={`${testid || "open-questions"}-list`}>
        {items.map((q, i) => (
          <li key={i} data-testid={`${testid || "open-questions"}-item-${i}`}>
            <button
              type="button"
              onClick={() => onPick && onPick(q)}
              className="flex w-full text-left gap-2 rounded-sm px-1 py-1 -mx-1 hover:bg-white/[0.03] focus:bg-white/[0.05] focus:outline-none transition-colors"
              data-testid={`${testid || "open-questions"}-pick-${i}`}
              aria-label={`Answer question ${i + 1}: ${q}`}
            >
              <span className="mono-tag text-muted mt-[3px] shrink-0">{String(i + 1).padStart(2, "0")}</span>
              <span className="flex-1">{q}</span>
            </button>
          </li>
        ))}
      </ol>
      {onPick && (
        <p className="mt-2.5 text-[11px] text-muted leading-snug">
          Tap a question to answer it in your paste below.
        </p>
      )}
    </div>
  );
}

function Step1({ project, setProject, dirtyRef, onDone }) {
  const initial = project.situation_input || { raw_paste: "", what: "", who: "", unclear: "" };
  const draftKey = `bracket:step1-draft:${project.id}`;
  const { confirm: confirmDialog } = useDialog();
  // Hydrate from local draft if the project has no server-side input yet.
  const [form, setForm] = useState(() => {
    if (project.situation_input) return { raw_paste: "", ...project.situation_input };
    try {
      const raw = window.localStorage.getItem(draftKey);
      if (raw) return { ...initial, ...JSON.parse(raw) };
    } catch (e) { /* ignore */ }
    return initial;
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [phase, setPhase] = useState(null); // detecting | scanning | framing | done
  const [isSample, setIsSample] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  // When true, Step 1 is running the initial paste-driven auto-build. We
  // show a subtle overlay (AutoBuildOverlay) instead of the Step-1 workbench
  // UI so the user never sees the raw form during this pass. On completion
  // we auto-route them to Step 2 or Step 5 depending on brief richness.
  const [autoBuilding, setAutoBuilding] = useState(false);
  const whatRef = useRef(null);
  const framing = project.framing;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sampleKeyParam = searchParams.get("sample");

  // Auto-focus the first input on mount (only when we don't already have an output).
  useEffect(() => {
    if (!framing && whatRef.current) {
      // Slight delay so it happens after page-enter animation
      const t = setTimeout(() => whatRef.current?.focus(), 220);
      return () => clearTimeout(t);
    }
  }, [framing]);

  // Track unsaved input so the logo-click handler can warn.
  useEffect(() => {
    if (!dirtyRef) return;
    dirtyRef.current = !!form.raw_paste && !framing;
    return () => { if (dirtyRef) dirtyRef.current = false; };
  }, [form, framing, dirtyRef]);

  // Auto-save draft to localStorage (debounced 500ms).
  useEffect(() => {
    if (framing) return; // don't overwrite once we have output
    const handle = setTimeout(() => {
      try {
        if (form.raw_paste) {
          window.localStorage.setItem(draftKey, JSON.stringify(form));
          setDraftSaved(true);
          const clear = setTimeout(() => setDraftSaved(false), 1400);
          return () => clearTimeout(clear);
        }
      } catch (e) { /* ignore quota errors */ }
    }, 500);
    return () => clearTimeout(handle);
  }, [form, framing, draftKey]);

  // Clear draft once the server has accepted the input.
  useEffect(() => {
    if (framing) {
      try { window.localStorage.removeItem(draftKey); } catch (e) { /* noop */ }
    }
  }, [framing, draftKey]);

  const runInternal = async (payload, opts = {}) => {
    const autoRoute = !!opts.autoRoute;
    // Cascade guard — if downstream steps already have Bracket output,
    // ask before overwriting. Applies only when framing already exists
    // (i.e., this is a re-run, not the first pass).
    if (project.framing) {
      const guard = await guardStepRework(1, project, confirmDialog);
      if (!guard) return;
      if (guard !== true) setProject(guard);
    }
    setLoading(true);
    setError("");
    if (autoRoute) setAutoBuilding(true);
    // Sequential progress checkmarks synced with actual AI latency (~4-6s).
    setPhase("detecting");
    const t1 = setTimeout(() => setPhase("scanning"), 900);
    const t2 = setTimeout(() => setPhase("framing"), 2200);
    try {
      const { data } = await api.post(`/projects/${project.id}/situation`, payload);
      setProject(data);
      setPhase("done");
      // Route the user: rich brief → Step 5, thin brief → Step 2. Only for
      // the initial paste-driven pass (autoRoute) — a manual re-run on
      // Step 1 keeps the user on Step 1 so they can inspect the framing.
      if (autoRoute) {
        const nextStep = data?.step === 5 && data?.artifacts && data?.decision ? 5 : 2;
        // Brief hold so the overlay stays visible for the last checkmark.
        setTimeout(() => {
          try { onDone(nextStep); } catch { /* noop */ }
          setAutoBuilding(false);
        }, 500);
      } else if (data?.step === 5 && data?.artifacts && data?.decision) {
        // Manual Step-1 rerun that happened to be rich enough for a one-shot.
        setTimeout(() => { try { onDone(5); } catch { /* noop */ } }, 700);
      }
    } catch (e) {
      setError(formatApiError(e));
      setPhase(null);
      setAutoBuilding(false);
    } finally {
      clearTimeout(t1);
      clearTimeout(t2);
      setLoading(false);
    }
  };

  // Hydrate paste passed from Dashboard hero (via sessionStorage) exactly
  // once on first mount of a fresh project with no framing yet.
  const pendingPasteHydrated = useRef(false);
  useEffect(() => {
    if (pendingPasteHydrated.current) return;
    if (framing) return;
    try {
      const key = `bracket:pending-paste:${project.id}`;
      const paste = window.sessionStorage.getItem(key);
      if (paste && !form.raw_paste) {
        pendingPasteHydrated.current = true;
        window.sessionStorage.removeItem(key);
        const nextForm = { raw_paste: paste };
        setForm(nextForm);
        // Auto-submit so the user sees Bracket start working immediately —
        // this is the whole promise of the paste-first flow. Route the user
        // to Step 5 (rich brief) or Step 2 (thin brief) automatically.
        runInternal(nextForm, { autoRoute: true });
      }
    } catch (e) { /* private mode / quota — user can still submit manually */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, framing]);

  const run = () => runInternal(form);

  const trySample = async (forcedKey) => {
    const s = forcedKey
      ? (SAMPLE_BRIEFS.find((b) => b.key === forcedKey) || pickSample())
      : pickSample();
    const nextForm = { raw_paste: s.raw_paste };
    setForm(nextForm);
    setIsSample(true);
    // Full magical demo: pre-fill AND auto-submit + auto-route to next step.
    await runInternal(nextForm, { autoRoute: true });
  };

  // If Dashboard launched us with ?sample=<key>, auto-trigger that specific
  // brief on first mount (only when no framing already exists).
  const sampleAutoRun = useRef(false);
  useEffect(() => {
    if (sampleAutoRun.current) return;
    if (!sampleKeyParam) return;
    if (framing) return; // don't overwrite an existing generation
    if (loading) return;
    sampleAutoRun.current = true;
    trySample(sampleKeyParam);
  }, [sampleKeyParam, framing]);

  const clearSample = () => {
    setIsSample(false);
    navigate("/app");
  };

  const pasteGibberish = form.raw_paste && looksLikeGibberish(form.raw_paste);
  const canSubmit = !loading && (form.raw_paste || "").trim().length > 0 && !pasteGibberish;

  return (
    <>
    <AutoBuildOverlay open={autoBuilding} />
    <StepShell
      num={1}
      label="Understand"
      ask={!framing}
      title={framing ? "Here's what's actually happening." : "What did your client send?"}
      kicker={framing ? "Sharper than the brief. Ready to compress." : "Paste anything — email, WhatsApp, notes. Bracket reads the mess."}
      nextUp={framing ? [] : ["Reframed problem", "Clarity score", "Tensions to watch"]}
      celebration={framing ? (
        <CelebrationChips
          milestone="Project understood"
          items={[
            { key: "words",    label: "words",       count: wordCount(project.situation_input?.raw_paste || form.raw_paste) },
            { key: "tensions", label: "tensions",    count: (framing.tensions || []).length },
            { key: "clarity",  label: "clarity/100", count: framing.clarity_score || 0 },
          ]}
        />
      ) : null}
    >
      <div className="mb-3 flex items-center gap-2 flex-wrap" data-testid="step1-timepill">
        <span className="mono-tag text-muted inline-flex items-center gap-1.5 text-[10px]">
          <Clock size={11} /> ~1 min
        </span>
        {draftSaved && !framing && (
          <span className="mono-tag text-signal inline-flex items-center gap-1.5 text-[10px]" data-testid="step1-draft-saved">
            <Check size={11} /> saved
          </span>
        )}
        {isSample && (
          <>
            <span className="mono-tag inline-flex items-center gap-1.5 px-2 py-1 border border-signal text-signal text-[10px]" data-testid="step1-sample-tag">
              <Sparkles size={11} /> sample
            </span>
          </>
        )}
      </div>

      {isSample && (
        <div className="card-brut p-3 mb-3 flex items-start gap-2 text-[13px]" data-testid="step1-sample-banner">
          <Sparkles size={14} className="mt-0.5 text-signal shrink-0" />
          <p className="t-body">Sample project — see Bracket work in ~60s.</p>
        </div>
      )}

      <div className={framing ? "grid lg:grid-cols-12 gap-5" : "grid lg:grid-cols-2 gap-5"}>
        <div className={framing ? "space-y-3 lg:col-span-5" : "space-y-3"} data-testid="step1-form">
          <Field
            label="Paste anything from your client"
            testid="step1-paste"
            helper="Email · WhatsApp · notes · Loom transcript · brief. Nothing to format."
          >
            <textarea
              ref={whatRef}
              className="textarea-brut"
              rows={6}
              placeholder="Paste the client's message, brief, chat, or notes."
              value={form.raw_paste || ""}
              onChange={(e) => setForm({ ...form, raw_paste: e.target.value })}
              data-testid="step1-paste-input"
            />
            {pasteGibberish && (
              <div className="mt-2 text-xs text-danger inline-flex items-center gap-1.5" data-testid="step1-paste-warning">
                <Info size={12} />
                Too thin —{" "}
                <button
                  type="button"
                  onClick={trySample}
                  className="underline text-signal press"
                  data-testid="step1-inline-sample-btn"
                >
                  try a sample
                </button>
                .
              </div>
            )}
            {form.raw_paste && (
              <p className="mt-1.5 text-[11px] text-muted" data-testid="step1-word-count">
                {wordCount(form.raw_paste)} words
              </p>
            )}
          </Field>

          <div className="flex items-center gap-3 flex-wrap pt-1">
            <button
              onClick={run}
              disabled={!canSubmit}
              className="clay-signal px-4 py-2.5 t-tag press inline-flex items-center justify-center gap-2 whitespace-nowrap"
              data-testid="step1-submit-btn"
            >
              {loading ? (
                <>
                  <Loader2 size={13} className="animate-spin" /> Framing…
                </>
              ) : framing ? (
                <>
                  <RefreshCw size={13} /> Reframe
                </>
              ) : (
                <>
                  Reframe <ArrowRight size={13} />
                </>
              )}
            </button>
            {framing && (
              <button type="button" onClick={() => onDone()} className="btn-ghost inline-flex items-center gap-2" data-testid="step1-continue-btn">
                Continue <ArrowRight size={13} />
              </button>
            )}
          </div>

          {!framing && !loading && (
            <div className="pt-1" data-testid="step1-sample-cta-wrap">
              <button
                type="button"
                onClick={trySample}
                className="btn-ghost inline-flex items-center gap-2 press text-[12px]"
                data-testid="step1-try-sample-btn"
              >
                <Sparkles size={12} /> Try a sample
              </button>
            </div>
          )}

          <ErrorBox msg={error} />
          <NextHintRail testid="step1-next-hint" text={framing ? "compress into what matters" : undefined} />

        </div>

        <div className={framing ? "lg:col-span-7" : ""}>
          {loading ? (
            <Step1Progress phase={phase} />
          ) : !framing ? (
            <OutputPending
              title={"{ output · pending }"}
              blurb="Paste on the left. Bracket names it in ~15s."
              loading={false}
            />
          ) : (
            <OutputCard
                testid="step1-framing-output"
                label={"{ 01 · reframed }"}
                badge={<ClarityPill score={framing.clarity_score} label={framing.clarity_label} />}
                title={framing.reframed_problem}
                blockquote={framing.what_to_name}
                scrollable
                copyText={[framing.reframed_problem, framing.what_to_name, ...(framing.tensions || []).map((t, i) => `${i + 1}. ${t}`)].filter(Boolean).join("\n\n")}
                onRegenerate={run}
                progressive
                progressiveLabels={{ summary: "Read summary", details: "Show tensions" }}
                reasoning={
                  <>
                    <p>
                      Bracket re-read your paste for the gap between <em>what you said</em> and <em>what the project actually is</em>.
                    </p>
                    {framing.clarity_label && (
                      <p className="mt-2 t-helper">
                        <span className="t-tag">clarity ·</span> {framing.clarity_label.toLowerCase()} ({framing.clarity_score}/100).
                      </p>
                    )}
                  </>
                }
                source={
                  <ul className="space-y-1.5 text-sm">
                    <li><span className="t-tag text-muted">what · </span>{project.situation_input?.what || "—"}</li>
                    <li><span className="t-tag text-muted">who · </span>{project.situation_input?.who || "—"}</li>
                    <li><span className="t-tag text-muted">unclear · </span>{project.situation_input?.unclear || "—"}</li>
                  </ul>
                }
              >
                <OutputSection label="TENSIONS TO WATCH">
                  {(framing.tensions || []).length > 0 ? (
                    <OutputList items={framing.tensions || []} variant="numbered" />
                  ) : (
                    <EmptyModuleHint
                      testid="step1-tensions-empty"
                      title="No tensions surfaced"
                      blurb="Paste more context and challenge Bracket again."
                    />
                  )}
                </OutputSection>
              </OutputCard>
          )}
        </div>
      </div>

      {framing && isSample && (
        <div className="mt-4 card-brut p-4 flex items-start gap-3 max-w-2xl" data-testid="step1-sample-done-banner">
          <Wand2 size={14} className="mt-0.5 text-signal shrink-0" />
          <div className="flex-1 flex items-center justify-between gap-3 flex-wrap">
            <p className="t-body text-[13px]">Ready for <strong>your own</strong> project?</p>
            <button
              onClick={clearSample}
              className="clay-signal px-3 py-2 t-tag press inline-flex items-center gap-1.5 whitespace-nowrap text-[11px]"
              data-testid="step1-analyze-own-btn"
            >
              Start yours <ArrowRight size={12} />
            </button>
          </div>
        </div>
      )}
    </StepShell>
    </>
  );
}

// Intermediate loader with sequential checkmarks + estimate preview.
// Shown while the AI step call is in flight (~10-20s).
// `phaseOrder` is the ordered list of phase keys for this step, used to
// compute which rows are done (past current phase) vs active vs pending.
function Step1ProgressRow({ target, phase, phaseOrder, doneLabel, activeLabel }) {
  const currentIdx = phaseOrder.indexOf(phase);
  const targetIdx = phaseOrder.indexOf(target);
  // "done" phase acts as a sentinel meaning ALL rows are done.
  const isDoneSentinel = phase === "done";
  const active = phase === target;
  const done = isDoneSentinel || (currentIdx > -1 && targetIdx > -1 && currentIdx > targetIdx);
  return (
    <li className="flex items-center gap-3" data-testid={`step1-progress-${target}`}>
      <span
        className={
          "inline-flex h-5 w-5 items-center justify-center rounded-full border shrink-0 " +
          (done
            ? "border-signal"
            : active
            ? "border-signal text-signal"
            : "border-[var(--hairline)] text-muted")
        }
        style={done ? { backgroundColor: "var(--accent)", color: "#FFFFFF", borderColor: "var(--accent)" } : undefined}
      >
        {done ? <Check size={12} /> : active ? <Loader2 size={11} className="animate-spin" /> : null}
      </span>
      <span className={"text-sm " + (done || active ? "text-[var(--text)]" : "text-muted")}>
        {done ? doneLabel : active ? activeLabel : doneLabel}
      </span>
    </li>
  );
}

function Step1Progress({ phase }) {
  return (
    <StepProgress
      phase={phase}
      testid="step1-progress"
      rows={[
        { target: "detecting", doneLabel: "Requirements detected",         activeLabel: "Detecting requirements…" },
        { target: "scanning",  doneLabel: "Clarification questions surfaced", activeLabel: "Scanning for missing questions…" },
        { target: "framing",   doneLabel: "Risks & tensions identified",   activeLabel: "Framing your problem…" },
      ]}
      estimate={[
        { n: "~8", label: "requirements" },
        { n: "~6", label: "clarifications" },
        { n: "~3", label: "risks" },
      ]}
    />
  );
}

/** Generic step-progress card used across Steps 1-4. Renders a sequence of
 *  animated checkmark rows and an estimate strip (3 tiles). Keeps user
 *  expectation calibrated during the 10-20s AI call. */
function StepProgress({ phase, rows, estimate, testid = "step-progress" }) {
  const phaseOrder = rows.map((r) => r.target);
  return (
    <div className="card-brut p-5 sm:p-6 min-h-[280px]" data-testid={testid}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="mono-label text-muted">{"{ output · generating }"}</p>
        <span className="mono-tag text-signal inline-flex items-center gap-1.5">
          <Loader2 size={12} className="animate-spin" /> BRACKET IS THINKING
        </span>
      </div>

      <ul className="mt-6 space-y-3">
        {rows.map((r) => (
          <Step1ProgressRow
            key={r.target}
            target={r.target}
            phase={phase}
            phaseOrder={phaseOrder}
            doneLabel={r.doneLabel}
            activeLabel={r.activeLabel}
          />
        ))}
      </ul>

      {estimate && estimate.length > 0 && (
        <div className="mt-6 pt-5 border-t border-[var(--hairline)]">
          <p className="mono-tag text-muted mb-3">ESTIMATE</p>
          <div className="grid grid-cols-3 gap-3">
            {estimate.map((e, i) => (
              <div key={i} className="text-center">
                <p className="text-xl font-semibold">{e.n}</p>
                <p className="text-xs text-muted mt-1">{e.label}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


function Step2({ project, setProject, dirtyRef, onDone, onBack }) {
  const initial = project.context_input || { raw_paste: "", requirements: "", constraints: "", inspirations: "" };
  const [form, setForm] = useState({ raw_paste: "", ...initial });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [phase, setPhase] = useState(null);
  const compressed = project.context;
  const { confirm: confirmDialog } = useDialog();
  const pasteRef = useRef(null);

  const pickQuestion = (q) => {
    const stub = `Q: ${q}\nA: `;
    const cur = (form.raw_paste || "").trimEnd();
    const next = cur ? `${cur}\n\n${stub}` : stub;
    setForm({ ...form, raw_paste: next });
    // Focus + drop caret at end so the user can start typing the answer.
    requestAnimationFrame(() => {
      const el = pasteRef.current;
      if (!el) return;
      el.focus();
      const len = next.length;
      try { el.setSelectionRange(len, len); } catch { /* noop */ }
      el.scrollTop = el.scrollHeight;
    });
  };

  useEffect(() => {
    if (!dirtyRef) return;
    dirtyRef.current = !!form.raw_paste && !compressed;
    return () => { if (dirtyRef) dirtyRef.current = false; };
  }, [form, compressed, dirtyRef]);

  const run = async () => {
    // Cascade guard on re-runs.
    if (project.context) {
      const guard = await guardStepRework(2, project, confirmDialog);
      if (!guard) return;
      if (guard !== true) setProject(guard);
    }
    setLoading(true);
    setError("");
    setPhase("reading");
    const t1 = setTimeout(() => setPhase("cutting"), 1200);
    const t2 = setTimeout(() => setPhase("naming"), 3200);
    try {
      const { data } = await api.post(`/projects/${project.id}/context`, { raw_paste: form.raw_paste });
      setProject(data);
      setPhase("done");
    } catch (e) {
      setError(formatApiError(e));
      setPhase(null);
    } finally {
      clearTimeout(t1);
      clearTimeout(t2);
      setLoading(false);
    }
  };

  const canSubmit = !loading && (form.raw_paste || "").trim().length > 0;

  return (
    <StepShell
      num={2}
      label="Simplify"
      ask={!compressed}
      title={compressed ? "Here's what actually matters." : "What else should Bracket see?"}
      kicker={compressed ? "Noise cut. Assumptions surfaced." : "Anything more — Slack, notes, references. Bracket keeps only what moves the call."}
      previously={project?.framing?.reframed_problem}
      nextUp={compressed ? [] : ["Key signals", "Noise removed", "Hidden assumptions"]}
      celebration={compressed ? (
        <CelebrationChips
          milestone="Signals compressed"
          items={[
            { key: "words",       label: "words",       count: wordCount(project.context_input?.raw_paste || form.raw_paste) },
            { key: "signals",     label: "signals",     count: (compressed.key_signals || []).length },
            { key: "noise",       label: "noise cut",   count: (compressed.noise_removed || []).length },
            { key: "assumptions", label: "assumptions", count: (compressed.hidden_assumptions || []).length },
          ]}
        />
      ) : null}
    >
      <div className={compressed ? "grid lg:grid-cols-12 gap-5" : "grid lg:grid-cols-2 gap-5"}>
        <div className={compressed ? "space-y-3 lg:col-span-5" : "space-y-3"} data-testid="step2-form">
          {!compressed && (project.open_questions?.context?.length > 0) && (
            <OpenQuestions
              testid="step2-open-questions"
              label="Bracket still needs your read on"
              items={project.open_questions.context}
              onPick={pickQuestion}
            />
          )}
          <Field
            label="Paste anything about this project"
            testid="step2-paste"
            helper="Requirements · constraints · references · timelines. Dump it all."
          >
            <textarea
              ref={pasteRef}
              className="textarea-brut"
              rows={6}
              value={form.raw_paste || ""}
              onChange={(e) => setForm({ ...form, raw_paste: e.target.value })}
              placeholder="Paste the brief. Paste the Slack thread. Paste your notes."
              data-testid="step2-paste-input"
            />
            {form.raw_paste && (
              <p className="mt-1.5 text-[11px] text-muted" data-testid="step2-word-count">
                {wordCount(form.raw_paste)} words
              </p>
            )}
          </Field>

          <div className="flex items-center gap-3 flex-wrap">
            <button onClick={onBack} className="btn-ghost" data-testid="step2-back-btn">
              <ArrowLeft size={13} /> Back
            </button>
            <button
              onClick={run}
              disabled={!canSubmit}
              className="clay-signal px-4 py-2.5 t-tag press inline-flex items-center justify-center gap-2 whitespace-nowrap"
              data-testid="step2-submit-btn"
            >
              {loading ? (
                <>
                  <Loader2 size={13} className="animate-spin" /> Compressing…
                </>
              ) : compressed ? (
                <>
                  <RefreshCw size={13} /> Recompress
                </>
              ) : (
                <>
                  Compress <ArrowRight size={13} />
                </>
              )}
            </button>
            {compressed && (
              <button onClick={onDone} className="btn-ghost" data-testid="step2-continue-btn">
                Continue <ArrowRight size={13} />
              </button>
            )}
          </div>
          <ErrorBox msg={error} />
          <NextHintRail testid="step2-next-hint" text={compressed ? "pick the call" : undefined} />

        </div>

        <div className={compressed ? "lg:col-span-7" : ""}>
          {loading ? (
            <StepProgress
              phase={phase}
              testid="step2-progress"
              rows={[
                { target: "reading", doneLabel: "Requirements read",     activeLabel: "Reading everything…" },
                { target: "cutting", doneLabel: "Noise cut",              activeLabel: "Cutting what doesn't move the call…" },
                { target: "naming",  doneLabel: "The one thing named",   activeLabel: "Naming what matters…" },
              ]}
              estimate={[
                { n: "~5", label: "signals" },
                { n: "~4", label: "assumptions" },
                { n: "1", label: "insight" },
              ]}
            />
          ) : !compressed ? (
            <OutputPending
              title={"{ output · pending }"}
              blurb="Bracket keeps only what moves the needle."
              loading={false}
            />
          ) : (
            <OutputCard
              testid="step2-context-output"
              label={"{ 02 · what actually matters }"}
              blockquote={compressed.what_actually_matters}
              scrollable
              copyText={[
                compressed.what_actually_matters,
                (compressed.key_signals || []).length ? `KEY SIGNALS\n${(compressed.key_signals || []).map((s) => `→ ${s}`).join("\n")}` : "",
                (compressed.noise_removed || []).length ? `NOISE REMOVED\n${(compressed.noise_removed || []).map((s) => `× ${s}`).join("\n")}` : "",
                (compressed.hidden_assumptions || []).length ? `HIDDEN ASSUMPTIONS\n${(compressed.hidden_assumptions || []).map((s) => `! ${s}`).join("\n")}` : "",
              ].filter(Boolean).join("\n\n")}
              onRegenerate={run}
              progressive
              progressiveLabels={{ summary: "Read the insight", details: "Show signals & noise" }}
              reasoning={
                <>
                  <p>
                    Anything that didn&apos;t <em>change the call</em> was moved to &quot;noise removed&quot;.
                    Hidden assumptions are what everyone acts on but nobody said aloud.
                  </p>
                </>
              }
              source={
                <ul className="space-y-1.5 text-sm">
                  <li><span className="t-tag text-muted">requirements · </span>{(form.requirements || project.context_input?.requirements || "—").slice(0, 220)}{(form.requirements || "").length > 220 ? "…" : ""}</li>
                  <li><span className="t-tag text-muted">constraints · </span>{form.constraints || project.context_input?.constraints || "—"}</li>
                  <li><span className="t-tag text-muted">inspirations · </span>{form.inspirations || project.context_input?.inspirations || "—"}</li>
                </ul>
              }
            >
              <OutputSection label="KEY SIGNALS">
                {(compressed.key_signals || []).length > 0 ? (
                  <OutputList items={compressed.key_signals || []} variant="arrow" />
                ) : (
                  <EmptyModuleHint
                    testid="step2-signals-empty"
                    title="No key signals extracted"
                    blurb="Bracket read your paste but didn't find distinct signals worth keeping. Try adding more of the raw conversation — Slack threads, call transcripts, brand references — and challenge it again."
                  />
                )}
              </OutputSection>
              <OutputSection label="NOISE REMOVED">
                {(compressed.noise_removed || []).length > 0 ? (
                  <OutputList items={compressed.noise_removed || []} variant="strike" />
                ) : (
                  <EmptyModuleHint
                    testid="step2-noise-empty"
                    title="Nothing struck as noise"
                    blurb="Every line in your paste seemed load-bearing. If that feels off, paste the fuller version of the brief — Bracket is best at cutting once it has too much to read."
                  />
                )}
              </OutputSection>
              {compressed.hidden_assumptions?.length > 0 ? (
                <OutputSection label="HIDDEN ASSUMPTIONS">
                  <OutputList items={compressed.hidden_assumptions} variant="danger" />
                </OutputSection>
              ) : (
                <OutputSection label="HIDDEN ASSUMPTIONS">
                  <EmptyModuleHint
                    testid="step2-assumptions-empty"
                    title="No hidden assumptions surfaced"
                    blurb="Bracket will call out things everyone acts on but nobody said aloud — the quiet reasons projects go sideways. Add more context (kickoff notes, WhatsApp, references) to give it more to catch."
                  />
                </OutputSection>
              )}
            </OutputCard>
          )}
        </div>
      </div>
    </StepShell>
  );
}

function Step3({ project, setProject, dirtyRef, onDone, onBack }) {
  const initial = project.decision_input || { raw_paste: "", optimizing_for: "", tradeoffs: "", risks: "" };
  const [form, setForm] = useState({ raw_paste: "", ...initial });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [phase, setPhase] = useState(null);
  const [showAlternatives, setShowAlternatives] = useState(false);
  const decision = project.decision;
  const { confirm: confirmDialog } = useDialog();
  const pasteRef = useRef(null);

  const pickQuestion = (q) => {
    const stub = `Q: ${q}\nA: `;
    const cur = (form.raw_paste || "").trimEnd();
    const next = cur ? `${cur}\n\n${stub}` : stub;
    setForm({ ...form, raw_paste: next });
    requestAnimationFrame(() => {
      const el = pasteRef.current;
      if (!el) return;
      el.focus();
      const len = next.length;
      try { el.setSelectionRange(len, len); } catch { /* noop */ }
      el.scrollTop = el.scrollHeight;
    });
  };

  useEffect(() => {
    if (!dirtyRef) return;
    dirtyRef.current = !!form.raw_paste && !decision;
    return () => { if (dirtyRef) dirtyRef.current = false; };
  }, [form, decision, dirtyRef]);

  const run = async () => {
    if (project.decision) {
      const guard = await guardStepRework(3, project, confirmDialog);
      if (!guard) return;
      if (guard !== true) setProject(guard);
    }
    setLoading(true);
    setError("");
    setPhase("weighing");
    const t1 = setTimeout(() => setPhase("picking"), 1500);
    const t2 = setTimeout(() => setPhase("stress"), 3500);
    try {
      const { data } = await api.post(`/projects/${project.id}/decision`, { raw_paste: form.raw_paste });
      setProject(data);
      setPhase("done");
    } catch (e) {
      setError(formatApiError(e));
      setPhase(null);
    } finally {
      clearTimeout(t1);
      clearTimeout(t2);
      setLoading(false);
    }
  };

  const canSubmit = !loading && (form.raw_paste || "").trim().length > 0;

  return (
    <StepShell
      num={3}
      label="Strategy"
      ask={!decision}
      title={decision ? "The call is in." : "What's your read?"}
      kicker={decision ? "A stance, not a menu." : "What matters most, what you'd trade off, what worries you. A paragraph is plenty."}
      previously={project?.context?.what_actually_matters}
      nextUp={decision ? [] : ["The call", "Alternatives", "Trade-offs", "Risks"]}
      celebration={decision ? (
        <CelebrationChips
          milestone="Decision made"
          items={[
            { key: "confidence",   label: "confidence",   count: decision.recommendation?.confidence || 0 },
            { key: "alternatives", label: "alternatives", count: (decision.alternatives || []).length },
            { key: "risks",        label: "risks",        count: (decision.risks || []).length },
          ]}
        />
      ) : null}
    >
      <div className={decision ? "grid lg:grid-cols-12 gap-5" : "grid lg:grid-cols-2 gap-5"}>
        <div className={decision ? "space-y-3 lg:col-span-5" : "space-y-3"} data-testid="step3-form">
          {!decision && (project.open_questions?.decision?.length > 0) && (
            <OpenQuestions
              testid="step3-open-questions"
              label="Bracket still needs your read on"
              items={project.open_questions.decision}
              onPick={pickQuestion}
            />
          )}
          <Field
            label="Paste your thinking on this decision"
            testid="step3-paste"
            helper="What matters most · trade-offs · worries · non-negotiables."
          >
            <textarea
              ref={pasteRef}
              className="textarea-brut"
              rows={6}
              value={form.raw_paste || ""}
              onChange={(e) => setForm({ ...form, raw_paste: e.target.value })}
              placeholder="e.g. Speed over polish. Cut About + Blog pages. Worried the founder will push back on cutting the demo video."
              data-testid="step3-paste-input"
            />
            {form.raw_paste && (
              <p className="mt-1.5 text-[11px] text-muted" data-testid="step3-word-count">
                {wordCount(form.raw_paste)} words
              </p>
            )}
          </Field>

          <div className="flex items-center gap-3 flex-wrap">
            <button onClick={onBack} className="btn-ghost" data-testid="step3-back-btn">
              <ArrowLeft size={13} /> Back
            </button>
            <button
              onClick={run}
              disabled={!canSubmit}
              className="clay-signal px-4 py-2.5 t-tag press inline-flex items-center justify-center gap-2 whitespace-nowrap"
              data-testid="step3-submit-btn"
            >
              {loading ? (
                <>
                  <Loader2 size={13} className="animate-spin" /> Deciding…
                </>
              ) : decision ? (
                <>
                  <RefreshCw size={13} /> Re-decide
                </>
              ) : (
                <>
                  Decide <ArrowRight size={13} />
                </>
              )}
            </button>
            {decision && (
              <button onClick={onDone} className="btn-ghost" data-testid="step3-continue-btn">
                Continue <ArrowRight size={13} />
              </button>
            )}
          </div>
          <ErrorBox msg={error} />
          <NextHintRail testid="step3-next-hint" text={decision ? "artifacts next" : undefined} />

        </div>

        <div className={decision ? "lg:col-span-7" : ""}>
          {loading ? (
            <StepProgress
              phase={phase}
              testid="step3-progress"
              rows={[
                { target: "weighing", doneLabel: "Options weighed",       activeLabel: "Weighing trade-offs…" },
                { target: "picking",  doneLabel: "The call picked",        activeLabel: "Picking a side…" },
                { target: "stress",   doneLabel: "Risks stress-tested",   activeLabel: "Stress-testing…" },
              ]}
              estimate={[
                { n: "1", label: "recommendation" },
                { n: "~3", label: "alternatives" },
                { n: "~4", label: "risks" },
              ]}
            />
          ) : !decision ? (
            <OutputPending
              title={"{ the call · pending }"}
              blurb="A stance, not a menu."
              loading={false}
            />
          ) : (
            <div className="output-card--scrollable space-y-6 pr-1" data-testid="step3-decision-output">
              <OutputCard
                testid="step3-recommendation-output"
                label={"{ 03 · recommendation }"}
                confidence={decision.recommendation?.confidence}
                title={decision.recommendation?.title}
                blockquote={decision.recommendation?.rationale}
                copyText={`THE CALL\n${decision.recommendation?.title || ""}\n\n${decision.recommendation?.rationale || ""}\n\nConfidence: ${decision.recommendation?.confidence ?? 0}%`}
                onRegenerate={run}
                progressive
                progressiveLabels={{ summary: "Read the rationale" }}
                reasoning={
                  <>
                    <p>
                      Given your optimisation target — <em>{form.optimizing_for || project.decision_input?.optimizing_for || "—"}</em> — Bracket scored each plausible direction against your signals from Step 02, then picked the one with the cleanest path to the target.
                    </p>
                    <p className="mt-2 t-helper">
                      Confidence is shown above. Anything below ~70% means the inputs are still ambiguous — go back to Step 01 / 02 and tighten them before locking in.
                    </p>
                  </>
                }
                source={
                  <ul className="space-y-1.5 text-sm">
                    <li><span className="t-tag text-muted">optimising for · </span>{form.optimizing_for || project.decision_input?.optimizing_for || "—"}</li>
                    <li><span className="t-tag text-muted">don&apos;t break · </span>{form.dont_break || project.decision_input?.dont_break || "—"}</li>
                    <li><span className="t-tag text-muted">key signals · </span>{(project.context?.key_signals || []).join(", ") || "—"}</li>
                  </ul>
                }
              />

              {!showAlternatives && (decision.alternatives?.length > 0 || decision.tradeoffs?.length > 0 || decision.risks?.length > 0) && (
                <button
                  type="button"
                  onClick={() => setShowAlternatives(true)}
                  className="disc-btn"
                  data-testid="step3-reveal-more"
                >
                  <span className="chev">↓</span> Show alternatives, trade-offs & risks
                </button>
              )}

              {showAlternatives && (
                <>
                  {decision.alternatives?.length > 0 ? (
                    <OutputCard label={"{ 03 · alternatives }"}>
                      <div className="space-y-4">
                        {decision.alternatives.map((a, i) => (
                          <div
                            key={i}
                            className="border-t border-[var(--hairline)] pt-4 first:border-t-0 first:pt-0"
                          >
                            <p className="t-h3">{a.title}</p>
                            <p className="text-sm text-muted mt-1">
                              <span className="mono-tag">WHEN →</span> {a.when_to_choose}
                            </p>
                            <p className="text-sm text-muted mt-1">
                              <span className="mono-tag">COST →</span> {a.cost}
                            </p>
                          </div>
                        ))}
                      </div>
                    </OutputCard>
                  ) : (
                    <OutputCard label={"{ 03 · alternatives }"}>
                      <EmptyModuleHint
                        testid="step3-alternatives-empty"
                        title="No alternative paths worth naming"
                        blurb="Bracket thought about the other directions and none stacked up. If you want to force it, challenge the call above — Bracket will re-argue and surface the runner-up."
                      />
                    </OutputCard>
                  )}

                  {decision.tradeoffs?.length > 0 ? (
                    <OutputCard label={"{ 03 · trade-offs }"}>
                      <OutputList items={decision.tradeoffs} variant="arrow" />
                    </OutputCard>
                  ) : (
                    <OutputCard label={"{ 03 · trade-offs }"}>
                      <EmptyModuleHint
                        testid="step3-tradeoffs-empty"
                        title="No trade-offs called out"
                        blurb="Bracket didn't find a meaningful cost to this direction. That's suspicious. Every decision costs something — challenge the recommendation and ask what you're giving up."
                      />
                    </OutputCard>
                  )}

                  {decision.risks?.length > 0 ? (
                    <OutputCard label={"{ 03 · risks }"}>
                      <OutputList items={decision.risks} variant="severity" />
                    </OutputCard>
                  ) : (
                    <OutputCard label={"{ 03 · risks }"}>
                      <EmptyModuleHint
                        testid="step3-risks-empty"
                        title="No risks yet — we'll surface them as you iterate"
                        blurb="Bracket will call out the risks your client never mentioned before they happen. Add more context in Step 02 (or paste the fuller brief) and challenge the call again to stress-test it."
                      />
                    </OutputCard>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </StepShell>
  );
}

function Step4({ project, setProject, dirtyRef, onDone, onBack }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [phase, setPhase] = useState(null);
  const [revealMore, setRevealMore] = useState(false);
  const artifacts = project.artifacts;

  const run = async () => {
    setLoading(true);
    setError("");
    setPhase("scope");
    const t1 = setTimeout(() => setPhase("message"), 1800);
    const t2 = setTimeout(() => setPhase("risks"), 4500);
    try {
      const { data } = await api.post(`/projects/${project.id}/artifacts`);
      setProject(data);
      setPhase("done");
    } catch (e) {
      setError(formatApiError(e));
      setPhase(null);
    } finally {
      clearTimeout(t1);
      clearTimeout(t2);
      setLoading(false);
    }
  };

  // Auto-start generation on mount IF artifacts don't yet exist for the
  // current decision. Run only once per mount; user can still re-trigger via
  // the "Regenerate" button below.
  const autoRanRef = useRef(false);
  useEffect(() => {
    if (autoRanRef.current) return;
    autoRanRef.current = true;
    if (!artifacts && !loading) {
      run();
    }
  }, []);

  // No editable inputs on this step, so dirty state is always false.
  useEffect(() => {
    if (dirtyRef) dirtyRef.current = false;
  }, [dirtyRef]);

  return (
    <StepShell
      num={4}
      label="Execution"
      title={artifacts ? "Ready to send." : "Give it a paper trail."}
      kicker={artifacts ? "Scope · message · assumptions · risks." : "Scope, message, assumptions, risks — drafted from your stance."}
      previously={project?.decision?.recommendation?.title}
      nextUp={artifacts ? [] : ["Scope doc", "Client message", "Risk flags", "Assumptions"]}
      celebration={artifacts ? (
        <CelebrationChips
          milestone="Artifacts drafted"
          items={[
            { key: "deliverables", label: "deliverables", count: (artifacts.scope_doc?.deliverables || []).length },
            { key: "in-scope",     label: "in scope",     count: (artifacts.scope_doc?.in_scope || []).length },
            { key: "risks",        label: "risks",        count: (artifacts.risk_flags || []).length },
          ]}
        />
      ) : null}
    >
      <div className="flex gap-3 items-center flex-wrap">
        <button onClick={onBack} className="btn-ghost" data-testid="step4-back-btn">
          <ArrowLeft size={13} /> Back
        </button>
        <button
          onClick={run}
          disabled={loading || !project?.decision?.recommendation?.title}
          className="clay-signal px-4 py-2.5 t-tag press inline-flex items-center justify-center gap-2 whitespace-nowrap"
          data-testid="step4-generate-btn"
        >
          {loading ? (
            <>
              <Loader2 size={13} className="animate-spin" /> Generating…
            </>
          ) : artifacts ? (
            <>
              <RefreshCw size={13} /> Regenerate
            </>
          ) : (
            <>
              Generate artifacts <ArrowRight size={13} />
            </>
          )}
        </button>
        {artifacts && (
          <button onClick={onDone} className="btn-ghost" data-testid="step4-continue-btn">
            Lock the decision <ArrowRight size={13} />
          </button>
        )}
      </div>
      <ErrorBox msg={error} />
      <NextHintRail testid="step4-next-hint" text={artifacts ? "lock it in" : undefined} />


      {loading ? (
        <div className="mt-5">
          <StepProgress
            phase={phase}
            testid="step4-progress"
            rows={[
              { target: "scope",   doneLabel: "Scope drafted",             activeLabel: "Drafting scope…" },
              { target: "message", doneLabel: "Client message written",    activeLabel: "Writing the message…" },
              { target: "risks",   doneLabel: "Risks + assumptions flagged", activeLabel: "Flagging risks…" },
            ]}
            estimate={[
              { n: "1", label: "scope doc" },
              { n: "1", label: "message" },
              { n: "~5", label: "risks" },
            ]}
          />
        </div>
      ) : !artifacts ? (
        <div className="mt-5">
          <OutputPending
            title={"{ artifacts · pending }"}
            blurb="Drafting scope, message, risks."
            loading={false}
          />
        </div>
      ) : (
        <div className="mt-4" data-testid="step4-artifacts-output">
          <div className="space-y-5 output-card--scrollable pr-1">
            <div className="grid md:grid-cols-2 gap-5">
              <OutputCard
                testid="artifact-SCOPE_DOC"
                label={"{ 04 · scope }"}
                badge={<span className="mono-tag text-signal">DRAFT</span>}
                title={artifacts.scope_doc?.title || "Scope"}
              >
                <BlockList label="IN SCOPE" items={artifacts.scope_doc?.in_scope} />
                <BlockList label="OUT OF SCOPE" items={artifacts.scope_doc?.out_of_scope} muted />
                <BlockList label="DELIVERABLES" items={artifacts.scope_doc?.deliverables} />
                {artifacts.scope_doc?.timeline_note && (
                  <div className="mt-4 border-t border-[var(--hairline)] pt-4">
                    <p className="mono-tag text-muted">TIMELINE</p>
                    <p className="mt-1 text-sm">{artifacts.scope_doc.timeline_note}</p>
                  </div>
                )}
              </OutputCard>

              <OutputCard
                testid="artifact-CLIENT_MESSAGE"
                label={"{ 04 · client message }"}
                badge={<span className="mono-tag text-signal">DRAFT</span>}
                title="Client message"
              >
                <div className="whitespace-pre-wrap leading-relaxed text-sm">
                  {artifacts.client_message}
                </div>
                <CopyButton text={artifacts.client_message} />
              </OutputCard>
            </div>

            {/* Progressive reveal: assumptions + risk flags are secondary. */}
            {!revealMore && (
              <button
                type="button"
                onClick={() => setRevealMore(true)}
                className="disc-btn"
                data-testid="step4-reveal-more"
              >
                <span className="chev">↓</span> Show assumptions & risk flags
              </button>
            )}

            {revealMore && (
              <div className="grid md:grid-cols-2 gap-5 animate-fade-up">
                <OutputCard
                  testid="artifact-ASSUMPTIONS"
                  label={"{ 04 · assumptions }"}
                  badge={<span className="mono-tag text-signal">DRAFT</span>}
                  title="Assumptions"
                >
                  <OutputList items={artifacts.assumptions || []} variant="numbered" />
                </OutputCard>

                <OutputCard
                  testid="artifact-RISK_FLAGS"
                  label={"{ 04 · risk flags }"}
                  badge={<span className="mono-tag text-signal">DRAFT</span>}
                  title="Risk flags"
              >
                <OutputList
                  items={(artifacts.risk_flags || []).map((r) => ({
                    severity: r.severity,
                    flag: r.flag,
                    why: r.why,
                  }))}
                  variant="severity"
                />
              </OutputCard>
            </div>
          )}
          </div>
        </div>
      )}
    </StepShell>
  );
}

function GuestUpgradeBanner() {
  const { user, refresh } = useAuth();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [done, setDone] = useState(false);

  if (!user?.is_guest || dismissed || done) return null;

  const submit = async (e) => {
    e?.preventDefault?.();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      toast.error("That email doesn't look right.");
      return;
    }
    setSaving(true);
    try {
      await api.post("/auth/me/email", { email: email.trim().toLowerCase(), name: name.trim() });
      await refresh();
      setDone(true);
      toast.success("Saved. You'll find this project next time you sign in.");
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="card-brut p-5 sm:p-6 mt-6 relative overflow-hidden guest-upgrade"
      data-testid="guest-upgrade-banner"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="mono-label text-signal">{"< save it for later >"}</p>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="text-[var(--text-3)] hover:text-[var(--text)] press shrink-0 -mt-1 -mr-1 h-8 w-8 inline-flex items-center justify-center rounded-full hover:bg-[var(--surface-2)]"
          data-testid="guest-upgrade-dismiss"
          aria-label="Dismiss"
        >
          <X size={16} />
        </button>
      </div>
      <h3 className="t-h2 mt-3">
        Want to come back to this?
      </h3>
      <p className="text-sm mt-2 text-[var(--text-2)]">
        You signed in as a guest. Drop your email + name so this project lives in your
        dashboard the next time you sign in.
      </p>
      <form onSubmit={submit} className="mt-5 grid sm:grid-cols-2 gap-3">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@studio.com"
          className="input-brut"
          data-testid="guest-upgrade-email"
        />
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name (optional)"
          className="input-brut"
          data-testid="guest-upgrade-name"
        />
        <div className="sm:col-span-2 flex gap-3 items-center mt-2 flex-wrap">
          <button
            type="submit"
            disabled={saving || !email}
            className="clay-signal px-4 py-2.5 t-tag press inline-flex items-center gap-2 disabled:opacity-40"
            data-testid="guest-upgrade-submit"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : null}
            {saving ? "Saving…" : "Save for later"}
          </button>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            disabled={saving}
            className="btn-ghost mono-tag"
            data-testid="guest-upgrade-skip"
          >
            Skip — I&apos;m good
          </button>
        </div>
      </form>
    </div>
  );
}

function Step5({ project, setProject, onBack, onExport, projectId }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const isLocked = project.status === "locked";

  const lock = async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.post(`/projects/${project.id}/lock`);
      setProject(data);
    } catch (e) {
      setError(formatApiError(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <StepShell
      num={5}
      label="Review"
      title={isLocked ? "Locked. Survives the room." : "Lock the call."}
      kicker={isLocked ? "Ready to send. Open the doc or download PDF." : "Lock so it survives the next brief change."}
      previously={project?.decision?.recommendation?.title}
      nextUp={isLocked ? [] : ["Locked doc", "PDF export", "Share link"]}
      nextHint={isLocked ? "send · sign · ship" : undefined}
    >
      <GuestUpgradeBanner />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mt-5">
        <div className="lg:col-span-2 space-y-5">
          <OutputCard
            label={"{ 05 · the stance }"}
            title={project.decision?.recommendation?.title}
            blockquote={project.decision?.recommendation?.rationale}
            copyText={`THE STANCE\n${project.decision?.recommendation?.title || ""}\n\n${project.decision?.recommendation?.rationale || ""}`}
          />

          <div className="card-brut p-4 sm:p-5">
            <p className="mono-label text-muted">{"< what to expect >"}</p>
            <ul className="mt-3 space-y-2 text-sm">
              <li className="flex gap-3">
                <span className="font-mono text-signal shrink-0">→</span>
                <span className="text-[var(--text)]">Client will likely push back on scope items 2 and 3.</span>
              </li>
              <li className="flex gap-3">
                <span className="font-mono text-signal shrink-0">→</span>
                <span className="text-[var(--text)]">The timeline trade-off surfaces at week 2.</span>
              </li>
              <li className="flex gap-3">
                <span className="font-mono text-signal shrink-0">→</span>
                <span className="text-[var(--text)]">
                  If they ask &quot;can we reduce the price?&quot; — your message is drafted.
                </span>
              </li>
            </ul>
          </div>
        </div>

        <div className="space-y-4">
          {isLocked ? (
            <div className="card-brut p-4 sm:p-5 relative overflow-hidden step5-locked-card" data-testid="step5-locked">
              <div className="flex items-center gap-2">
                <Lock size={16} className="text-signal" /> <p className="mono-tag text-signal">LOCKED</p>
              </div>
              <h3 className="t-h1 mt-2 text-[22px] sm:text-[24px]">Confidence, captured.</h3>
              <p className="mt-2 text-[13px] text-[var(--text-2)]">
                Open the doc, download PDF, or share the review link.
              </p>
              <Link
                to={`/project/${projectId}/document`}
                className="clay-signal px-4 py-2.5 t-tag press inline-flex items-center justify-center gap-2 mt-4 w-full"
                data-testid="step5-open-document-btn"
              >
                <FileText size={13} /> Open document
              </Link>
              <button
                onClick={onExport}
                className="btn-ghost mt-3 w-full justify-center"
                data-testid="step5-export-btn"
              >
                <Download size={14} /> Quick PDF download
              </button>
            </div>
          ) : (
            <div className="card-brut p-5 sm:p-6">
              <p className="mono-label">{"{ ready? }"}</p>
              <p className="mt-3 text-sm">
                Lock the decision to mark it final. The polished document opens inside Bracket — share it
                with your client or download a PDF from there.
              </p>
              <button
                onClick={onBack}
                className="btn-ghost mt-5 w-full justify-center"
                data-testid="step5-back-btn"
              >
                <ArrowLeft size={14} /> Back
              </button>
              <button
                onClick={lock}
                disabled={loading}
                className="btn-brut mt-3 w-full justify-center"
                data-testid="step5-lock-btn"
              >
                {loading ? (
                  "Locking…"
                ) : (
                  <>
                    <Lock size={14} /> Lock the decision
                  </>
                )}
              </button>
              <ErrorBox msg={error} />
            </div>
          )}
        </div>
      </div>

      {isLocked && (
        <div
          className="mt-10 card-brut p-6 sm:p-8 relative overflow-hidden animate-fade-up"
          data-testid="step5-second-project-nudge"
          style={{
            background:
              "linear-gradient(135deg, rgba(255,255,255, 0.10) 0%, var(--surface) 60%)",
            borderColor: "rgba(255,255,255, 0.25)",
          }}
        >
          <p className="mono-label text-signal">{"{ next client · ready? }"}</p>
          <div className="mt-3 flex items-start justify-between gap-6 flex-wrap">
            <div className="max-w-2xl">
              <h3 className="t-h1">Ready for your next client?</h3>
              <p className="mt-3 text-sm text-[var(--text-2)] leading-relaxed">
                This project is locked and won&apos;t survive the next brief change without you noticing.
                Bracket works best when it&apos;s the first thing you open — before you write the reply,
                before you say yes, before you fill the Notion doc. Start the next one now while
                the workflow is fresh.
              </p>
            </div>
            <Link
              to="/app"
              className="clay-signal px-5 py-3 t-tag press inline-flex items-center justify-center gap-2 whitespace-nowrap"
              data-testid="step5-new-project-btn"
            >
              Start a new project <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      )}
    </StepShell>
  );
}
function Field({ label, children, testid, helper }) {
  return (
    <label className="block" data-testid={testid}>
      <span className="mono-tag text-muted">{label}</span>
      <div className="mt-2">{children}</div>
      {helper && (
        <p className="mt-1.5 text-xs text-muted leading-relaxed" data-testid={testid ? `${testid}-helper` : undefined}>
          {helper}
        </p>
      )}
    </label>
  );
}

function SkeletonLine({ short }) {
  return <div className={`h-3 bg-faint ${short ? "w-1/2" : "w-full"}`} />;
}

function ClarityPill({ score = 0, label = "" }) {
  const cfg =
    score >= 75
      ? { bg: "#22C55E", fg: "#0A0A0C", border: "#22C55E" } // safe green + dark text
      : score >= 40
      ? { bg: "#F3F4F6", fg: "#0A0A0C", border: "#F3F4F6" } // ink light + dark text
      : { bg: "#EF4444", fg: "#FFFFFF", border: "#EF4444" }; // danger red + white text
  return (
    <span
      className="mono-tag px-2 py-1 rounded"
      style={{ backgroundColor: cfg.bg, color: cfg.fg, border: `1px solid ${cfg.border}` }}
      data-testid="clarity-pill"
    >
      {label || "CLARITY"} · {score}
    </span>
  );
}

function SeverityPill({ level = "LOW" }) {
  const cfg = {
    HIGH:   { bg: "#EF4444", fg: "#FFFFFF", border: "#EF4444" },
    MEDIUM: { bg: "#F3F4F6", fg: "#0A0A0C", border: "#F3F4F6" },
    LOW:    { bg: "transparent", fg: "#9CA3AF", border: "#262A36" },
  }[level] || { bg: "transparent", fg: "#9CA3AF", border: "#262A36" };
  return (
    <span
      className="mono-tag px-2 py-1 h-fit shrink-0 rounded"
      style={{ backgroundColor: cfg.bg, color: cfg.fg, border: `1px solid ${cfg.border}` }}
    >
      {level}
    </span>
  );
}

function ArtifactCard({ title, kind, children }) {
  return (
    <div className="card-brut p-5 sm:p-6" data-testid={`artifact-${kind}`}>
      <div className="flex items-center justify-between">
        <p className="mono-label">{kind.replace("_", " ")}</p>
        <span className="mono-tag text-signal">DRAFT</span>
      </div>
      <h3 className="t-h2 mt-3">{title}</h3>
      <div className="mt-5 space-y-4">{children}</div>
    </div>
  );
}

// ---- Unified output primitives ----
// Used by every step so the AI-generated output looks identical in card style,
// header layout, title size, section labels, and list item formatting.

function OutputCard({
  label,
  badge,
  title,
  blockquote,
  children,
  testid,
  copyText,
  onRegenerate,
  onEdit,
  reasoning,
  source,
  confidence,
  progressive = false,
  progressiveLabels = {},
  sourceLabel,
  scrollable = false,
}) {
  const [copied, setCopied] = useState(false);
  // Auto-show the primary output as soon as AI processing completes.
  // (Previously required the user to click "Read summary" first — bad UX.)
  const [revealSummary, setRevealSummary] = useState(true);
  const [revealDetails, setRevealDetails] = useState(!progressive);
  const doCopy = async () => {
    try {
      await navigator.clipboard.writeText(copyText || `${title || ""}\n\n${blockquote || ""}`.trim());
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // clipboard can fail on insecure origins / sandboxed iframes; silent
    }
  };
  const hasActions = Boolean(copyText || onRegenerate || onEdit);
  // In progressive mode, hide action buttons until user has revealed the summary.
  const showActions = hasActions && (!progressive || revealSummary);
  const summaryBtnLabel = progressiveLabels.summary || "Read summary";
  const detailsBtnLabel = progressiveLabels.details || "Show more";
  const finalSourceLabel = sourceLabel || (progressive ? "Show assumptions" : "What this is based on");
  return (
    <div
      className={`output-card-wrap liquid-glass p-5 sm:p-6 animate-scale-in ${scrollable ? "output-card--scrollable" : ""}`}
      data-testid={testid}
    >
      <div className="flex items-start justify-between gap-3 relative z-10">
        <div className="flex items-center gap-3 flex-wrap min-w-0">
          <p className="t-tag text-muted">{label}</p>
          {confidence !== undefined && confidence !== null && (
            <span className="conf-ribbon" data-testid={testid ? `${testid}-confidence` : undefined}>
              CONF <span className="num">{confidence}%</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {badge}
          {showActions && (
            <div className="output-actions animate-fade-up" data-testid={testid ? `${testid}-actions` : undefined}>
              {copyText !== undefined && (
                <button
                  type="button"
                  onClick={doCopy}
                  className={`output-action-btn ${copied ? "is-success" : ""}`}
                  data-testid={testid ? `${testid}-copy` : "output-copy"}
                  title="Copy output"
                  aria-label="Copy output"
                >
                  {copied ? <Check size={11} /> : <Copy size={11} />}
                  {copied ? "Copied" : "Copy"}
                </button>
              )}
              {onEdit && (
                <button
                  type="button"
                  onClick={onEdit}
                  className="output-action-btn"
                  data-testid={testid ? `${testid}-edit` : "output-edit"}
                  title="Refine with AI"
                  aria-label="Refine with AI"
                >
                  <Pencil size={11} /> Refine with AI
                </button>
              )}
              {onRegenerate && (
                <button
                  type="button"
                  onClick={onRegenerate}
                  className="output-action-btn"
                  data-testid={testid ? `${testid}-regenerate` : "output-regenerate"}
                  title="Challenge this — ask Bracket to re-argue it"
                  aria-label="Challenge this"
                >
                  <RefreshCw size={11} /> Challenge this
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      {title && (
        <h3 className="t-h2 mt-3 relative z-10">{title}</h3>
      )}
      {blockquote && revealSummary && (
        <div className="relative z-10 mt-4 animate-fade-up">
          <p className="border-l-2 border-[var(--accent)] pl-4 italic text-[14px] leading-[1.65] text-[var(--text)]">
            {blockquote}
          </p>
          {progressive && (
            <button
              type="button"
              onClick={() => { setRevealSummary(false); setRevealDetails(false); }}
              className="disc-btn mt-3"
              data-testid={testid ? `${testid}-hide-summary` : undefined}
            >
              <span className="chev">↑</span> Hide
            </button>
          )}
        </div>
      )}
      {progressive && blockquote && !revealSummary && (
        <button
          type="button"
          onClick={() => setRevealSummary(true)}
          className="disc-btn mt-4"
          data-testid={testid ? `${testid}-reveal-summary` : undefined}
        >
          <span className="chev">↓</span> {summaryBtnLabel}
        </button>
      )}
      {children && revealDetails && (
        <div className="mt-2 relative z-10 animate-fade-up">
          {children}
          {progressive && (
            <button
              type="button"
              onClick={() => setRevealDetails(false)}
              className="disc-btn mt-3"
              data-testid={testid ? `${testid}-hide-details` : undefined}
            >
              <span className="chev">↑</span> Hide {detailsBtnLabel.replace(/^Show\s+/i, "").toLowerCase()}
            </button>
          )}
        </div>
      )}
      {progressive && children && revealSummary && !revealDetails && (
        <button
          type="button"
          onClick={() => setRevealDetails(true)}
          className="disc-btn mt-4"
          data-testid={testid ? `${testid}-reveal-details` : undefined}
        >
          <span className="chev">↓</span> {detailsBtnLabel}
        </button>
      )}
      {(reasoning || source) && (!progressive || revealDetails) && (
        <div className="relative z-10">
          {reasoning && (
            <details className="disc" data-testid={testid ? `${testid}-reasoning` : undefined}>
              <summary>
                <span className="chev">›</span> Reasoning
              </summary>
              <div className="disc-body">{reasoning}</div>
            </details>
          )}
          {source && (
            <details className="disc" data-testid={testid ? `${testid}-source` : undefined}>
              <summary>
                <span className="chev">›</span> {finalSourceLabel}
              </summary>
              <div className="disc-body">{source}</div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function OutputSection({ label, children }) {
  return (
    <div className="mt-8">
      <p className="mono-tag text-muted">{label}</p>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function OutputList({ items = [], variant = "numbered", testid }) {
  if (!items.length) return null;

  if (variant === "severity") {
    return (
      <ul className="space-y-3 text-sm" data-testid={testid}>
        {items.map((r, i) => (
          <li key={i} className="flex gap-3">
            <SeverityPill level={r.severity} />
            <div>
              <p className="font-semibold">{r.risk || r.flag}</p>
              <p className="text-muted mt-1">{r.mitigation || r.why}</p>
            </div>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <ul className="space-y-2 text-sm stagger-in" data-testid={testid}>
      {items.map((t, i) => {
        if (variant === "strike") {
          return (
            <li key={i} className="flex gap-3 line-through text-muted">
              <span className="font-mono">×</span>
              <span>{t}</span>
            </li>
          );
        }
        if (variant === "arrow") {
          return (
            <li key={i} className="flex gap-3">
              <span className="font-mono text-signal">→</span>
              <span>{t}</span>
            </li>
          );
        }
        if (variant === "danger") {
          return (
            <li key={i} className="flex gap-3">
              <span className="font-mono text-danger">!</span>
              <span>{t}</span>
            </li>
          );
        }
        // default: numbered
        return (
          <li key={i} className="flex gap-3">
            <span className="font-mono text-signal w-6 shrink-0">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span>{t}</span>
          </li>
        );
      })}
    </ul>
  );
}

function BlockList({ label, items = [], muted }) {
  if (!items?.length) return null;
  return (
    <div>
      <p className="mono-tag text-muted">{label}</p>
      <ul className="mt-2 space-y-1 text-sm">
        {items.map((i, k) => (
          <li key={k} className={`flex gap-3 ${muted ? "line-through text-muted" : ""}`}>
            <span className="font-mono text-signal">•</span>
            <span>{i}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text || "");
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      }}
      className="btn-ghost mt-4"
      data-testid="copy-message-btn"
    >
      {copied ? "Copied." : "Copy to clipboard"}
    </button>
  );
}

// Consistent pending/loading output card used by every step. While loading,
// the animated { } bracket loader takes over the card so the user clearly
// sees that the AI is working — not just the CTA spinner.
function OutputPending({ title, blurb, loading }) {
  return (
    <div className="card-brut p-5 sm:p-6 min-h-[280px]" data-testid="step-output-pending">
      <p className="mono-label text-muted">{title}</p>
      {loading ? (
        <div className="mt-10 flex flex-col items-center justify-center gap-5 py-6">
          <div className="bracket-loader" aria-label="Loading">
            <span>{"<"}</span>
            <span className="dot" />
            <span className="dot" />
            <span className="dot" />
            <span>{">"}</span>
          </div>
          <p className="mono-tag text-signal">BRACKET IS THINKING…</p>
        </div>
      ) : (
        <>
          <p className="mt-5 text-muted">{blurb}</p>
          <div className="mt-10 space-y-3">
            <SkeletonLine />
            <SkeletonLine />
            <SkeletonLine short />
          </div>
        </>
      )}
    </div>
  );
}

// Tiny pickable keyword chips shown below required fields. Clicking a chip
// appends (or replaces, if empty) the suggestion into the input.
//
// AISuggestions calls /api/suggest as the user types (220ms debounce after
// the last keystroke — fast enough to feel "live"). Results are cached per
// (step,field,partial,contextHash) so re-typing the same prefix is instant.
const _suggestCache = new Map(); // simple LRU-ish: at most 200 entries

function _cacheKey(step, field, partial, context) {
  return `${step}:${field}:${(partial || "").trim().toLowerCase()}:${JSON.stringify(context || {})}`;
}

function AISuggestions({ step, field, value, context, onPick, testid }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const text = (value || "").trim();
    if (text.length < 2) {
      setItems([]);
      setLoading(false);
      return undefined;
    }
    // Cache hit — show instantly, skip the network roundtrip + debounce
    const key = _cacheKey(step, field, text, context);
    const cached = _suggestCache.get(key);
    if (cached) {
      setItems(cached);
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    const ac = new AbortController();
    // Only show the "thinking…" indicator if the request is still running
    // after 220ms — for Haiku (typically ~250-500ms) it appears briefly
    // then flips to results, keeping the UI feeling live.
    const loadingTimer = setTimeout(() => {
      if (!cancelled) setLoading(true);
    }, 220);
    // 400ms debounce: waits for the user to actually pause typing.
    // Prevents the previous 40ms bombardment (5-10 parallel Haiku calls
    // per fast typist) which was choking the backend AI pool.
    const timer = setTimeout(async () => {
      try {
        const { data } = await api.post("/suggest", {
          step,
          field,
          partial: text,
          context: context || {},
        }, { signal: ac.signal, timeout: 12000 });
        const next = Array.isArray(data.suggestions) ? data.suggestions : [];
        if (!cancelled) {
          setItems(next);
          // Stash in cache. Bound size to avoid leaks.
          if (_suggestCache.size > 200) {
            const firstKey = _suggestCache.keys().next().value;
            _suggestCache.delete(firstKey);
          }
          _suggestCache.set(key, next);
        }
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        clearTimeout(loadingTimer);
        if (!cancelled) setLoading(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      ac.abort();
      clearTimeout(timer);
      clearTimeout(loadingTimer);
    };
  }, [value, field, step, JSON.stringify(context || {})]);

  if (!loading && items.length === 0) return null;
  // Key the wrapper on the items list so each fresh set of suggestions
  // re-mounts the chip children → the stagger-in animation re-fires
  // (creates the "chips popping in one-by-one" dopamine moment).
  const staggerKey = items.length ? items.join("|") : "loading";
  return (
    <div className="mt-2 flex flex-wrap gap-1.5 items-center" data-testid={testid}>
      <span className="mono-tag text-muted self-center pr-1">
        {loading ? "BRACKET ↘" : "TRY ↘"}
      </span>
      {loading && (
        <span className="mono-tag text-signal self-center animate-pulse">thinking…</span>
      )}
      <div key={staggerKey} className="flex flex-wrap gap-1.5 items-center chips-pop">
        {items.map((s, i) => (
          <button
            key={`${s}-${i}`}
            type="button"
            onClick={() => onPick(s, value)}
            className="suggest-chip press"
            style={{ animationDelay: `${i * 90}ms` }}
            data-testid={testid ? `${testid}-${i}` : undefined}
          >
            + {s}
          </button>
        ))}
      </div>
    </div>
  );
}

// Helper to merge a suggestion into the current field value, preserving
// what the user has already typed.
function mergeSuggestion(current, suggestion) {
  const c = (current || "").trim();
  if (!c) return suggestion;
  // Avoid duplicates
  if (c.toLowerCase().includes(suggestion.toLowerCase())) return c;
  // Append on a new line if the existing content looks like a list, else inline
  if (c.endsWith(".") || c.endsWith(",")) return `${c} ${suggestion}`;
  return `${c}, ${suggestion}`;
}
