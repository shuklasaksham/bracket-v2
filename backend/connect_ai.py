"""AI extraction layer for Connected Work sources. Uses the same Haiku
pipeline (thread-pool + backpressure) as the rest of Bracket via _run."""
import json
import logging

from ai_engine import _run

logger = logging.getLogger("bracket")

_MAX_CONTENT = 12000


async def analyze_connected_source(provider: str, source_name: str, content: str, candidates: list,
                                   own_email: str = "", own_name: str = "") -> dict:
    """First-pass understanding of a freshly selected source. Returns project
    suggestion, extracted items (each confirmed|detected), and a possible
    match against the user's existing projects."""
    cand_lines = "\n".join(
        f'- id: {c["id"]} | name: {c["name"]} | client: {c.get("client") or "unknown"}' for c in candidates[:25]
    ) or "- (none)"
    you = (f"{own_name} <{own_email}>" if own_name else own_email) or "the connected account"
    prompt = f"""You are Bracket, an intelligence layer that turns scattered client work into structured projects.
Analyze this {provider} source titled "{source_name}" and extract project intelligence.

WHO IS "YOU": messages/comments sent BY {you} are the project OWNER (the person using Bracket).
Everyone else in the content is the CLIENT / other party.

CRITICAL RULES:
- NEVER invent decisions, requirements, deadlines, approvals or scope. Only extract what the content supports.
- STATUS is about whether the OWNER has ACTED on it — NOT about how firmly the client stated it:
  • "confirmed" ONLY when the OWNER ({you}) stated it, agreed to it, decided it, or sent it themselves.
  • Anything the CLIENT requested / proposed / asked for that the OWNER has NOT explicitly agreed to or replied to in this content is "detected" (it still needs the owner's review).
  • A client stating something firmly (e.g. "the deadline is now Sep 15", "add an About page") is still "detected" until the owner agrees — a client demand is not the owner's agreement.
  • If you cannot clearly tell who said it or whether the owner agreed, default to "detected".
- Casual mentions ("maybe we could add dark mode") are "detected", never "confirmed".
- If the content is thin, return fewer items. Empty arrays are fine.
- Extract ONLY what actually matters to running the project. Skip greetings, small talk, pleasantries and generic chatter.
- Keep it concise: titles under 6 words, details to one short factual clause.
- For each item set "requested_by" to the NAME (or email) of the person who raised/requested it, taken from the sender attribution in the content. Use "" when it's the owner's own item or you can't tell.

EXISTING PROJECTS (for matching — use client names, participants, keywords, titles):
{cand_lines}

SOURCE CONTENT:
{content[:_MAX_CONTENT]}

Return STRICT JSON only:
{{
  "project": {{
    "name": "short project name extracted from the work (e.g. 'Acme Website Redesign')",
    "client": "client/company name or empty string",
    "description": "1-2 sentence project description based on the source"
  }},
  "requirements": [{{"title": "short", "detail": "1 sentence with evidence", "status": "confirmed|detected", "requested_by": "name or empty"}}],
  "decisions": [{{"title": "short", "detail": "who decided what", "status": "confirmed|detected", "requested_by": "name or empty"}}],
  "deliverables": [{{"title": "short", "detail": "1 sentence", "status": "confirmed|detected", "requested_by": "name or empty"}}],
  "deadlines": [{{"title": "what is due", "detail": "date or timeframe as stated", "status": "confirmed|detected", "requested_by": "name or empty"}}],
  "open_questions": [{{"title": "the unresolved question", "detail": "", "status": "detected", "requested_by": "name or empty"}}],
  "match": {{"project_id": "id from existing projects list or null", "confidence": 0, "reason": "1 sentence"}}
}}"""
    data = await _run(prompt, "sonnet")
    return data if isinstance(data, dict) else {}


