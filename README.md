# Bracket 2.0

A memory for your business. Bracket connects email, Slack and notes, remembers
what was agreed, notices when it changes, and helps you respond with the right
context — with a source for every claim.

This repo pairs the **Bracket 2.0 frontend** (new UI, built from the Figma file
*Bracket 2.0 — Product Design*) with the **backend from bracket-v1.9**, carried
over unchanged.

## Structure

```
backend/            FastAPI + MongoDB (unchanged from v1.9)
frontend/           React 19 · Create React App (CRACO) · Tailwind · Radix · Lucide
  src/v2/           Bracket 2.0 UI
    ui/             Design-system components (Button, Badge, Dialog, Sheet, …)
    shell/          App shell: sidebar, top bar, mobile tab bar, ⌘K, ⌘J Ask, notifications
    features/       Connect flow (OAuth → choose sources → preview → establish), Ask
    pages/          Marketing, auth & onboarding, workspace screens, settings
    lib/            Data hooks, workspace context, digest parser, media queries
  src/pages, src/components
                    Carried over from v1.9 and restyled through shared tokens:
                    admin console, public client review (/r/:token), legacy brief flow
tests/, scripts/    From v1.9
```

## Screens → API

| Screen | Route | Backend |
|---|---|---|
| Overview | `/w/:id` | `GET /projects/:id`, `/memory`, `/connections`, `/history`, `POST /seen` |
| Review changes | `/w/:id/review` | `POST /update/build`, `/update/:u/approve`, `/reject`, `/undo` |
| Memory | `/w/:id/memory` | `GET /memory`, `POST/PATCH/DELETE /connect/memory/:m`, `/action`, `/suggest-reply`, `POST /projects/:id/memory` |
| Conversations | `/w/:id/conversations` | `/connections/:c/content`, `/suggest-reply`, `/send-targets`, `/send-email`, `/send-slack` |
| Ask Bracket (page + ⌘J) | `/w/:id/ask` | `POST /projects/:id/ask`, `POST /ask/all` |
| Timeline | `/w/:id/timeline` | `GET /projects/:id/history` |
| Sources & files | `/w/:id/sources` | `/connect/providers`, `/connect/:p/auth-url`, `/sources`, `/preview`, `/establish`, `/connections/:c/sync`, `DELETE /connect/connections/:c`, `POST /ingest-notes` |
| New workspace / first run | `/connect`, `/welcome` | connect flow (mode `new`), `GET /project-quota`, `POST /demo/open` |
| Demo workspace | in-app bar | `POST /demo/simulate/next`, `/demo/reset`, `/demo/send-email`, `/demo/client-reply` |
| Notifications | top bar | `GET /notifications`, `POST /notifications/read` |
| Sign in / sign up | `/login`, `/signup` | Google (`/auth/google/native/start`), email code (`/auth/otp/*`), password (`/auth/login`) |
| Onboarding, claim | `/onboarding`, `/claim` | `PATCH /auth/me`, `/auth/password/set`, `/auth/claimable`, `/auth/claim` |
| Plan & payment | `/plan`, `/payment/*` | Razorpay (`/payments/razorpay/order`, `/verify`), `/payments/ph-activate` |
| Settings | `/settings/:section` | profile, password, billing (`/payments/billing`, `/cancel`), workspaces (rename/archive/unarchive/delete), push |
| Admin | `/admin` | v1.9 admin console (unchanged) |

Old links keep working: `/project/:id` → `/w/:id`, `/app/connect` → `/connect`.

## Run locally

**Backend** (Python 3.11, MongoDB):

```bash
cd backend
pip install -r requirements.txt
uvicorn server:app --reload --port 8001
```

Environment (`backend/.env`, never committed): `MONGO_URL`, `DB_NAME`, `CORS_ORIGINS`,
`PUBLIC_BASE_URL`, `JWT_SECRET`, `CONNECT_TOKEN_KEY`, `EMERGENT_LLM_KEY`,
`GOOGLE_OAUTH_CLIENT_ID/SECRET`, `SLACK_/FIGMA_/GITHUB_/NOTION_CLIENT_ID/SECRET`,
`RAZORPAY_KEY_ID/SECRET/WEBHOOK_SECRET`, `RESEND_API_KEY`, `SENDER_EMAIL`, `SENDER_NAME`,
`VAPID_PUBLIC_KEY/PRIVATE_KEY/CLAIMS_SUB`, `ADMIN_EMAILS`, `BRACKET_ENV`, `OTP_TEST_MODE`.
See `OAUTH_SETUP.md` for provider setup.

**Frontend** (Node 18+):

```bash
cd frontend
npm install --legacy-peer-deps
npm start            # dev server; set REACT_APP_BACKEND_URL or proxy /api to the backend
npm run build        # production build
```

The frontend calls `${window.location.origin}/api`, so serve it on the same origin
as the backend (or proxy `/api`).

## Design system

Tokens come straight from the Figma variables (`frontend/tailwind.config.js`,
`frontend/src/index.css`): monochrome near-black surfaces, hairline borders,
semantic status colours only, Urbanist + JetBrains Mono, 4px spacing grid,
motion 120 / 200 / 280 ms. Breakpoints: 390 · 768 · 1024 · 1280 · 1440.

Accessibility: visible focus on every control, 3:1 control borders, 4.5:1 text,
44px touch targets on mobile, Radix dialogs/menus with focus trapping, status
never colour-only, `prefers-reduced-motion` respected.
