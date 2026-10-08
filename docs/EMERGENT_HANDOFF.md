# Bracket 2.0: backend handoff

## What this repo is

- **`frontend/`:** the finished Bracket 2.0 app, built to match the Figma file "Bracket 2.0 — Product Design".
- **`backend/`:** the **v1.9 FastAPI + MongoDB backend**, plus two new v2 modules, `admin_v2.py` and `sandbox_v2.py`.
- **`mock/`:** a Node mock API that implements **every endpoint the new frontend calls**. During development the frontend ran entirely against it.

**The job is to make the real backend answer the same requests the mock answers, with the same response shapes, reusing the v1.9 code wherever it already does the work.** Once that's done, the frontend needs no changes.

---

## 1. Sources of truth

| What | Where |
|---|---|
| Every v2 route, its request body and its response shape | `mock/server.js`. Each `on("METHOD", "/path", handler)` is one endpoint, and the handler's return value is the exact JSON the UI expects. |
| What each field looks like (realistic data) | `mock/seed.js`: workspaces, memory, reviews, attention, threads, sources, files, members, billing, notifications |
| Which frontend function calls which endpoint | `frontend/src/v2/lib/api2.js` (one function per endpoint) |
| Sandbox and admin contracts (already built in the backend) | `docs/API_V2.md` |
| Edge-case states the UI handles | `SCENARIOS` + `applyScenario()` in `mock/server.js` (trial, trial ended, payment failed, canceled, archived, viewer, plan limit, first sync, …) |
| Product decisions | §6 below |

Errors use the shape `{ detail: "Human sentence", code?: "machine_code", ...extra }`. The UI shows `detail` as-is, so it should be a sentence written for the user.

---

## 2. Running the frontend against the real backend

```bash
# backend
cd backend && uvicorn server:app --port 8001
# frontend (dev): the proxy defaults to the mock; point it at FastAPI instead
cd frontend && API_PROXY=http://localhost:8001 npm start
```

In production the frontend calls `/api/...` on its own origin (`src/lib/api.js`), so serve both behind one domain or set up a reverse proxy.

`/api/__mock/*` is a mock-only control endpoint. **Do not implement it.**

---

## 3. Endpoint checklist

Status key:
- ✅ **exists**: already in the backend.
- 🔁 **adapt**: v1.9 has the logic under another path or shape; wrap it.
- 🆕 **new**: needs building.

`:wid` is a workspace, which is a v1.9 `projects` document (`id`).

### Auth & account

| Endpoint | Status | Reuse / notes |
|---|---|---|
| `GET/PATCH /api/auth/me`, `POST /api/auth/login`, `/logout`, `/otp/request`, `/otp/verify`, `/password/set`, `GET /api/auth/claimable`, `GET /api/auth/google/native/start`, `POST /api/auth/google/exchange` | ✅ | `server.py` + `auth.py` |
| `POST /api/v2/auth/password/forgot`, `/reset` | 🆕 | Reuse the OTP + email helpers in `auth.py` / `emailer.py`. Reset link valid 1 h. An expired link returns `410`. |
| `GET /api/v2/me/sessions`, `POST /api/v2/me/sessions/sign-out-others` | 🆕 | Read `user_sessions`. Store device/location when a session is created. |
| `GET/PATCH /api/v2/me/notifications` | 🆕 | Per-user prefs doc (shape: `notifications` in `mock/seed.js`) |
| `POST /api/v2/me/export` | 🆕 | Queue an export and email the link |
| `DELETE /api/v2/me` `{confirm:"DELETE"}` | 🆕 | Schedule deletion **30 days** out and return `deletes_on`. Reuse `admin_delete_users` erase logic for the final purge. |
| `GET /api/v2/invites/:token`, `POST …/accept` | 🔁 | v1.9 `share` tokens are the closest pattern. Invites need a new `invites` collection. |
| `POST /api/v2/contact` | 🆕 | Email `support@use-bracket.com` via `emailer.py` |

### Billing

| Endpoint | Status | Reuse / notes |
|---|---|---|
| `GET /api/v2/billing` | 🔁 | `GET /api/payments/billing` + `PLANS`. The v2 shape adds `status` (`trialing\|active\|past_due\|canceled\|expired`), `trial_ends_at`, `card`, `invoices`, `workspaces:{used,limit}`, `retry`. |
| `POST /api/v2/billing/checkout` | 🔁 | `/api/payments/razorpay/order` + `/verify` + `webhook/razorpay` |
| `PATCH /api/v2/billing` (currency), `POST …/change`, `/cancel`, `/resume`, `/retry` | 🔁/🆕 | Cancel exists (`/payments/cancel`); the rest are new |

