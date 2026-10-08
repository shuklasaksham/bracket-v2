# Bracket API v2

The rest of the v2 contract is not written up yet: `mock/server.js` is the reference for it until the full `backend/v2.py` lands. This file covers the two features added on 2026-10-08. Each one has a working backend and a mock that mirrors it.

| Feature | Backend | Mock | Frontend | Figma |
|---|---|---|---|---|
| Sandbox | `backend/sandbox_v2.py` | `mock/sandbox.js` | `frontend/src/v2/sandbox/` | page **12 Sandbox** |
| Admin panel | `backend/admin_v2.py` | `mock/admin.js` | `frontend/src/v2/admin/` | page **13 Admin panel** |

Both are mounted in `backend/server.py` through `install(app)`. Tests live in `backend/tests/test_admin_sandbox_v2.py`; there are 20 of them, and they run against an in-memory Mongo:

```bash
cd backend && .venv/Scripts/python -m pytest tests/test_admin_sandbox_v2.py -q
```

---

## Sandbox: `/api/v2/sandbox`

The sandbox lets a visitor try Bracket with no sign-up, no connected tools and no payment.

- `POST /start` creates an anonymous guest (`users.is_sandbox = true`) with a **2-hour** session cookie. It also seeds the sample project, so every workspace screen works without changes.
- The guest plays **Maya Rao**, a design lead at Northlight Studio, working on the Acme Finance website redesign.
- Guests and their data are deleted when they leave, or by a cleanup loop that runs every 15 minutes once the session expires.

| Method & path | Body | Returns |
|---|---|---|
| `POST /start` | — | `{ ok, workspace_id, sandbox }`. Replaces any earlier guest in this browser. |
| `GET /` | — | `{ active, sandbox: { id, beat, total, done, tour_step, started_at } \| null }` |
| `POST /next` | — | Plays the next scripted client message. Returns `{ done, step, total, beat: { key, summary } \| null }` |
| `POST /reset` | — | `{ ok, workspace_id, sandbox }`. Sample data goes back to the start. |
| `POST /leave` | — | `{ ok }`. Deletes the guest, its data and the cookie. |
| `POST /events` | `{ type: "tour_step"\|"tour_skip"\|"action", step?, action? }` | `{ ok }`. Feeds Admin › Sandbox. Events contain no personal data. |

### Locked actions

While the session belongs to a guest, `SandboxLockMiddleware` answers these requests with:

```
403 { detail, code: "sandbox_locked", action }
```

| `action` | Requests |
|---|---|
| `connect` | `sources/connect`, `sources/add`, add/reconnect/disconnect threads, onboarding, v1 `/connect*` |
| `note` | `POST notes` |
| `upload` | `POST`/`DELETE` files |
| `invite` | `members/invite` |
| `send` | `threads/:id/send`, `messages`, the demo's `send-email` |
| `workspace` | create, delete, archive, leave or export a workspace |
| `billing` | `v2/billing/*`, `payments/*` |
| `account` | delete account, account settings, password changes |

Reading, accepting or dismissing changes, Ask, drafting replies, the timeline and restore all stay open.

The frontend's axios interceptor (`src/lib/api.js`) turns this 403 into the "start a free trial" prompt. It also silences the caller's own error toast.

### Tour

The tour has 5 steps, defined in `TOUR` in `sandbox/sandbox.jsx`:

1. **Needs your attention:** `data-tour="attention"`
2. **Review a change:** `data-tour="proposals"`
3. **Ask Bracket:** `data-tour="ask-answer"`
4. **Play a client message:** `data-tour="sandbox-play"`
5. **What you pay for:** the `/w/:id/sandbox` page

The step is stored in `sessionStorage` under `bk.sandbox.tour`.

---

## Admin panel: `/api/v2/admin`

Only the owner can use the admin panel. It is separate from product accounts.

### Configuration

Credentials are set on the server only:

| Env var | Meaning |
|---|---|
| `ADMIN_USERNAME` | The username |
| `ADMIN_PASSWORD_HASH` | A bcrypt hash of the password. Generate it with `python backend/scripts/admin_hash.py`, which reads the password without echoing it. |
| `ADMIN_COOKIE_SECURE=1` | Optional. Forces the `Secure` cookie flag behind a TLS-terminating proxy. |
| `ADMIN_FX_INR_PER_USD` | Optional. Exchange rate for converted totals. Default `83`. |

If `ADMIN_USERNAME` or `ADMIN_PASSWORD_HASH` is missing, every sign-in fails (fail closed). The username check is constant-time, and a bcrypt verify runs even when the username is wrong.

### Session

- **Cookie:** the session lives in the `bk_admin` cookie, which is `HttpOnly`, `SameSite=Strict` and limited to `Path=/api/v2/admin`. Only a SHA-256 of the token is stored, in `admin_sessions`.
- **Expiry:** the session ends after **30 minutes** without activity. Every call pushes the expiry back.
- **Ended session:** any call made without a live session returns `401 { code: "admin_session" }`.
- **Lockout:** **5** wrong attempts from one IP pause sign-in for **15 minutes**, returning `429 { code: "admin_paused", retry_at }`. Attempts are counted in `admin_login_attempts`.
- **Audit log:** every sign-in, failed attempt, sign-out, trial extension and suspension is written to `admin_audit`.
- **Privacy:** responses never include message, email or note content, only counts and metadata.

### Endpoints

| Method & path | Notes |
|---|---|
| `POST /login` `{ username, password }` | `200 { ok, username, expires_at }` plus the cookie, or `401 { code: "admin_credentials", attempts_left }`, or `429` |
| `GET /session` | `{ username, expires_at, minutes }` |
| `POST /logout` | Clears the session |
| `GET /overview?range=30&currency=usd\|inr` | KPIs: signups, DAU/WAU/MAU, MRR, trial→paid, paying customers, churn, workspaces, failed payments. Also signups per day, the funnel (sandbox → paid), sources by provider, health, and latest signups. |
| `GET /users?q&status&sort&page&size&export` | `status`: `all`, `trial`, `paying`, `past_due`, `canceled`, `expired` or `suspended`. `sort`: `last_active`, `signed_up`, `projects` or `name`. `export=1` returns up to 5,000 rows. |
| `GET /users/:id` | Profile, billing, workspaces (counts only), sources and their health, 30-day activity, usage, and the admin actions taken on this user |
| `POST /users/:id/extend-trial` `{ days: 7\|14, reason, notify }` | Trial or expired-trial accounts only. A reason is required. |
| `POST /users/:id/suspend` `{ reason }` | Signs the user out everywhere and blocks sign-in (`auth.current_user_optional`). Nothing is deleted. |
| `POST /users/:id/unsuspend` | Restores access |
| `GET /revenue?range&currency` | MRR, INR, ARPA, per-project purchases, MRR for the last 12 months split USD/INR, plan mix, average tenure, failed payments |
| `GET /usage?range` | Review acceptance, Ask, replies, sync failures, sources by provider, feature use, table of sync failures |
| `GET /sandbox?range` | Sandbox sessions, tour completion, sandbox → signup, median time, drop-off by step, locked actions tapped, most-used actions |
| `GET /audit` | The latest 100 audit entries |

### Local testing

The mock's test credentials are in `mock/seed-admin.js`, which is local only. Set `MOCK_ADMIN_USERNAME` and `MOCK_ADMIN_PASSWORD_HASH` (scrypt) to try your own values.
