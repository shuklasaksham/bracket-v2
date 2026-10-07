"""Email utilities for Bracket. Uses Resend."""
import os
import asyncio
import logging
import resend

logger = logging.getLogger("bracket.email")


def _sender() -> str:
    name = os.environ.get("SENDER_NAME", "Bracket").strip()
    email = os.environ.get("SENDER_EMAIL", "").strip()
    if not email:
        return "Bracket <onboarding@resend.dev>"
    return f"{name} <{email}>" if name else email


def _thanks_html(name: str, project_name: str) -> str:
    display_name = (name or "").strip() or "there"
    pname = (project_name or "your project").strip() or "your project"
    return f"""<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#08090A;font-family:'Poppins','Segoe UI',-apple-system,BlinkMacSystemFont,Roboto,Helvetica,Arial,sans-serif;color:#E8EAF0;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#08090A;padding:44px 16px;">
      <tr>
        <td align="center">
          <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#0F1114;border:1px solid #26282D;border-radius:16px;">
            <tr>
              <td style="padding:32px 36px 0 36px;">
                <p style="margin:0;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:#5E6AD2;">
                  &lt; bracket &middot; project started &gt;
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 36px 0 36px;">
                <h1 style="margin:0;font-size:30px;line-height:1.15;font-weight:600;letter-spacing:-0.02em;color:#F4F5F7;">
                  Thanks for trying<br/>
                  <span style="color:#5E6AD2;">Bracket.</span>
                </h1>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 36px 0 36px;">
                <p style="margin:0 0 14px 0;font-size:15px;line-height:1.65;color:#B9BFC9;">
                  Hi {display_name} &mdash; you just kicked off a new Bracket project: <strong style="color:#F4F5F7;">{pname}</strong>.
                </p>
                <p style="margin:0 0 14px 0;font-size:15px;line-height:1.65;color:#B9BFC9;">
                  Move through the five steps at your own pace. When you lock the decision, you'll have scope, a client message, assumptions, and risk flags ready to send.
                </p>
                <p style="margin:0;font-size:15px;line-height:1.65;color:#B9BFC9;">
                  It's free during early access. No account needed. We're a one-line reply away if anything feels off.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:30px 36px 28px 36px;">
                <p style="margin:0;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:10.5px;letter-spacing:0.2em;text-transform:uppercase;color:#6E7480;border-top:1px solid #26282D;padding-top:20px;">
                  Bracket &middot; The AI decision workspace for client projects
                </p>
                <p style="margin:8px 0 0 0;font-size:12.5px;color:#6E7480;">
                  If this wasn't you, ignore this email &mdash; we won't follow up.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>"""


def _thanks_text(name: str, project_name: str) -> str:
    display_name = (name or "").strip() or "there"
    pname = (project_name or "your project").strip() or "your project"
    return (
        f"Hi {display_name},\n\n"
        f"Thanks for trying Bracket. You just kicked off a new project: {pname}.\n\n"
        "Move through the five steps at your own pace. When you lock the decision, "
        "you'll have scope, a client message, assumptions, and risk flags ready to send.\n\n"
        "It's free during early access. No account needed.\n\n"
        "— Bracket\n"
        "The AI decision workspace for client projects"
    )


async def send_thanks_email(to_email: str, name: str, project_name: str) -> bool:
    """Fire-and-forget thanks email. Returns True on success, False on failure
    (never raises — project creation must not fail because email failed)."""
    api_key = os.environ.get("RESEND_API_KEY")
    if not api_key:
        logger.warning("RESEND_API_KEY not set; skipping thanks email")
        return False
    resend.api_key = api_key
    params = {
        "from": _sender(),
        "to": [to_email],
        "subject": "Thanks for trying Bracket.",
        "html": _thanks_html(name, project_name),
        "text": _thanks_text(name, project_name),
        "reply_to": os.environ.get("SENDER_EMAIL", ""),
    }
    try:
        result = await asyncio.to_thread(resend.Emails.send, params)
        logger.info(f"thanks email sent to {to_email}: {result.get('id') if isinstance(result, dict) else result}")
        return True
    except Exception as e:
        logger.exception(f"thanks email failed for {to_email}: {e}")
        return False


