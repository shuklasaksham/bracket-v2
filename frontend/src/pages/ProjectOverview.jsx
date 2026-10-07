import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowRight,
  Check,
  Lock,
  FileText,
  Pencil,
  Loader2,
  Unlock,
  AlertCircle,
  Eye,
} from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "../lib/api";
import { useDialog } from "../components/Dialog";
import ClientReviewModal from "../components/ClientReviewModal";
import ApplyingChangesOverlay from "../components/ApplyingChangesOverlay";
import ConnectedWorkPanel from "../components/ConnectedWorkPanel";

const STEPS = [
  {
    n: 1,
    key: "situation",
    label: "UNDERSTAND",
    desc: "Name what's actually happening.",
    inputKey: "situation_input",
    outputKey: "framing",
  },
  {
    n: 2,
    key: "context",
    label: "SIMPLIFY",
    desc: "Strip to the signal.",
    inputKey: "context_input",
    outputKey: "context",
  },
  {
    n: 3,
    key: "decision",
    label: "STRATEGY",
    desc: "The call. Confidence + alternatives + risks.",
    inputKey: "decision_input",
    outputKey: "decision",
  },
  {
    n: 4,
    key: "artifacts",
    label: "EXECUTION",
    desc: "Scope · message · assumptions · risks.",
    inputKey: null,
    outputKey: "artifacts",
  },
  {
    n: 5,
    key: "lock",
    label: "REVIEW",
    desc: "Lock the call. Generate the doc.",
    inputKey: null,
    outputKey: null, // status === locked indicates done
  },
];

// Inline-style pill palette — Tailwind color classes get overridden by the
// hardcoded `color: var(--text-3)` inside `.mono-tag`, so we use inline
// styles (highest specificity) with proper white text on saturated backgrounds.
const STATUS_STYLE = {
  draft:       { backgroundColor: "transparent", color: "var(--text-2)", border: "1px solid var(--hairline)" },
  in_progress: { backgroundColor: "var(--surface-2)", color: "var(--text)",  border: "1px solid var(--hairline)" },
  locked:      { backgroundColor: "#2E2E2E", color: "#FFFFFF", border: "1px solid #2E2E2E" },
};
const STATUS_LABEL = { draft: "DRAFT", in_progress: "IN PROGRESS", locked: "LOCKED" };

const SHARE_STYLE = {
  sent:           { backgroundColor: "var(--surface-2)", color: "var(--text)",  border: "1px solid var(--hairline)" },
  accepted:       { backgroundColor: "#22C55E", color: "#0A0A0C", border: "1px solid #22C55E" },
  rejected:       { backgroundColor: "#EF4444", color: "#FFFFFF", border: "1px solid #EF4444" },
  awaiting_reply: { backgroundColor: "var(--surface-2)", color: "var(--text)",  border: "1px solid var(--hairline)" },
};
const SHARE_LABEL = {
  sent: "AWAITING CLIENT REVIEW",
  accepted: "ACCEPTED BY CLIENT",
  rejected: "CLIENT RAISED CONCERNS",
  awaiting_reply: "REPLY SENT — AWAITING CLIENT",
};

function StepStatus({ done, current }) {
  if (done) {
    return (
      <span
        className="mono-tag px-2 py-1 inline-flex items-center gap-1.5 rounded"
        style={{ backgroundColor: "#2E2E2E", color: "#FFFFFF", border: "1px solid #2E2E2E" }}
      >
        <Check size={11} /> <span style={{ color: "inherit" }}>DONE</span>
      </span>
    );
  }
  if (current) {
    return (
      <span
        className="mono-tag px-2 py-1 rounded"
        style={{ backgroundColor: "var(--surface-2)", color: "var(--text)", border: "1px solid var(--hairline)" }}
      >
        IN PROGRESS
      </span>
    );
  }
  return (
    <span
      className="mono-tag px-2 py-1 rounded"
      style={{ backgroundColor: "transparent", color: "var(--text-3)", border: "1px solid var(--hairline)" }}
    >
      TODO
    </span>
  );
}

