"""Web Push notifications (VAPID). Subscriptions live in `push_subscriptions`:
{user_id, subscription: {endpoint, keys{p256dh, auth}}, user_agent, created_at}."""
import asyncio
import json
import logging
import os

from pywebpush import webpush, WebPushException

logger = logging.getLogger("bracket")


def _vapid_config():
    priv = os.environ.get("VAPID_PRIVATE_KEY", "")
    sub = os.environ.get("VAPID_CLAIMS_SUB", "mailto:support@use-bracket.com")
    return priv, {"sub": sub}


def _push_one(subscription: dict, payload: str):
    priv, claims = _vapid_config()
    webpush(
        subscription_info=subscription,
        data=payload,
        vapid_private_key=priv,
        vapid_claims=dict(claims),
        ttl=86400,
    )


async def send_push_to_user(db, user_id: str, title: str, body: str, url: str = "/app"):
    """Send a push to every device the user subscribed on. Dead subscriptions
    (404/410 from the push service) are pruned. Never raises."""
    if not user_id or not os.environ.get("VAPID_PRIVATE_KEY"):
        return
    payload = json.dumps({"title": title, "body": body, "url": url})
    sent = 0
    async for row in db.push_subscriptions.find({"user_id": user_id}):
        sub = row.get("subscription") or {}
        try:
            await asyncio.to_thread(_push_one, sub, payload)
            sent += 1
        except WebPushException as e:
            status = getattr(getattr(e, "response", None), "status_code", None)
            if status in (404, 410):
                await db.push_subscriptions.delete_one({"_id": row["_id"]})
                logger.info("pruned dead push subscription for %s", user_id)
            else:
                logger.warning("push failed for %s: %s", user_id, e)
        except Exception as e:
            logger.warning("push crashed for %s: %s", user_id, e)
    if sent:
        logger.info("push sent to %s (%d device(s)): %s", user_id, sent, title)


async def send_push_to_owner(db, project: dict, title: str, body: str, url: str = "/app"):
    """Resolve the project owner (owner_user_id, falling back to creator_email
    lookup) and push to them."""
    user_id = project.get("owner_user_id") or ""
    if not user_id and project.get("creator_email"):
        u = await db.users.find_one({"email": project["creator_email"]}, {"user_id": 1})
        user_id = (u or {}).get("user_id", "")
    await send_push_to_user(db, user_id, title, body, url)