# --- REVIEW OUTCOME EMAIL --------------------------------------------------
def _review_outcome_html(
    owner_name: str,
    project_name: str,
    review: dict,
    document_url: str,
) -> str:
    is_accept = review.get("type") == "accept"
    display_name = (owner_name or "").strip() or "there"
    pname = (project_name or "your project").strip() or "your project"
    signer = (review.get("signature_name") or "Your client").strip()
    role = (review.get("role") or "").strip()
    signer_line = f"{signer}{', ' + role if role else ''}"

    headline = (
        "Your client signed it off."
        if is_accept
        else "Your client raised concerns."
    )
    accent = "#22C55E" if is_accept else "#EF4444"
    chip_label = "ACCEPTED" if is_accept else "CONCERNS RAISED"

    body_blocks = []
    if is_accept:
        count = review.get("accepted_count", 0)
        total = review.get("total_items", 0)
        body_blocks.append(
            f"<p style='margin:0 0 14px 0;font-size:15px;line-height:1.65;color:#B9BFC9;'>"
            f"<strong style='color:#F4F5F7;'>{signer_line}</strong> checked off "
            f"<strong style='color:#F4F5F7;'>{count}/{total}</strong> items and signed the document for "
            f"<strong style='color:#F4F5F7;'>{pname}</strong>. Go do the work."
            f"</p>"
        )
    else:
        concerns = (review.get("concerns") or "").strip()
        body_blocks.append(
            f"<p style='margin:0 0 14px 0;font-size:15px;line-height:1.65;color:#B9BFC9;'>"
            f"<strong style='color:#F4F5F7;'>{signer_line}</strong> sent back concerns on <strong style='color:#F4F5F7;'>{pname}</strong>. "
            f"Bracket has already drafted three suggestions you can use to respond."
            f"</p>"
        )
        if concerns:
            safe = concerns.replace("<", "&lt;").replace(">", "&gt;")
            body_blocks.append(
                f"<div style='margin:14px 0;padding:14px 16px;border-left:3px solid {accent};background:#16181D;"
                f"border-radius:0 10px 10px 0;font-size:13.5px;line-height:1.6;color:#B9BFC9;white-space:pre-wrap;'>"
                f"{safe}</div>"
            )

    return f"""<!doctype html>
<html><body style="margin:0;padding:0;background:#08090A;font-family:'Poppins','Segoe UI',-apple-system,BlinkMacSystemFont,Roboto,Helvetica,Arial,sans-serif;color:#E8EAF0;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#08090A;padding:44px 16px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#0F1114;border:1px solid #26282D;border-radius:16px;">
<tr><td style="padding:32px 36px 0 36px;">
  <p style="margin:0;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:{accent};">
    &lt; bracket &middot; {chip_label.lower()} &gt;
  </p>
</td></tr>
<tr><td style="padding:18px 36px 0 36px;">
  <h1 style="margin:0;font-size:26px;line-height:1.2;font-weight:600;letter-spacing:-0.02em;color:#F4F5F7;">
    Hi {display_name} &mdash;<br/>
    <span style="color:{accent};">{headline}</span>
  </h1>
</td></tr>
<tr><td style="padding:18px 36px 0 36px;">
  {''.join(body_blocks)}
  <p style="margin:0 0 20px 0;font-size:15px;line-height:1.65;color:#B9BFC9;">
    Open the document in Bracket to see the full response and (if relevant) the AI-drafted suggestions.
  </p>
  <a href="{document_url}" style="display:inline-block;padding:13px 24px;background:#5E6AD2;color:#ffffff;text-decoration:none;font-size:13.5px;font-weight:600;letter-spacing:0.01em;border-radius:10px;">
    Open the document &rarr;
  </a>
</td></tr>
<tr><td style="padding:30px 36px 28px 36px;">
  <p style="margin:0;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:10.5px;letter-spacing:0.2em;text-transform:uppercase;color:#6E7480;border-top:1px solid #26282D;padding-top:20px;">
    Bracket &middot; The AI decision workspace for client projects
  </p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>"""


def _review_outcome_text(
    owner_name: str,
    project_name: str,
    review: dict,
    document_url: str,
) -> str:
    is_accept = review.get("type") == "accept"
    display_name = (owner_name or "").strip() or "there"
    pname = (project_name or "your project").strip() or "your project"
    signer = (review.get("signature_name") or "Your client").strip()
    role = (review.get("role") or "").strip()
    signer_line = f"{signer}{(', ' + role) if role else ''}"
    if is_accept:
        count = review.get("accepted_count", 0)
        total = review.get("total_items", 0)
        return (
            f"Hi {display_name},\n\n"
            f"{signer_line} just signed off on {pname}. They checked {count}/{total} items.\n\n"
            f"Open the document: {document_url}\n\n"
            "— Bracket\nThe AI decision workspace for client projects"
        )
    return (
        f"Hi {display_name},\n\n"
        f"{signer_line} raised concerns on {pname}. Bracket already drafted three suggestions you can use to respond.\n\n"
        f"Concerns:\n{(review.get('concerns') or '').strip()}\n\n"
        f"Open the document: {document_url}\n\n"
        "— Bracket\nThe AI decision workspace for client projects"
    )


async def send_review_outcome_email(
    owner_email: str,
    owner_name: str,
    project_name: str,
    project_id: str,
    review: dict,
    public_base_url: str = "",
) -> bool:
    """Notify the project owner when a client accepts or rejects their document.
    Fire-and-forget — never raises."""
    if not owner_email:
        return False
    api_key = os.environ.get("RESEND_API_KEY")
    if not api_key:
        logger.warning("RESEND_API_KEY not set; skipping review-outcome email")
        return False
    resend.api_key = api_key
    base = (public_base_url or os.environ.get("PUBLIC_BASE_URL", "https://use-bracket.com")).rstrip("/")
    document_url = f"{base}/project/{project_id}/document"
    is_accept = review.get("type") == "accept"
    subject = (
        f"Signed: {project_name} — client accepted"
        if is_accept
        else f"Concerns raised on {project_name}"
    )
    params = {
        "from": _sender(),
        "to": [owner_email],
        "subject": subject,
        "html": _review_outcome_html(owner_name, project_name, review, document_url),
        "text": _review_outcome_text(owner_name, project_name, review, document_url),
        "reply_to": os.environ.get("SENDER_EMAIL", ""),
    }
    try:
        result = await asyncio.to_thread(resend.Emails.send, params)
        logger.info(
            f"review-outcome email sent to {owner_email}: "
            f"{result.get('id') if isinstance(result, dict) else result}"
        )
        return True
    except Exception as e:
        logger.exception(f"review-outcome email failed for {owner_email}: {e}")
        return False