function StepSummary({ step, project }) {
  // Step 1: reframed problem summary (single line-clamped snippet)
  if (step.n === 1 && project.framing?.reframed_problem) {
    return (
      <p className="text-[11.5px] text-[var(--text-3)] leading-snug line-clamp-3">
        {project.framing.reframed_problem}
      </p>
    );
  }
  // Step 2: what actually matters
  if (step.n === 2 && project.context?.what_actually_matters) {
    return (
      <p className="text-[11.5px] text-[var(--text-3)] leading-snug line-clamp-3">
        {project.context.what_actually_matters}
      </p>
    );
  }
  // Step 3: decision title + confidence
  if (step.n === 3 && project.decision) {
    const rec = project.decision.recommendation || {};
    return (
      <div>
        {rec.title && (
          <p className="text-[12px] font-medium text-[var(--text)] leading-tight line-clamp-2">
            {rec.title}
          </p>
        )}
        {rec.confidence != null && (
          <p className="mono-tag text-signal mt-1 text-[10px]">CONF {rec.confidence}%</p>
        )}
      </div>
    );
  }
  // Step 4: artifacts summary (counts only)
  if (step.n === 4 && project.artifacts) {
    const a = project.artifacts;
    const scope = a.scope_doc || {};
    return (
      <div>
        {scope.title && (
          <p className="text-[12px] font-medium text-[var(--text)] leading-tight line-clamp-2">
            {scope.title}
          </p>
        )}
        <p className="mono-tag text-muted mt-1 text-[10px]">
          {(scope.in_scope?.length || 0)} in · {(scope.out_of_scope?.length || 0)} out
          {scope.deliverables?.length ? ` · ${scope.deliverables.length} deliv.` : ""}
        </p>
      </div>
    );
  }
  // Step 5: locked
  if (step.n === 5 && project.status === "locked") {
    const when = (project.locked_at || "").slice(0, 10);
    return (
      <p className="mono-tag text-signal inline-flex items-center gap-1.5 text-[10px]">
        <Lock size={10} /> Locked {when && `· ${when}`}
      </p>
    );
  }
  // Empty-state teaching — 1 line only.
  const EMPTY_TEACHING = {
    1: "Reframed problem, tensions, clarity score.",
    2: "Signals kept · noise cut · hidden assumptions.",
    3: "The call · alternatives · risks · confidence.",
    4: "Scope · client message · assumptions · risk flags.",
    5: "Locked doc · PDF · share link.",
  };
  const blurb = EMPTY_TEACHING[step.n];
  if (blurb) {
    return (
      <p className="text-[11.5px] text-[var(--text-3)] leading-snug line-clamp-2" data-testid={`overview-empty-teaching-${step.n}`}>
        {blurb}
      </p>
    );
  }
  return null;
}

