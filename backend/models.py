"""Pydantic models for Bracket (anonymous / no-auth mode)."""
from pydantic import BaseModel, Field, EmailStr, ConfigDict
from typing import Optional, Dict, Any
from datetime import datetime, timezone
import uuid


def _uuid() -> str:
    return str(uuid.uuid4())


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# --- Project lifecycle ---
class ProjectStartIn(BaseModel):
    """Lightweight identity capture when a user begins a project."""
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    project_name: str = Field(min_length=1, max_length=120)
    engine: str = "claude"  # claude | gpt


class SituationIn(BaseModel):
    # Legacy structured fields (kept for backwards compat + escape hatch).
    what: str = ""
    who: str = ""
    unclear: str = ""
    # New primary path: paste-anything. If present, the backend extracts
    # what/who/unclear from it via a Haiku pass before running the main
    # Sonnet framing call.
    raw_paste: Optional[str] = None


class ContextIn(BaseModel):
    requirements: str = ""
    constraints: str = ""
    inspirations: str = ""
    raw_paste: Optional[str] = None


class DecisionIn(BaseModel):
    optimizing_for: str = ""
    tradeoffs: str = ""
    risks: str = ""
    raw_paste: Optional[str] = None


class ProjectOut(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    name: str
    creator_name: Optional[str] = ""
    creator_email: Optional[str] = ""
    engine: str = "claude"
    status: str = "draft"  # draft | in_progress | locked
    step: int = 1  # 1..5
    situation_input: Optional[Dict[str, Any]] = None
    framing: Optional[Dict[str, Any]] = None
    context_input: Optional[Dict[str, Any]] = None
    context: Optional[Dict[str, Any]] = None
    decision_input: Optional[Dict[str, Any]] = None
    decision: Optional[Dict[str, Any]] = None
    artifacts: Optional[Dict[str, Any]] = None
    locked_at: Optional[str] = None
    feedback: Optional[Dict[str, Any]] = None
    share_token: Optional[str] = None
    share_status: str = "none"  # none | sent | accepted | rejected | awaiting_reply
    share_review: Optional[Dict[str, Any]] = None
    owner_replies: Optional[list] = None
    # Owner is applying a client-requested change — steps are unfrozen and
    # the flow page shows a banner with `revision_context.instruction`.
    revising: Optional[bool] = None
    revision_context: Optional[Dict[str, Any]] = None
    # Background "apply the changes" pipeline is running — the document page
    # shows a progress banner and polls until this clears.
    applying_changes: Optional[bool] = None
    last_change_note: Optional[str] = None
    owner_user_id: Optional[str] = ""
    created_at: str
    updated_at: str
    # Optional metadata used by the file-upload flow (frontend uses these
    # to skip Step 1's manual paste UI and land the user on Step 5).
    brief_source: Optional[Dict[str, Any]] = None
    auto_advanced: Optional[bool] = None
    # Progression status for the async auto-advance chain kicked off by
    # /projects/upload-brief. Values: pending | advanced | partial |
    # insufficient | failed. Absent for projects not created via upload.
    auto_advance_status: Optional[str] = None
    # Targeted follow-up questions Bracket surfaced during Step-1 auto-build
    # when the first-chatbox paste was too thin for a one-shot. Frontend
    # renders these as numbered prompts on Steps 2 and 3 to guide the next
    # paste. Shape: {"context": [str, ...], "decision": [str, ...]}.
    open_questions: Optional[Dict[str, Any]] = None
    # Bracket "Client Operating System" fields — project memory era (Feb 2026).
    client_name: Optional[str] = None
    project_type: Optional[str] = None
    is_demo: Optional[bool] = None
    demo_tag: Optional[str] = None