# --- CLIENT RECEIPT EMAIL --------------------------------------------------
def _client_receipt_html(project_name: str, review: dict, share_url: str) -> str:
    is_accept = review.get("type") == "accept"
    pname = (project_name or "the project").strip() or "the project"
    signer = (review.get("signature_name") or "there").strip()
    role = (review.get("role") or "").strip()
    signer_line = f"{signer}{', ' + role if role else ''}"
    accent = "#22C55E" if is_accept else "#EF4444"
    chip = "SIGN-OFF CONFIRMED" if is_accept else "CONCERNS RECEIVED"
    headline = (
        "You signed the sign-off." if is_accept else "We received your concerns."
    )
    if is_accept:
        count = review.get("accepted_count", 0)
        total = review.get("total_items", 0)
        body_block = (
            f"<p style='margin:0 0 14px 0;font-size:15px;line-height:1.65;color:#B9BFC9;'>"
            f"Hi {signer_line} — you signed off on <strong style='color:#F4F5F7;'>{pname}</strong> "
            f"and confirmed <strong style='color:#F4F5F7;'>{count}/{total}</strong> items. We've attached "
            f"the signed PDF for your records."
            f"</p>"
            f"<p style='margin:0 0 14px 0;font-size:15px;line-height:1.65;color:#B9BFC9;'>"
            f"The project owner has also been notified — expect their next update soon."
            f"</p>"
        )
    else:
        concerns = (review.get("concerns") or "").strip()
        safe = concerns.replace("<", "&lt;").replace(">", "&gt;")
        body_block = (
            f"<p style='margin:0 0 14px 0;font-size:15px;line-height:1.65;color:#B9BFC9;'>"
            f"Hi {signer_line} — thanks for taking the time on <strong style='color:#F4F5F7;'>{pname}</strong>. "
            f"Here's a copy of what you sent back so you have it on record:"
            f"</p>"
            f"<div style='margin:14px 0;padding:14px 16px;border-left:3px solid {accent};background:#16181D;"
            f"border-radius:0 10px 10px 0;font-size:13.5px;line-height:1.6;color:#B9BFC9;white-space:pre-wrap;'>"
            f"{safe}</div>"
            f"<p style='margin:0 0 14px 0;font-size:15px;line-height:1.65;color:#B9BFC9;'>"
            f"The project owner has been notified and will respond via the same review link."
            f"</p>"
        )
    return f"""<!doctype html>
<html><body style="margin:0;padding:0;background:#08090A;font-family:'Poppins','Segoe UI',-apple-system,BlinkMacSystemFont,Roboto,Helvetica,Arial,sans-serif;color:#E8EAF0;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#08090A;padding:44px 16px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#0F1114;border:1px solid #26282D;border-radius:16px;">
<tr><td style="padding:32px 36px 0 36px;">
  <p style="margin:0;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:{accent};">
    &lt; bracket &middot; {chip.lower()} &gt;
  </p>
</td></tr>
<tr><td style="padding:18px 36px 0 36px;">
  <h1 style="margin:0;font-size:26px;line-height:1.2;font-weight:600;letter-spacing:-0.02em;color:{accent};">
    {headline}
  </h1>
</td></tr>
<tr><td style="padding:18px 36px 0 36px;">
  {body_block}
  <a href="{share_url}" style="display:inline-block;padding:13px 24px;background:#5E6AD2;color:#ffffff;text-decoration:none;font-size:13.5px;font-weight:600;letter-spacing:0.01em;border-radius:10px;">
    View the document &rarr;
  </a>
</td></tr>
<tr><td style="padding:30px 36px 28px 36px;">
  <p style="margin:0;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:10.5px;letter-spacing:0.2em;text-transform:uppercase;color:#6E7480;border-top:1px solid #26282D;padding-top:20px;">
    Bracket &middot; The AI decision workspace for client projects
  </p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>"""


def _client_receipt_text(project_name: str, review: dict, share_url: str) -> str:
    is_accept = review.get("type") == "accept"
    pname = (project_name or "the project").strip() or "the project"
    signer = (review.get("signature_name") or "there").strip()
    if is_accept:
        count = review.get("accepted_count", 0)
        total = review.get("total_items", 0)
        return (
            f"Hi {signer},\n\n"
            f"You signed off on {pname}. {count}/{total} items confirmed.\n"
            f"The signed PDF is attached for your records.\n\n"
            f"View the document: {share_url}\n\n"
            "— Bracket\nThe AI decision workspace for client projects"
        )
    return (
        f"Hi {signer},\n\n"
        f"We received your concerns on {pname}. Here's what you sent:\n\n"
        f"{(review.get('concerns') or '').strip()}\n\n"
        f"The project owner will respond via the same review link:\n{share_url}\n\n"
        "— Bracket\nThe AI decision workspace for client projects"
    )


async def send_client_receipt_email(
    client_email: str,
    project_name: str,
    review: dict,
    share_url: str,
    pdf_bytes: bytes = b"",
    pdf_filename: str = "sign-off.pdf",
) -> bool:
    """Send the client a receipt of their action.
    - Accept: attach the signed PDF.
    - Reject: echo their concerns back as a paper trail.
    Fire-and-forget — never raises."""
    if not client_email:
        return False
    api_key = os.environ.get("RESEND_API_KEY")
    if not api_key:
        logger.warning("RESEND_API_KEY not set; skipping client-receipt email")
        return False
    resend.api_key = api_key
    is_accept = review.get("type") == "accept"
    subject = (
        f"Signed: {project_name} — copy for your records"
        if is_accept
        else f"Concerns received: {project_name}"
    )
    params = {
        "from": _sender(),
        "to": [client_email],
        "subject": subject,
        "html": _client_receipt_html(project_name, review, share_url),
        "text": _client_receipt_text(project_name, review, share_url),
        "reply_to": os.environ.get("SENDER_EMAIL", ""),
    }
    if is_accept and pdf_bytes:
        # Resend accepts base64-encoded attachments.
        import base64
        params["attachments"] = [{
            "filename": pdf_filename,
            "content": base64.b64encode(pdf_bytes).decode("ascii"),
        }]
    try:
        result = await asyncio.to_thread(resend.Emails.send, params)
        logger.info(
            f"client-receipt email sent to {client_email}: "
            f"{result.get('id') if isinstance(result, dict) else result}"
        )
        return True
    except Exception as e:
        logger.exception(f"client-receipt email failed for {client_email}: {e}")
        return False