export default function ProjectOverview() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { confirm: confirmDialog } = useDialog();
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [savingRename, setSavingRename] = useState(false);
  const [reviewModalOpen, setReviewModalOpen] = useState(false);

  const load = async () => {
    try {
      const { data } = await api.get(`/projects/${id}`);
      setProject(data);
      setRenameValue(data.name || "");
    } catch (e) {
      setError(formatApiError(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [id]);

  // ─── Real-time sync ──────────────────────────────────────────────────
  // Poll the project every 6s while the client hasn't finished with the
  // sign-off (i.e. before "accepted" is reached). This lets the owner see
  // an acceptance / raised concern land the moment it happens, without
  // manually refreshing. Silent — we swap state only if something changed.
  useEffect(() => {
    if (!project) return;
    const terminal = project.share_status === "accepted";
    const notShared = !project.share_status || project.share_status === "none";
    if (terminal || notShared) return; // nothing to poll for
    const timer = setInterval(async () => {
      try {
        const { data } = await api.get(`/projects/${id}`);
        setProject((cur) => {
          if (!cur) return data;
          // Cheap change detection — status shifted or a new review/reply arrived
          if (
            cur.share_status !== data.share_status ||
            cur.applying_changes !== data.applying_changes ||
            (cur.share_review?.submitted_at || "") !== (data.share_review?.submitted_at || "") ||
            (cur.owner_replies?.length || 0) !== (data.owner_replies?.length || 0)
          ) {
            if (cur.applying_changes && !data.applying_changes) {
              toast.success(
                data.share_status === "sent"
                  ? "Changes applied — the updated document was sent to your client with a note on what changed."
                  : "Applying the changes failed — please try again from the concerns modal."
              );
            }
            if (
              cur.share_status !== data.share_status &&
              (data.share_status === "accepted" || data.share_status === "rejected")
            ) {
              toast.success(
                data.share_status === "accepted"
                  ? "Your client accepted the sign-off."
                  : "Your client raised concerns.",
              );
            }
            return data;
          }
          return cur;
        });
      } catch {
        /* silent — polling shouldn't spam errors */
      }
    }, 6000);
    return () => clearInterval(timer);
  }, [id, project?.share_status]);

  const isLocked = project?.status === "locked";
  // Frozen only while the doc is with the client (sent) or accepted — once
  // the client raises concerns the owner can edit again.
  const isFrozen =
    !!project?.share_status && !["none", "rejected", "awaiting_reply"].includes(project.share_status);

  const editStep = async (stepN) => {
    if (isFrozen) {
      toast.error("This project is with your client for review — steps can't be edited until they respond.");
      return;
    }
    // If locked, prompt unlock first; otherwise go straight to the step
    if (isLocked) {
      const ok = await confirmDialog({
        title: "This project is locked",
        message: "Unlock it to edit? The client-review status will stay intact.",
        confirmLabel: "Unlock & edit",
        cancelLabel: "Keep locked",
      });
      if (!ok) return;
      unlockAndGo(stepN);
      return;
    }
    navigate(`/project/${id}/flow?step=${stepN}`);
  };

  const unlockAndGo = async (stepN) => {
    setUnlocking(true);
    try {
      await api.post(`/projects/${id}/unlock`);
      navigate(`/project/${id}/flow?step=${stepN}`);
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setUnlocking(false);
    }
  };

  const saveRename = async () => {
    const next = renameValue.trim();
    if (!next) return toast.error("Project name can't be empty.");
    if (next === project.name) {
      setRenaming(false);
      return;
    }
    setSavingRename(true);
    try {
      const { data } = await api.patch(`/projects/${id}`, { name: next });
      setProject((cur) => ({ ...cur, name: data.name, updated_at: data.updated_at }));
      toast.success("Renamed.");
      setRenaming(false);
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setSavingRename(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="mono-label">LOADING…</p>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="min-h-screen">
        <main className="max-w-[1100px] mx-auto px-5 sm:px-6 md:px-10 py-12">
          <div className="card-brut border-danger p-6" data-testid="overview-error">
            <p className="mono-tag text-danger">CAN&apos;T LOAD PROJECT</p>
            <p className="mt-2">{error || "Not found."}</p>
            <Link to="/app" className="btn-ghost mt-4">Back to dashboard</Link>
          </div>
        </main>
      </div>
    );
  }

  const spStyle = STATUS_STYLE[project.status] || STATUS_STYLE.draft;
  const spLabel = STATUS_LABEL[project.status] || STATUS_LABEL.draft;
  const ssStyle = project.share_status && SHARE_STYLE[project.share_status];
  const ssLabel = project.share_status && SHARE_LABEL[project.share_status];
  const currentStep = project.step || 1;

  return (
    <div className="dashboard-root relative min-h-full" data-testid="overview-page">
      {/* Same cinematic backdrop as Dashboard — one visual universe. */}
      <div aria-hidden="true" className="hero-ambient hero-ambient--dashboard" />
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10"
        style={{ background: "var(--bg)" }}
      />

      <main className="relative max-w-[1200px] mx-auto px-6 sm:px-8 md:px-10 py-6 md:py-8 flex flex-col gap-5 md:gap-6 page-enter">
        {/* Breadcrumb */}
        <Link
          to="/app"
          className="mono-tag text-muted hover:text-[var(--text)] inline-flex items-center gap-1.5 text-[10px] w-fit"
          data-testid="overview-back"
        >
          ← BACK TO DASHBOARD
        </Link>

        {/* Header row — title + status pills + primary action */}
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="mono-tag text-muted text-[10px]">PROJECT · OVERVIEW</p>
            {renaming ? (
              <div className="mt-2 flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
                <input
                  className="dashboard-search-input flex-1 font-display text-[22px] tracking-[-0.02em]"
                  style={{ height: 40, minWidth: 0 }}
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveRename();
                    if (e.key === "Escape") { setRenaming(false); setRenameValue(project.name); }
                  }}
                  maxLength={120}
                  data-testid="overview-rename-input"
                  autoFocus
                />
                <div className="flex gap-2">
                  <button
                    onClick={saveRename}
                    disabled={savingRename}
                    className="flow-header-action"
                    data-testid="overview-rename-save"
                  >
                    {savingRename ? <Loader2 size={12} className="animate-spin"/> : <Check size={12}/>} Save
                  </button>
                  <button
                    onClick={() => { setRenaming(false); setRenameValue(project.name); }}
                    className="flow-header-action"
                    data-testid="overview-rename-cancel"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                <h1
                  className="font-display font-semibold tracking-[-0.028em] leading-[1.1] text-[26px] sm:text-[30px] text-[var(--text)] min-w-0 break-words"
                  data-testid="overview-project-name"
                >
                  {project.name}
                </h1>
                <button
                  onClick={() => setRenaming(true)}
                  className="overview-rename-icon-btn"
                  data-testid="overview-rename"
                  aria-label="Rename project"
                  title="Rename project"
                >
                  <Pencil size={13} />
                </button>
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-2 items-center">
              <span className="mono-tag px-2 py-0.5 rounded text-[10px]" style={spStyle} data-testid="overview-status-pill">{spLabel}</span>
              {ssStyle && <span className="mono-tag px-2 py-0.5 rounded text-[10px]" style={ssStyle} data-testid="overview-share-pill">{ssLabel}</span>}
              <span className="mono-tag px-2 py-0.5 rounded text-[10px]" style={{ backgroundColor: "transparent", color: "var(--text-3)", border: "1px solid var(--hairline)" }}>
                BRACKET AI
              </span>
            </div>
          </div>

          {/* Quick actions */}
          <div className="flex flex-wrap gap-2 shrink-0">
            {!isLocked && !isFrozen && (
              <button
                onClick={() => navigate(`/project/${id}/flow?step=${currentStep}`)}
                className="clay-signal px-4 py-2 t-tag press inline-flex items-center gap-2"
                data-testid="overview-resume"
              >
                {currentStep > 1 ? "Resume" : "Start step 1"} <ArrowRight size={14}/>
              </button>
            )}
            {project.artifacts && (
              <Link
                to={`/project/${id}/document`}
                className="flow-header-action"
                data-testid="overview-document-link"
              >
                <FileText size={12} /> Document
              </Link>
            )}
            {isLocked && !isFrozen && (
              <button
                onClick={() => unlockAndGo(currentStep)}
                disabled={unlocking}
                className="flow-header-action"
                data-testid="overview-unlock"
              >
                {unlocking ? <Loader2 size={12} className="animate-spin"/> : <Unlock size={12}/>} Unlock to edit
              </button>
            )}
          </div>
        </div>

        {/* Client review summary — a compact card, every action & detail
            lives inside the ClientReviewModal so nothing spills into the
            page and forces the owner to scroll. */}
        {project.share_status && project.share_status !== "none" && (
          <section
            className="mt-10 card-linear card-linear--solid p-5 sm:p-6"
            data-testid="overview-client-review"
          >
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div className="min-w-0">
                <p className="mono-label">{"< client review >"}</p>
                <h2 className="font-display font-semibold tracking-[-0.02em] text-[20px] sm:text-[24px] mt-2 leading-[1.15] text-[var(--text)]">
                  {project.share_status === "accepted" && <>Client <span className="text-signal">accepted</span> the call.</>}
                  {project.share_status === "rejected" && <>Client <span className="text-danger">raised concerns</span>.</>}
                  {project.share_status === "awaiting_reply" && <>You replied. <span className="text-signal">Awaiting client.</span></>}
                  {project.share_status === "sent" && <>Sent to client. <span className="text-muted">Awaiting review.</span></>}
                </h2>
                {(project.share_status === "rejected" || project.share_status === "awaiting_reply") && (
                  <p className="mt-2 text-sm text-[var(--text-2)]">
                    {(project.share_review?.concerns || "").slice(0, 140)}
                    {(project.share_review?.concerns || "").length > 140 ? "…" : ""}
                  </p>
                )}
                {project.share_status === "accepted" && project.share_review?.signature_name && (
                  <p className="mt-2 text-sm text-[var(--text-2)]">
                    Signed by <span className="text-[var(--text)]">{project.share_review.signature_name}</span>
                    {project.share_review.role ? `, ${project.share_review.role}` : ""}
                    {" · "}
                    <span className="mono-tag text-signal text-[10.5px]">
                      {project.share_review.accepted_count}/{project.share_review.total_items} SECTIONS SIGNED
                    </span>
                  </p>
                )}
              </div>

              {(project.share_status === "rejected" ||
                project.share_status === "awaiting_reply" ||
                project.share_status === "accepted") && (
                <button
                  type="button"
                  onClick={() => setReviewModalOpen(true)}
                  className="btn-primary shrink-0 self-start md:self-auto"
                  data-testid="overview-view-review-cta"
                >
                  <Eye size={14} />{" "}
                  {project.share_status === "accepted"
                    ? "View acceptance"
                    : project.share_status === "awaiting_reply"
                    ? "View thread"
                    : "View concerns & reply"}
                </button>
              )}
            </div>
          </section>
        )}

        <ClientReviewModal
          open={reviewModalOpen}
          onClose={() => setReviewModalOpen(false)}
          project={project}
          setProject={setProject}
        />

        <ApplyingChangesOverlay open={!!project.applying_changes} />

        {/* Step grid — cards, one per milestone; fits on one screen. */}
        <section data-testid="overview-steps">
          <p className="mono-tag text-muted text-[10px] mb-3">YOUR JOURNEY · FIVE MILESTONES</p>
          <div className="mt-1 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3" data-testid="overview-steps-grid">
            {STEPS.map((step) => {
              const done =
                (step.outputKey && !!project[step.outputKey]) ||
                (step.n === 5 && project.status === "locked");
              const current = !done && currentStep === step.n;
              return (
                <div
                  key={step.n}
                  className={`overview-step-card ${current ? "is-current" : ""} ${done ? "is-done" : ""}`}
                  data-testid={`overview-step-${step.n}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="overview-step-num" aria-hidden="true">{String(step.n).padStart(2, "0")}</span>
                    <StepStatus done={done} current={current} />
                  </div>
                  <p className="mt-3 font-display font-semibold tracking-[-0.012em] text-[15px] leading-tight">
                    {step.label}
                  </p>
                  <p className="mt-1 text-[11.5px] text-[var(--text-3)] leading-snug">{step.desc}</p>
                  <div className="mt-2.5 flex-1 min-h-0 overflow-hidden">
                    <StepSummary step={step} project={project} />
                  </div>
                  {!isFrozen && (
                    <button
                      onClick={() => editStep(step.n)}
                      className="overview-step-btn mt-3"
                      data-testid={`overview-edit-${step.n}`}
                    >
                      <Pencil size={11} /> {done ? "Refine" : current ? "Continue" : "Start"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Connected work — sources, memory, live activity, ask bracket */}
        <ConnectedWorkPanel projectId={id} />

        {/* Hint when locked / shared */}
        {(isLocked || isFrozen) && (
          <div className="mt-6 flex items-start gap-3 text-sm text-muted">
            <AlertCircle size={14} className="mt-0.5 shrink-0"/>
            <p>
              {isFrozen
                ? "This project is with your client for review — steps can't be edited until they respond."
                : "This project is locked. Editing any step will unlock it (the client review status stays intact)."}
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