async def detect_source_updates(provider: str, source_label: str, project_name: str,
                                memory_titles: list, new_digest: str) -> dict:
    """Compare fresh source content against what the project already knows.
    Surfaces only meaningful NEW information."""
    known = "\n".join(f"- {t}" for t in memory_titles[:60]) or "- (nothing yet)"
    prompt = f"""You are Bracket's change-detection engine for project "{project_name}".
A connected {provider} source ("{source_label}") just synced with fresh content.

The project ALREADY KNOWS these items (do NOT repeat them):
{known}

FRESH SOURCE CONTENT:
{new_digest[:_MAX_CONTENT]}

Identify only MEANINGFUL new information: new requests, decisions, deliverables, deadline changes,
potential scope creep (requests outside known scope), approvals, blockers.
- status "confirmed" ONLY for explicit agreements; ambiguous statements are "detected".
- If nothing meaningful is new, return empty arrays.
- Ignore greetings, small talk and chatter. Keep titles under 6 words and details to one short factual clause.
- For each new item set "requested_by" to the NAME (or email) of the person who raised it, from the sender attribution; use "" if unclear.

Return STRICT JSON only:
{{
  "events": [{{"summary": "1 short sentence, e.g. 'Client requested a testimonials section'", "event_type": "REQUIREMENT_DETECTED|DECISION_DETECTED|SCOPE_CHANGE_DETECTED|DEADLINE_CHANGED|DELIVERABLE_STATUS_DETECTED|ACTIVITY"}}],
  "new_items": [{{"category": "requirement|decision|deliverable|deadline|scope_change|question", "title": "short", "detail": "1 sentence with evidence", "status": "confirmed|detected", "requested_by": "name or empty"}}]
}}"""
    data = await _run(prompt, "sonnet")
    return data if isinstance(data, dict) else {"events": [], "new_items": []}


async def extract_from_notes(project_name: str, memory_titles: list, notes_text: str) -> dict:
    """Extract project changes from user-attached meeting notes / a transcript,
    comparing against what the project already knows. Same shape as
    detect_source_updates so it flows through the identical review pipeline."""
    known = "\n".join(f"- {t}" for t in memory_titles[:60]) or "- (nothing yet)"
    prompt = f"""You are Bracket's meeting-notes analyst for project "{project_name}".
The project owner just attached notes / a transcript from a meeting. Extract what it means for the project.

The project ALREADY KNOWS these items (do NOT repeat them):
{known}

MEETING NOTES / TRANSCRIPT:
{notes_text[:_MAX_CONTENT]}

Identify only MEANINGFUL new or changed information: new requirements, decisions made, deliverables,
deadline changes, scope changes (work added or removed), approvals, blockers or open questions.
- Ignore small talk and logistics. Keep titles under 6 words, details to one short factual clause.
- For each item set "requested_by" to the NAME of the person who raised it in the notes (a participant), or "" if not attributable.
- If nothing meaningful is present, return empty arrays.

Return STRICT JSON only:
{{
  "events": [{{"summary": "1 short sentence about what changed in the meeting", "event_type": "REQUIREMENT_DETECTED|DECISION_DETECTED|SCOPE_CHANGE_DETECTED|DEADLINE_CHANGED|DELIVERABLE_STATUS_DETECTED|ACTIVITY"}}],
  "new_items": [{{"category": "requirement|decision|deliverable|deadline|scope_change|question", "title": "short", "detail": "1 sentence with evidence", "status": "detected", "requested_by": "name or empty"}}]
}}"""
    data = await _run(prompt, "sonnet")
    return data if isinstance(data, dict) else {"events": [], "new_items": []}


async def answer_project_question(project_name: str, question: str,
                                  memory_items: list, source_digests: list) -> dict:
    """Ask Bracket — answers grounded in connected-source memory, with sources."""
    mem = "\n".join(
        f'- [{m.get("category","?").upper()} · {m.get("status","?")}] {m.get("title","")} — {m.get("detail","")} (source: {m.get("source_label","?")}, {m.get("provider","?")})'
        for m in memory_items[:80]
    ) or "- (no memory yet)"
    digests = "\n\n".join(
        f'SOURCE "{d["label"]}" ({d["provider"]}):\n{(d.get("content") or "")[:3500]}' for d in source_digests[:4]
    ) or "(no connected source content)"
    prompt = f"""You are Bracket, answering a question about project "{project_name}" using ONLY the connected-source intelligence below.

RULES:
- Never invent decisions, approvals, deadlines or scope. If you cannot find a confirmed answer, say so plainly.
- Every claim must cite the source it came from.
- Keep the answer short (2-4 sentences).

PROJECT MEMORY:
{mem}

RAW SOURCE EXCERPTS:
{digests}

QUESTION: {question}

Return STRICT JSON only:
{{
  "answer": "the concise answer, or a plain statement that no confirmed answer exists",
  "confidence": "high|medium|low",
  "sources": [{{"label": "source name", "provider": "gmail|figma|github|notion|...", "detail": "what this source contributes"}}]
}}"""
    data = await _run(prompt, "haiku")
    return data if isinstance(data, dict) else {"answer": "I couldn't analyze this right now.", "confidence": "low", "sources": []}