def _owner_reply_html(client_name: str, owner_name: str, project_name: str, reply_text: str, share_url: str) -> str:
    who = (client_name or "there").strip() or "there"
    owner = (owner_name or "The project owner").strip() or "The project owner"
    pname = (project_name or "your project").strip() or "your project"
    safe = (reply_text or "").replace("<", "&lt;").replace(">", "&gt;")
    return f"""<!doctype html>
<html><body style="margin:0;padding:0;background:#08090A;font-family:'Poppins','Segoe UI',-apple-system,BlinkMacSystemFont,Roboto,Helvetica,Arial,sans-serif;color:#E8EAF0;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#08090A;padding:44px 16px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#0F1114;border:1px solid #26282D;border-radius:16px;">
<tr><td style="padding:32px 36px 0 36px;">
  <p style="margin:0;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:#5E6AD2;">&lt; bracket &middot; reply to your concerns &gt;</p>
</td></tr>
<tr><td style="padding:18px 36px 0 36px;">
  <h1 style="margin:0;font-size:24px;line-height:1.25;font-weight:600;letter-spacing:-0.02em;color:#F4F5F7;">{owner} replied.</h1>
</td></tr>
<tr><td style="padding:16px 36px 0 36px;">
  <p style="margin:0 0 14px 0;font-size:15px;line-height:1.65;color:#B9BFC9;">Hi {who} &mdash; here's the response to the concerns you raised on <strong style="color:#F4F5F7;">{pname}</strong>:</p>
  <div style="margin:14px 0;padding:14px 16px;border-left:3px solid #5E6AD2;background:#16181D;border-radius:0 10px 10px 0;font-size:13.5px;line-height:1.6;color:#B9BFC9;white-space:pre-wrap;">{safe}</div>
  <p style="margin:0 0 20px 0;font-size:15px;line-height:1.65;color:#B9BFC9;">Open the document to review and continue the conversation.</p>
  <a href="{share_url}" style="display:inline-block;padding:13px 24px;background:#5E6AD2;color:#ffffff;text-decoration:none;font-size:13.5px;font-weight:600;letter-spacing:0.01em;border-radius:10px;">Open the document &rarr;</a>
</td></tr>
<tr><td style="padding:30px 36px 28px 36px;">
  <p style="margin:0;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:10.5px;letter-spacing:0.2em;text-transform:uppercase;color:#6E7480;border-top:1px solid #26282D;padding-top:20px;">Bracket &middot; The AI decision workspace for client projects</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>"""


async def send_owner_reply_email(
    client_email: str,
    client_name: str,
    owner_name: str,
    project_name: str,
    reply_text: str,
    share_url: str,
) -> bool:
    """Notify the client that the owner responded to their concerns.
    Fire-and-forget — never raises."""
    if not client_email:
        return False
    api_key = os.environ.get("RESEND_API_KEY")
    if not api_key:
        logger.warning("RESEND_API_KEY not set; skipping owner-reply email")
        return False
    resend.api_key = api_key
    params = {
        "from": _sender(),
        "to": [client_email],
        "subject": f"Reply to your concerns — {project_name}",
        "html": _owner_reply_html(client_name, owner_name, project_name, reply_text, share_url),
        "text": f"{owner_name} replied to your concerns on {project_name}:\n\n{reply_text}\n\nOpen the document: {share_url}",
        "reply_to": os.environ.get("SENDER_EMAIL", ""),
    }
    try:
        result = await asyncio.to_thread(resend.Emails.send, params)
        logger.info(f"owner-reply email sent to {client_email}: {result.get('id') if isinstance(result, dict) else result}")
        return True
    except Exception as e:
        logger.exception(f"owner-reply email failed for {client_email}: {e}")
        return False


def _document_updated_html(client_name: str, owner_name: str, project_name: str, change_note: str, share_url: str) -> str:
    who = (client_name or "there").strip() or "there"
    owner = (owner_name or "The project owner").strip() or "The project owner"
    pname = (project_name or "your project").strip() or "your project"
    safe = (change_note or "").replace("<", "&lt;").replace(">", "&gt;")
    return f"""<!doctype html>
<html><body style="margin:0;padding:0;background:#08090A;font-family:'Poppins','Segoe UI',-apple-system,BlinkMacSystemFont,Roboto,Helvetica,Arial,sans-serif;color:#E8EAF0;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#08090A;padding:44px 16px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#0F1114;border:1px solid #26282D;border-radius:16px;">
<tr><td style="padding:32px 36px 0 36px;">
  <p style="margin:0;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:#5E6AD2;">&lt; bracket &middot; document updated &gt;</p>
</td></tr>
<tr><td style="padding:18px 36px 0 36px;">
  <h1 style="margin:0;font-size:24px;line-height:1.25;font-weight:600;letter-spacing:-0.02em;color:#F4F5F7;">Your requested changes are in.</h1>
</td></tr>
<tr><td style="padding:16px 36px 0 36px;">
  <p style="margin:0 0 14px 0;font-size:15px;line-height:1.65;color:#B9BFC9;">Hi {who} &mdash; {owner} updated <strong style="color:#F4F5F7;">{pname}</strong> based on your feedback. Here's what changed:</p>
  <div style="margin:14px 0;padding:14px 16px;border-left:3px solid #4BE39B;background:#16181D;border-radius:0 10px 10px 0;font-size:13.5px;line-height:1.6;color:#B9BFC9;white-space:pre-wrap;">{safe}</div>
  <p style="margin:0 0 20px 0;font-size:15px;line-height:1.65;color:#B9BFC9;">Take another look and sign off when it feels right.</p>
  <a href="{share_url}" style="display:inline-block;padding:13px 24px;background:#5E6AD2;color:#ffffff;text-decoration:none;font-size:13.5px;font-weight:600;letter-spacing:0.01em;border-radius:10px;">Re-review the document &rarr;</a>
</td></tr>
<tr><td style="padding:30px 36px 28px 36px;">
  <p style="margin:0;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:10.5px;letter-spacing:0.2em;text-transform:uppercase;color:#6E7480;border-top:1px solid #26282D;padding-top:20px;">Bracket &middot; The AI decision workspace for client projects</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>"""


async def send_document_updated_email(
    client_email: str,
    client_name: str,
    owner_name: str,
    project_name: str,
    change_note: str,
    share_url: str,
) -> bool:
    """Notify the client that the document was updated with their requested
    changes, including a "here's what changed" note. Fire-and-forget."""
    if not client_email:
        return False
    api_key = os.environ.get("RESEND_API_KEY")
    if not api_key:
        logger.warning("RESEND_API_KEY not set; skipping document-updated email")
        return False
    resend.api_key = api_key
    params = {
        "from": _sender(),
        "to": [client_email],
        "subject": f"Updated for you — {project_name}",
        "html": _document_updated_html(client_name, owner_name, project_name, change_note, share_url),
        "text": f"{owner_name} updated {project_name} based on your feedback.\n\nWhat changed:\n{change_note}\n\nRe-review the document: {share_url}",
        "reply_to": os.environ.get("SENDER_EMAIL", ""),
    }
    try:
        result = await asyncio.to_thread(resend.Emails.send, params)
        logger.info(f"document-updated email sent to {client_email}: {result.get('id') if isinstance(result, dict) else result}")
        return True
    except Exception as e:
        logger.exception(f"document-updated email failed for {client_email}: {e}")
        return False