### Workspaces

| Endpoint | Status | Reuse / notes |
|---|---|---|
| `GET/POST /api/v2/workspaces` | 🔁 | `GET/POST /api/projects`, `project-quota` |
| `GET/PATCH /api/v2/w/:wid` | 🔁 | `GET/PATCH /api/projects/{id}` |
| `POST …/archive`, `/unarchive` | ✅→🔁 | `/projects/{id}/archive`, `/unarchive` |
| `POST …/delete` `{confirm: name}`, `/restore` | 🆕 | Soft delete with `deletion_at` 30 days out |
| `POST …/leave`, `/export`, `/seen` | 🔁 | `seen` exists at `/projects/{id}/seen` |
| `GET/PATCH …/settings` | 🆕 | Per-workspace prefs |
| `GET/POST/PATCH/DELETE …/members…`, `/members/invite`, `/:mid/resend`, `/:mid/commitments` | 🆕 | Roles `owner\|editor\|viewer`. Viewers are read-only, enforced server-side (mock: `guardWrite`). |

### Overview, attention, review

| Endpoint | Status | Reuse / notes |
|---|---|---|
| `GET …/overview` | 🔁 | Compose from `project_memory`, `source_events`, `project_updates`. Shape: mock lines ~222–240. |
| `GET …/attention`, `POST …/attention/:aid/snooze\|save\|restore\|dismiss` | 🆕 | Items derived from pending changes, conflicts and waiting-on commitments. Store snooze/save state per user. |
| `GET …/reviews`, `GET …/reviews/:rid` | 🔁 | v1.9 `project_updates` (`/projects/{id}/update/build`) and memory with status `detected`/`review` |
| `POST …/reviews/:rid/accept {selected, edits}`, `/undo`, `/dismiss {reason,note}`, `/save` | 🔁 | `/update/{id}/approve`, `/reject`, `/undo`, `connect/memory/{id}/action`. Accepting must keep previous versions (timeline restore needs them). |
| `GET/POST …/conflicts/:cid(/resolve)` | 🆕 | 4 options: `split`, `move`, `drop`, `ask`. See `conflicts` in the seed. |

### Memory & people

| Endpoint | Status | Reuse / notes |
|---|---|---|
| `GET …/categories`, `PATCH …/categories/:key`, `POST …/categories/suggest` | 🔁 | Count `project_memory` by category |
| `GET/POST …/memory`, `GET/PATCH …/memory/:mid`, `POST …/:mid/incorrect`, `/:mid/restore` | 🔁 | `/projects/{id}/memory`, `connect/memory/{id}` (PATCH/DELETE/action) |
| `GET …/evidence/:eid` | 🆕 | Source quote and location for one memory evidence item |
| `GET …/people`, `GET …/people/:pid` | 🆕 | Derive from message authors and commitments |
| `GET …/search?q=` | 🆕 | Memory, people and conversations (⌘K) |

### Conversations & Ask

| Endpoint | Status | Reuse / notes |
|---|---|---|
| `GET …/threads`, `GET …/threads/:tid` | 🔁 | `source_connections` content + `source_events` |
| `POST …/threads/:tid/draft` | 🔁 | `/projects/{id}/suggest-reply`, `connect/memory/{id}/suggest-reply` |
| `POST …/threads/:tid/send`, `POST …/messages` | 🔁 | `/projects/{id}/send-email`, `/send-slack`. **Never send without the user's explicit click.** |
| `GET …/message-templates` | 🆕 | Static list is fine |
| `POST …/ask`, `GET …/ask/:qid`, `GET …/ask/history`, `POST …/ask/:qid/feedback` | 🔁 | `/projects/{id}/ask`, `/ask/all`. Store each Q&A for history. Answers need `sources[]` and `confidence` (`high\|medium\|low`). |

### Timeline

| Endpoint | Status | Reuse / notes |
|---|---|---|
| `GET …/timeline`, `GET …/timeline/:eid` | 🔁 | `/projects/{id}/history`, `/activity` |
| `POST …/timeline/:eid/restore`, `/undo-restore`, `POST …/timeline/export` | 🆕 | Needs the version history kept on accept |

### Sources & files