async def suggest_reply_for_change(project_name: str, client_name: str, change: dict,
                                   related_memory: list) -> dict:
    """For a single detected change (scope shift, new requirement, deadline change, …),
    generate a short, professional client-facing reply the user can copy/send.
    Also enumerate the impacts and the recommended memory updates so the UI can
    show 'here's what changed, here's what I'll do, here's what you should say'."""
    context = "\n".join(
        f'- [{m.get("category","?").upper()}] {m.get("title","")}' for m in related_memory[:20]
    ) or "- (nothing relevant yet)"
    prompt = f"""You are Bracket, helping a designer respond to a client for project "{project_name}"
(client: {client_name or "the client"}).

A change was just detected in the connected work:
- Category: {change.get("category", "requirement")}
- Title:    {change.get("title", "")}
- Detail:   {change.get("detail", "")}
- Source:   {change.get("source_label", "?")} ({change.get("provider", "?")})

Related project memory:
{context}

Write a short (2-4 sentence) reply the designer could send to the client. It must:
- Acknowledge the request clearly.
- State what the designer will do next (concrete, not vague).
- If the change likely expands scope or shifts the timeline, say so professionally — never combative.
- No jargon, no filler. First-person "I".

Also enumerate the concrete IMPACTS this change has on the project (scope, time, cost, risk) and the
memory updates Bracket should apply if the designer accepts.

Return STRICT JSON only:
{{
  "reply": "the copy-ready reply text",
  "impacts": [
    {{"kind": "scope|timeline|effort|cost|risk", "detail": "1 short sentence, quantified when possible"}}
  ],
  "priority": "low|medium|high",
  "memory_updates": [
    {{"category": "scope|deliverable|timeline|decision|risk|assumption|commercial|requirement", "action": "add|update|remove", "title": "short", "detail": "1 sentence"}}
  ]
}}"""
    data = await _run(prompt, "haiku")
    if not isinstance(data, dict):
        return {"reply": "", "impacts": [], "priority": "medium", "memory_updates": []}
    return data


async def suggest_project_reply(project_name: str, client_name: str,
                                latest_client_message: dict,
                                memory_items: list,
                                instruction: str = "",
                                history: list | None = None) -> dict:
    """PROJECT-LEVEL suggested reply — chat-style, on-demand.

    Grounded in:
      - The most recent inbound client message across all connected sources.
      - The full project memory (six canonical categories).
      - The user's explicit instruction ("Tell Bracket what you want to do…").
      - The prior chat turns so refinements ("shorter", "more assertive") work.

    Bracket surfaces the reply on the Overview page; the user reviews / edits
    / regenerates / approves and sends via their own tool. No autonomous send.
    """
    mem = "\n".join(
        f'- [{m.get("category","?").upper()}] {m.get("title","")}'
        for m in memory_items[:40]
    ) or "- (project memory is empty)"
    if not latest_client_message:
        client_line = "(no client message received yet)"
    else:
        client_line = (
            f'From: {latest_client_message.get("source_label","?")} '
            f'({latest_client_message.get("provider","?")})\n'
            f'"{(latest_client_message.get("detail") or latest_client_message.get("title") or "").strip()[:800]}"'
        )

    # Convert prior turns into a compact thread so the refinement request
    # ("shorter", "more formal", "push the deadline back") stays grounded.
    convo_lines: list[str] = []
    for turn in (history or [])[-8:]:
        role = (turn.get("role") or "").lower()
        content = (turn.get("content") or "").strip()
        if not content:
            continue
        if role == "user":
            convo_lines.append(f"USER INSTRUCTION: {content[:500]}")
        elif role == "assistant":
            convo_lines.append(f"PREVIOUS DRAFT: {content[:500]}")
    convo_block = "\n".join(convo_lines) if convo_lines else "(no prior turns)"

    latest_instruction = (instruction or "").strip() or "Draft the best possible reply."

    prompt = f"""You are Bracket, drafting ONE short, professional client-facing reply for the
project "{project_name}" (client: {client_name or 'the client'}). The designer is
using you as an on-demand assistant — reply only when asked, and follow their
latest instruction precisely.

## User's latest instruction
{latest_instruction}

## Prior turns in this chat (most recent last)
{convo_block}

## Grounding context
1. Most recent inbound message from the client:
{client_line}

2. What Bracket already knows about the project (memory):
{mem}

## Rules for the reply
- Follow the designer's latest instruction above (tone, length, angle, request).
- Ground in the client's message + project memory — do NOT invent facts.
- Reflect the correct scope, deliverables or deadlines when relevant.
- Keep it SHORT: 2-3 sentences by default, unless the instruction asks otherwise.
- Sound like a real person wrote it quickly — natural, warm, direct. No corporate filler, no throat-clearing openers ("Great question", "Thanks for reaching out"), no essay.
- Say only what matters. Cut anything the client doesn't need.
- End with the one concrete next step, only if there is a real one.
- First-person "I". Plain language, no jargon.
- If nothing new to reply to, acknowledge current status in a single line.

Return STRICT JSON only:
{{
  "reply": "the copy-ready reply text",
  "grounded_in": [
    {{"source": "gmail|slack|figma|github|manual", "label": "short — thread / channel / file name", "why": "1 short sentence"}}
  ],
  "confidence": "high|medium|low"
}}"""
    data = await _run(prompt, "haiku")
    if not isinstance(data, dict):
        return {"reply": "", "grounded_in": [], "confidence": "low"}
    return data