# =====================================================================
# NPS SURVEY EMAIL
# One-tap 0-10 rating buttons. Each button links to
#   {public_base_url}/api/nps/submit?u={user_id}&s={score}&t={token}
# which records the score and lands the user on a thank-you page
# with an optional free-text comment field.
# =====================================================================
def _nps_button_cell(score: int, url: str) -> str:
    """One 0-10 rating cell — bold border, hover-friendly, tap target ≥ 40px.
    Colored by detractor (0-6) / passive (7-8) / promoter (9-10) tone."""
    if score <= 6:
        border = "#EF4444"; text = "#FCA5A5"
    elif score <= 8:
        border = "#F59E0B"; text = "#FCD34D"
    else:
        border = "#22C55E"; text = "#86EFAC"
    return (
        f'<td align="center" style="padding:0 3px;">'
        f'<a href="{url}" '
        f'style="display:inline-block;min-width:38px;padding:12px 6px;text-align:center;'
        f'background:#0F1114;border:1.5px solid {border};border-radius:10px;'
        f'font-family:\'Poppins\',\'Segoe UI\',sans-serif;font-size:16px;font-weight:600;'
        f'color:{text};text-decoration:none;letter-spacing:-0.01em;">'
        f'{score}'
        f'</a>'
        f'</td>'
    )


def _nps_survey_html(name: str, base_url: str, user_id: str, token: str, logo_url: str) -> str:
    display_name = (name or "").strip() or "there"
    # Build one 11-cell row of 0-10 rating buttons.
    row_cells = "".join(
        _nps_button_cell(s, f"{base_url}/api/nps/submit?u={user_id}&s={s}&t={token}")
        for s in range(11)
    )
    return f"""<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#08090A;font-family:'Poppins','Segoe UI',-apple-system,BlinkMacSystemFont,Roboto,Helvetica,Arial,sans-serif;color:#E8EAF0;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#08090A;padding:44px 16px;">
      <tr>
        <td align="center">
          <table width="620" cellpadding="0" cellspacing="0" style="max-width:620px;background:#0F1114;border:1px solid #26282D;border-radius:16px;">
            <!-- Logo row -->
            <tr>
              <td align="center" style="padding:34px 36px 0 36px;">
                <img src="{logo_url}" alt="Bracket" width="44" height="44" style="display:block;width:44px;height:44px;border:0;outline:none;" />
              </td>
            </tr>
            <!-- Chip -->
            <tr>
              <td align="center" style="padding:18px 36px 0 36px;">
                <p style="margin:0;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:#5E6AD2;">
                  &lt; bracket &middot; one question &gt;
                </p>
              </td>
            </tr>
            <!-- Headline -->
            <tr>
              <td style="padding:14px 36px 0 36px;" align="center">
                <h1 style="margin:0;font-size:28px;line-height:1.2;font-weight:600;letter-spacing:-0.02em;color:#F4F5F7;text-align:center;">
                  How likely are you to<br/>
                  recommend <span style="color:#5E6AD2;">Bracket</span> to a friend?
                </h1>
              </td>
            </tr>
            <!-- Personal note -->
            <tr>
              <td style="padding:18px 36px 0 36px;">
                <p style="margin:0 0 8px 0;font-size:15px;line-height:1.65;color:#B9BFC9;text-align:center;">
                  Hi {display_name} — one tap, one number. Your honest read
                  helps us shape what Bracket becomes next.
                </p>
              </td>
            </tr>
            <!-- Rating row -->
            <tr>
              <td style="padding:26px 20px 6px 20px;" align="center">
                <table cellpadding="0" cellspacing="0" style="margin:0 auto;">
                  <tr>{row_cells}</tr>
                </table>
              </td>
            </tr>
            <!-- Legend -->
            <tr>
              <td style="padding:6px 36px 0 36px;">
                <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;">
                  <tr>
                    <td style="font-family:'JetBrains Mono',ui-monospace,monospace;font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:#6E7480;">Not likely</td>
                    <td align="right" style="font-family:'JetBrains Mono',ui-monospace,monospace;font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:#6E7480;">Extremely likely</td>
                  </tr>
                </table>
              </td>
            </tr>
            <!-- Why it matters -->
            <tr>
              <td style="padding:26px 36px 0 36px;">
                <p style="margin:0;font-size:13.5px;line-height:1.7;color:#8A93A0;text-align:center;">
                  Tapping a number is enough. If you have ~30 seconds, the
                  next page has a small text box where you can tell us why —
                  we read every single one.
                </p>
              </td>
            </tr>
            <!-- Footer -->
            <tr>
              <td style="padding:30px 36px 30px 36px;">
                <p style="margin:0;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:10.5px;letter-spacing:0.2em;text-transform:uppercase;color:#6E7480;border-top:1px solid #26282D;padding-top:20px;text-align:center;">
                  Bracket &middot; The AI decision workspace for client projects
                </p>
                <p style="margin:8px 0 0 0;font-size:12px;color:#6E7480;text-align:center;">
                  You're receiving this because you signed up at use-bracket.com. This is a one-time survey — no follow-ups.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>"""


def _nps_survey_text(name: str, base_url: str, user_id: str, token: str) -> str:
    display_name = (name or "").strip() or "there"
    lines = [f"Hi {display_name},", "",
             "One question — how likely are you to recommend Bracket to a friend? (0 = not likely, 10 = extremely likely)",
             ""]
    for s in range(11):
        lines.append(f"  {s} — {base_url}/api/nps/submit?u={user_id}&s={s}&t={token}")
    lines += ["",
              "Tapping a number is enough. The next page has a small text box if you want to tell us why.",
              "",
              "— Bracket",
              "The AI decision workspace for client projects"]
    return "\n".join(lines)