| Endpoint | Status | Reuse / notes |
|---|---|---|
| `GET …/sources`, `GET/PATCH …/sources/:sid` | 🔁 | `/projects/{id}/connections`, `connect/connections` |
| `POST …/sources/connect {provider}` → `{url}` | 🔁 | `connect/{provider}/auth-url` + `/callback` |
| `GET …/sources/candidates/:provider`, `POST …/sources/add` | 🔁 | `connect/{provider}/sources`, `connect/establish` |
| `POST …/sources/:sid/sync\|pause\|resume\|reconnect\|reconnected\|disconnect\|undo-disconnect` | 🔁 | `connect/connections/{id}/sync`, `DELETE connect/connections/{id}`. Disconnect asks whether to keep learned memory (`keep_memory`). |
| `GET …/sources/:sid/candidates`, `POST …/sources/:sid/threads`, `DELETE …/threads/:tid`, `GET …/items/:tid/impact` | 🆕 | Choose or stop reading individual threads and channels |
| `POST …/notes` | 🔁 | `/projects/{id}/ingest-notes`, `/projects/{id}/notes` |
| `GET/POST …/files`, `GET/DELETE …/files/:fid`, `POST …/files/:fid/replace` | 🆕 | Upload → parse → memory. Status `reading` → `in_memory` / `failed`, with `progress`. |

### Onboarding

| Endpoint | Status | Reuse / notes |
|---|---|---|
| `POST …/onboarding/connect`, `GET …/onboarding`, `POST …/onboarding/start`, `GET …/onboarding/progress`, `POST …/onboarding/finish` | 🔁 | `connect/preview`, `connect/establish` + first-sync progress |

### Notifications

| Endpoint | Status | Reuse / notes |
|---|---|---|
| `GET /api/v2/updates`, `POST /api/v2/updates/read` | 🔁 | `/notifications`, `/notifications/read` |

### Sandbox & admin: already built

`/api/v2/sandbox/*` and `/api/v2/admin/*` are in `backend/sandbox_v2.py` and `backend/admin_v2.py`, documented in `docs/API_V2.md`, with 20 tests in `backend/tests/test_admin_sandbox_v2.py`.

Remaining work for these two:
- **Sandbox sample project:** `demo.py` seeds the v1.9 "Harbor" project. The v2 tour expects the **Acme Finance** story: reviews `r1`–`r4`, attention items and threads. Port the seed (`mock/seed.js`) and the 5 scripted beats (`BEATS` in `mock/sandbox.js`) so `POST /api/v2/sandbox/next` produces them.
- **Admin metrics:** they read v2 fields once billing writes them: `plan_status`, `trial_ends_at`, `canceled_at`, `retry`, `suspended`. Ask and reply volume read `source_events` kinds `ask`, `email_sent` and `reply_sent`. Log those events and the numbers fill in.
- **Trial-extended email:** `admin_v2.extend_trial` calls an optional `emailer.send_trial_extended(email, name, ends_iso)`. Add that template.

---

## 4. Environment

| Variable | Purpose |
|---|---|
| `MONGO_URL`, `DB_NAME`, `CONNECT_TOKEN_KEY`, … | Existing v1.9 settings |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH` | Admin panel sign-in. Hash with `python backend/scripts/admin_hash.py`. **Never commit these.** |
| `ADMIN_COOKIE_SECURE=1` | Set when TLS terminates at a proxy |

---

## 5. Rules the UI relies on

- **Read-only states:** read-only workspaces (trial ended, archived, viewer role, deletion scheduled) answer writes with `403 { code: <reason> }`. Mock: `readOnlyReason()`.
- **Review before memory changes:** nothing changes memory without the user's accept. Proposed changes stay proposals until `accept`.
- **Sources for answers:** every memory item and every Ask answer carries its sources (evidence).
- **No silent sending:** Bracket never sends a message on its own.
- **Expired sessions:** `401 { code: "session_expired" }` triggers the "session expired" sheet.

## 6. Product decisions (already reflected in the UI)

- **Plans:**
  - **Monthly:** $12 / ₹999, up to 10 active projects.
  - **Per project:** $2 / ₹199, one project for 60 days.
  - **Trial:** 14 days, no card.
  - **Indian prices:** include GST.
- **Failed payments:** retried 3 times over 7 days, then a 7-day grace period, then read-only. Nothing is deleted.
- **Deletion window:** accounts and workspaces are deleted 30 days after the request.
- **Data:** never used to train general AI models. Support address: support@use-bracket.com.