async def build_project_update(project_name: str, client_name: str,
                               pending_items: list, memory_items: list) -> dict:
    """Consolidate ALL pending changes into ONE reviewable snapshot.

    Instead of approving each change separately, Bracket looks at every pending
    change together, works out the downstream consequences across every
    category, and returns a single "Project Update": a plain-language summary,
    the concrete impacts, and any NEW downstream items that logically follow.
    The user approves or rejects the whole snapshot at once — no per-item chain.
    """
    pend = "\n".join(
        f'- [{(p.get("display_category") or p.get("category") or "?").upper()}] '
        f'{p.get("title","")} — {p.get("detail","")}'
        for p in pending_items[:40]
    ) or "- (none)"
    mem = "\n".join(
        f'- [{(p.get("category") or "?").upper()}] {p.get("title","")}'
        for p in memory_items[:60]
    ) or "- (project memory is empty)"

    prompt = f"""You are Bracket, consolidating pending changes for project "{project_name}"
(client: {client_name or 'the client'}) into ONE reviewable update.

The user does NOT want to approve changes one by one. Look at ALL the pending
changes together, then work out everything that logically follows from them.

## Pending changes (the direct changes the user is about to approve)
{pend}

## What the project already knows (confirmed memory — do NOT repeat these)
{mem}

## Your job
1. Write the BOTTOM LINE in ONE short sentence (max ~22 words) — plain English,
   the single thing the user needs to know before deciding. No preamble, no
   listing every change. Example: "Approving locks 5 areas into a 4-week
   deadline — a real scope and timeline risk."
2. List the concrete IMPACTS across scope, timeline, effort, cost and risk.
   Quantify when the pending changes support it; never invent numbers.
3. List any NEW DOWNSTREAM items that logically follow from the direct changes
   and are NOT already pending or in memory (e.g. a new scope item creates a new
   deliverable, or a new requirement shifts a deadline). Only include real, non-
   obvious consequences — an empty list is fine. Do NOT restate the pending
   changes themselves. Keep titles under 6 words and details to one clause.
   Downstream category MUST be one of: deliverable, scope, timeline, requirement,
   decision, deadline. Express pure risks in "impacts", not as downstream items.

Return STRICT JSON only:
{{
  "summary": "the bottom line in ONE short sentence",
  "priority": "high|medium|low",
  "impacts": [{{"kind": "scope|timeline|effort|cost|risk", "detail": "1 short sentence"}}],
  "downstream": [{{"category": "deliverable|scope|timeline|requirement|decision|deadline", "title": "short", "detail": "1 sentence", "reason": "why this follows"}}]
}}"""
    data = await _run(prompt, "haiku")
    if not isinstance(data, dict):
        return {"summary": "", "priority": "medium", "impacts": [], "downstream": []}
    data.setdefault("summary", "")
    data.setdefault("priority", "medium")
    data.setdefault("impacts", [])
    data.setdefault("downstream", [])
    return data