async def send_nps_survey_email(
    to_email: str,
    name: str,
    user_id: str,
    token: str,
    public_base_url: str,
    logo_url: str,
) -> bool:
    """Fire-and-forget NPS survey. Returns True on success, False on failure."""
    if not to_email:
        return False
    api_key = os.environ.get("RESEND_API_KEY")
    if not api_key:
        logger.warning("RESEND_API_KEY not set; skipping NPS survey email")
        return False
    resend.api_key = api_key
    base = (public_base_url or "https://use-bracket.com").rstrip("/")
    params = {
        "from": _sender(),
        "to": [to_email],
        "subject": "One tap · how likely are you to recommend Bracket?",
        "html": _nps_survey_html(name, base, user_id, token, logo_url),
        "text": _nps_survey_text(name, base, user_id, token),
        "reply_to": os.environ.get("SENDER_EMAIL", ""),
    }
    try:
        result = await asyncio.to_thread(resend.Emails.send, params)
        logger.info(f"nps-survey email sent to {to_email}: {result.get('id') if isinstance(result, dict) else result}")
        return True
    except Exception as e:
        logger.exception(f"nps-survey email failed for {to_email}: {e}")
        return False



# --- SCOPE-CREEP ALERT EMAIL ----------------------------------------------
def _scope_alert_html(owner_name: str, project_name: str, client_name: str,
                      items: list, project_url: str) -> str:
    display_name = (owner_name or "").strip() or "there"
    pname = (project_name or "your project").strip() or "your project"
    who = (client_name or "The client").strip() or "The client"
    accent = "#F59E0B"
    rows = []
    for it in items[:8]:
        title = str(it.get("title") or "").replace("<", "&lt;").replace(">", "&gt;")
        detail = str(it.get("detail") or "").replace("<", "&lt;").replace(">", "&gt;")
        rows.append(
            f"<tr><td style='padding:14px 16px;border:1px solid #26282D;border-radius:10px;"
            f"background:#16181D;'>"
            f"<p style='margin:0;font-size:14px;font-weight:600;color:#F4F5F7;'>{title}</p>"
            + (f"<p style='margin:6px 0 0 0;font-size:13px;line-height:1.55;color:#B9BFC9;'>{detail}</p>" if detail else "")
            + "</td></tr><tr><td style='height:10px;line-height:10px;'>&nbsp;</td></tr>"
        )
    n = len(items)
    return f"""<!doctype html>
<html><body style="margin:0;padding:0;background:#08090A;font-family:'Poppins','Segoe UI',-apple-system,BlinkMacSystemFont,Roboto,Helvetica,Arial,sans-serif;color:#E8EAF0;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#08090A;padding:44px 16px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#0F1114;border:1px solid #26282D;border-radius:16px;">
<tr><td style="padding:32px 36px 0 36px;">
  <p style="margin:0;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:{accent};">
    &lt; bracket &middot; scope alert &gt;
  </p>
</td></tr>
<tr><td style="padding:18px 36px 0 36px;">
  <h1 style="margin:0;font-size:25px;line-height:1.22;font-weight:600;letter-spacing:-0.02em;color:#F4F5F7;">
    Heads up &mdash;<br/><span style="color:{accent};">{who} asked for something new.</span>
  </h1>
</td></tr>
<tr><td style="padding:16px 36px 0 36px;">
  <p style="margin:0 0 18px 0;font-size:15px;line-height:1.65;color:#B9BFC9;">
    Hi {display_name} &mdash; Bracket spotted <strong style="color:#F4F5F7;">{n}</strong> request{'s' if n != 1 else ''} on
    <strong style="color:#F4F5F7;">{pname}</strong> that look{'s' if n == 1 else ''} like they expand the scope. Review before you commit:
  </p>
  <table width="100%" cellpadding="0" cellspacing="0">{''.join(rows)}</table>
  <a href="{project_url}" style="display:inline-block;margin-top:6px;padding:13px 24px;background:#F4F5F7;color:#08090A;text-decoration:none;font-size:13.5px;font-weight:600;letter-spacing:0.01em;border-radius:10px;">
    Review in Bracket &rarr;
  </a>
</td></tr>
<tr><td style="padding:28px 36px 28px 36px;">
  <p style="margin:0;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:10.5px;letter-spacing:0.2em;text-transform:uppercase;color:#6E7480;border-top:1px solid #26282D;padding-top:20px;">
    Bracket &middot; The AI decision workspace for client projects
  </p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>"""


def _scope_alert_text(owner_name: str, project_name: str, client_name: str,
                      items: list, project_url: str) -> str:
    display_name = (owner_name or "").strip() or "there"
    pname = (project_name or "your project").strip() or "your project"
    who = (client_name or "The client").strip() or "The client"
    lines = [f"Hi {display_name},", "",
             f"Bracket spotted {len(items)} request(s) on {pname} that look like they expand the scope "
             f"({who}). Review before you commit:", ""]
    for it in items[:8]:
        t = str(it.get("title") or "").strip()
        d = str(it.get("detail") or "").strip()
        lines.append(f"  • {t}" + (f" — {d}" if d else ""))
    lines += ["", f"Review in Bracket: {project_url}", "",
              "— Bracket", "The AI decision workspace for client projects"]
    return "\n".join(lines)


async def send_scope_creep_alert(
    owner_email: str,
    owner_name: str,
    project_name: str,
    project_id: str,
    client_name: str,
    items: list,
    public_base_url: str = "",
) -> bool:
    """Alert the project owner when Bracket detects client requests that expand
    scope during a sync. Batched — one email per sync. Fire-and-forget."""
    if not owner_email or not items:
        return False
    api_key = os.environ.get("RESEND_API_KEY")
    if not api_key:
        logger.warning("RESEND_API_KEY not set; skipping scope-creep alert")
        return False
    resend.api_key = api_key
    base = (public_base_url or os.environ.get("PUBLIC_BASE_URL", "https://use-bracket.com")).rstrip("/")
    project_url = f"{base}/project/{project_id}"
    n = len(items)
    subject = f"Scope alert: {project_name} — {n} new request{'s' if n != 1 else ''}"
    params = {
        "from": _sender(),
        "to": [owner_email],
        "subject": subject,
        "html": _scope_alert_html(owner_name, project_name, client_name, items, project_url),
        "text": _scope_alert_text(owner_name, project_name, client_name, items, project_url),
        "reply_to": os.environ.get("SENDER_EMAIL", ""),
    }
    try:
        result = await asyncio.to_thread(resend.Emails.send, params)
        logger.info(f"scope-creep alert sent to {owner_email}: {result.get('id') if isinstance(result, dict) else result}")
        return True
    except Exception as e:
        logger.exception(f"scope-creep alert failed for {owner_email}: {e}")
        return False


# --- PAYMENT RECEIPT EMAIL -------------------------------------------------
def _fmt_amount(amount, currency: str) -> str:
    sym = "₹" if (currency or "").lower() == "inr" else "$"
    try:
        a = float(amount)
    except (TypeError, ValueError):
        return f"{sym}{amount}"
    if (currency or "").lower() == "inr":
        return f"{sym}{int(round(a)):,}"
    return f"{sym}{a:.2f}".rstrip("0").rstrip(".")


def _receipt_html(name: str, plan_label: str, amount_str: str, recurring: bool,
                  date_str: str, ref: str, app_url: str) -> str:
    display_name = (name or "").strip() or "there"
    accent = "#22C55E"
    billing = "Monthly subscription" if recurring else "One-time payment"
    what = ("Up to 10 active projects, unlimited connected tools and live project memory."
            if recurring else
            "One project, active for 60 days, with unlimited connected tools and live project memory.")
    return f"""<!doctype html>
<html><body style="margin:0;padding:0;background:#08090A;font-family:'Poppins','Segoe UI',-apple-system,BlinkMacSystemFont,Roboto,Helvetica,Arial,sans-serif;color:#E8EAF0;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#08090A;padding:44px 16px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#0F1114;border:1px solid #26282D;border-radius:16px;">
<tr><td style="padding:32px 36px 0 36px;">
  <p style="margin:0;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:{accent};">
    &lt; bracket &middot; payment confirmed &gt;
  </p>
</td></tr>
<tr><td style="padding:18px 36px 0 36px;">
  <h1 style="margin:0;font-size:26px;line-height:1.2;font-weight:600;letter-spacing:-0.02em;color:#F4F5F7;">
    You're all set, {display_name}.
  </h1>
</td></tr>
<tr><td style="padding:16px 36px 0 36px;">
  <p style="margin:0 0 18px 0;font-size:15px;line-height:1.65;color:#B9BFC9;">
    Thanks for your payment. Here's your receipt for <strong style="color:#F4F5F7;">{plan_label}</strong>.
  </p>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#16181D;border:1px solid #26282D;border-radius:12px;">
    <tr><td style="padding:16px 18px;border-bottom:1px solid #22242A;">
      <table width="100%"><tr>
        <td style="font-size:13px;color:#8A93A0;">Plan</td>
        <td align="right" style="font-size:13.5px;color:#F4F5F7;font-weight:600;">{plan_label}</td>
      </tr></table></td></tr>
    <tr><td style="padding:16px 18px;border-bottom:1px solid #22242A;">
      <table width="100%"><tr>
        <td style="font-size:13px;color:#8A93A0;">Billing</td>
        <td align="right" style="font-size:13.5px;color:#F4F5F7;">{billing}</td>
      </tr></table></td></tr>
    <tr><td style="padding:16px 18px;border-bottom:1px solid #22242A;">
      <table width="100%"><tr>
        <td style="font-size:13px;color:#8A93A0;">Date</td>
        <td align="right" style="font-size:13.5px;color:#F4F5F7;">{date_str}</td>
      </tr></table></td></tr>
    <tr><td style="padding:18px 18px;">
      <table width="100%"><tr>
        <td style="font-size:14px;color:#F4F5F7;font-weight:600;">Total paid</td>
        <td align="right" style="font-size:20px;color:{accent};font-weight:700;letter-spacing:-0.01em;">{amount_str}</td>
      </tr></table></td></tr>
  </table>
  <p style="margin:18px 0 18px 0;font-size:14px;line-height:1.6;color:#B9BFC9;">{what}</p>
  <a href="{app_url}" style="display:inline-block;padding:13px 24px;background:#F4F5F7;color:#08090A;text-decoration:none;font-size:13.5px;font-weight:600;letter-spacing:0.01em;border-radius:10px;">
    Open Bracket &rarr;
  </a>
</td></tr>
<tr><td style="padding:28px 36px 28px 36px;">
  <p style="margin:0 0 6px 0;font-size:12px;color:#6E7480;">Reference: {ref}</p>
  <p style="margin:0;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:10.5px;letter-spacing:0.2em;text-transform:uppercase;color:#6E7480;border-top:1px solid #26282D;padding-top:20px;">
    Bracket &middot; The AI decision workspace for client projects
  </p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>"""


def _receipt_text(name: str, plan_label: str, amount_str: str, recurring: bool,
                  date_str: str, ref: str, app_url: str) -> str:
    display_name = (name or "").strip() or "there"
    billing = "Monthly subscription" if recurring else "One-time payment"
    return (
        f"Hi {display_name},\n\n"
        f"Thanks for your payment. Here's your receipt:\n\n"
        f"  Plan:    {plan_label}\n"
        f"  Billing: {billing}\n"
        f"  Date:    {date_str}\n"
        f"  Total:   {amount_str}\n\n"
        f"Open Bracket: {app_url}\n"
        f"Reference: {ref}\n\n"
        "— Bracket\nThe AI decision workspace for client projects"
    )


async def send_payment_receipt(
    to_email: str,
    name: str,
    plan_label: str,
    amount,
    currency: str,
    recurring: bool,
    session_id: str = "",
    public_base_url: str = "",
) -> bool:
    """Branded receipt after a successful payment. Fire-and-forget — never raises."""
    if not to_email:
        return False
    api_key = os.environ.get("RESEND_API_KEY")
    if not api_key:
        logger.warning("RESEND_API_KEY not set; skipping payment receipt")
        return False
    resend.api_key = api_key
    import datetime as _dt
    base = (public_base_url or os.environ.get("PUBLIC_BASE_URL", "https://use-bracket.com")).rstrip("/")
    app_url = f"{base}/app"
    amount_str = _fmt_amount(amount, currency)
    date_str = _dt.datetime.now(_dt.timezone.utc).strftime("%d %b %Y")
    ref = (session_id or "")[-16:] or "—"
    plan_label = plan_label or "Bracket"
    params = {
        "from": _sender(),
        "to": [to_email],
        "subject": f"Receipt: {plan_label} — {amount_str}",
        "html": _receipt_html(name, plan_label, amount_str, recurring, date_str, ref, app_url),
        "text": _receipt_text(name, plan_label, amount_str, recurring, date_str, ref, app_url),
        "reply_to": os.environ.get("SENDER_EMAIL", ""),
    }
    try:
        result = await asyncio.to_thread(resend.Emails.send, params)
        logger.info(f"payment receipt sent to {to_email}: {result.get('id') if isinstance(result, dict) else result}")
        return True
    except Exception as e:
        logger.exception(f"payment receipt failed for {to_email}: {e}")
        return False



# --- DAILY SCOPE-ALERT DIGEST ---------------------------------------------
def _scope_digest_html(owner_name: str, groups: list, base: str) -> str:
    display_name = (owner_name or "").strip() or "there"
    accent = "#F59E0B"
    total = sum(len(g.get("items") or []) for g in groups)
    blocks = []
    for g in groups:
        items = g.get("items") or []
        if not items:
            continue
        purl = f"{base}/project/{g.get('project_id')}"
        rows = "".join(
            f"<tr><td style='padding:10px 14px;border-bottom:1px solid #22242A;'>"
            f"<span style='font-size:13.5px;color:#F4F5F7;font-weight:600;'>{(it.get('title') or '')[:160]}</span>"
            + (f"<br/><span style='font-size:12.5px;color:#9AA1AC;line-height:1.5;'>{(it.get('detail') or '')[:220]}</span>" if it.get('detail') else "")
            + "</td></tr>"
            for it in items[:12]
        )
        blocks.append(
            f"<p style='margin:22px 0 8px 0;font-size:13px;color:#8A93A0;'>"
            f"<strong style='color:#F4F5F7;'>{(g.get('project_name') or 'your project')}</strong> &middot; {len(items)} new</p>"
            f"<table width='100%' cellpadding='0' cellspacing='0' style='background:#16181D;border:1px solid #26282D;border-radius:12px;'>{rows}</table>"
            f"<a href='{purl}' style='display:inline-block;margin-top:10px;font-size:12.5px;color:{accent};text-decoration:none;'>Review in Bracket &rarr;</a>"
        )
    return f"""<!doctype html>
<html><body style="margin:0;padding:0;background:#08090A;font-family:'Poppins','Segoe UI',-apple-system,BlinkMacSystemFont,Roboto,Helvetica,Arial,sans-serif;color:#E8EAF0;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#08090A;padding:44px 16px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#0F1114;border:1px solid #26282D;border-radius:16px;">
<tr><td style="padding:32px 36px 0 36px;">
  <p style="margin:0;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:{accent};">
    &lt; bracket &middot; daily scope digest &gt;
  </p>
</td></tr>
<tr><td style="padding:18px 36px 0 36px;">
  <h1 style="margin:0;font-size:26px;line-height:1.2;font-weight:600;letter-spacing:-0.02em;color:#F4F5F7;">
    Hi {display_name} &mdash;<br/><span style="color:{accent};">{total} new client request{'s' if total != 1 else ''} to review</span>
  </h1>
</td></tr>
<tr><td style="padding:8px 36px 0 36px;">
  <p style="margin:0 0 4px 0;font-size:14px;line-height:1.6;color:#B9BFC9;">Here's everything new across your projects since your last digest.</p>
  {''.join(blocks)}
</td></tr>
<tr><td style="padding:30px 36px 28px 36px;">
  <p style="margin:0;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:10.5px;letter-spacing:0.2em;text-transform:uppercase;color:#6E7480;border-top:1px solid #26282D;padding-top:20px;">
    Bracket &middot; project memory for client work
  </p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>"""


def _scope_digest_text(owner_name: str, groups: list, base: str) -> str:
    display_name = (owner_name or "").strip() or "there"
    lines = [f"Hi {display_name},", "", "New client requests to review since your last digest:", ""]
    for g in groups:
        items = g.get("items") or []
        if not items:
            continue
        lines.append(f"{g.get('project_name') or 'your project'} ({len(items)} new):")
        for it in items[:12]:
            d = f" — {it.get('detail')}" if it.get("detail") else ""
            lines.append(f"  - {it.get('title', '')}{d}")
        lines.append(f"  Review: {base}/project/{g.get('project_id')}")
        lines.append("")
    lines.append("— Bracket")
    return "\n".join(lines)


async def send_scope_digest(owner_email: str, owner_name: str, groups: list, public_base_url: str = "") -> bool:
    """One batched daily digest of new scope asks across an owner's projects."""
    groups = [g for g in (groups or []) if (g.get("items"))]
    if not owner_email or not groups:
        return False
    api_key = os.environ.get("RESEND_API_KEY")
    if not api_key:
        logger.warning("RESEND_API_KEY not set; skipping scope digest")
        return False
    resend.api_key = api_key
    base = (public_base_url or os.environ.get("PUBLIC_BASE_URL", "https://use-bracket.com")).rstrip("/")
    total = sum(len(g.get("items") or []) for g in groups)
    params = {
        "from": _sender(),
        "to": [owner_email],
        "subject": f"Scope digest: {total} new client request{'s' if total != 1 else ''}",
        "html": _scope_digest_html(owner_name, groups, base),
        "text": _scope_digest_text(owner_name, groups, base),
        "reply_to": os.environ.get("SENDER_EMAIL", ""),
    }
    try:
        result = await asyncio.to_thread(resend.Emails.send, params)
        logger.info(f"scope digest sent to {owner_email}: {result.get('id') if isinstance(result, dict) else result}")
        return True
    except Exception as e:
        logger.exception(f"scope digest failed for {owner_email}: {e}")
        return False
