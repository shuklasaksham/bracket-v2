# Connect Work — OAuth App Setup (Admin Guide)

End users get one-click "Sign in with X" connections. For each provider you
(the admin) register ONE OAuth app and put its credentials in `backend/.env`.
The provider card lights up automatically — no user-side setup, ever.

Redirect URI for every provider (replace with your domain):
`{PUBLIC_BASE_URL}/api/connect/{provider}/callback`

Production: `https://use-bracket.com/api/connect/figma/callback` etc.
(Preview uses the preview URL — register both if you want to test in preview.)

---

## Figma  (~5 min)
1. https://www.figma.com/developers/apps → "Create a new app"
2. Add redirect URI: `https://use-bracket.com/api/connect/figma/callback`
3. Copy Client ID + Client Secret →
```
FIGMA_CLIENT_ID=...
FIGMA_CLIENT_SECRET=...
```
Scope used: `file_read` (read-only).

## Gmail (Google)  (~10 min)
1. https://console.cloud.google.com → create project → "APIs & Services"
2. Enable the **Gmail API** (Library → Gmail API → Enable)
3. OAuth consent screen: External, add scope `gmail.readonly`, add yourself as test user (or publish + verify later)
4. Credentials → Create OAuth client ID → Web application → redirect URI:
   `https://use-bracket.com/api/connect/gmail/callback`
```
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
```

## Slack  (~5 min)
1. https://api.slack.com/apps → "Create New App" → From scratch
2. OAuth & Permissions → Redirect URLs: `https://use-bracket.com/api/connect/slack/callback`
3. **User Token Scopes** (not bot): `channels:read, channels:history, groups:read, groups:history, im:read, im:history, mpim:read, mpim:history, users:read`
4. Basic Information → App Credentials →
```
SLACK_CLIENT_ID=...
SLACK_CLIENT_SECRET=...
```

## GitHub  (~3 min)
1. https://github.com/settings/developers → OAuth Apps → New OAuth App
2. Authorization callback URL: `https://use-bracket.com/api/connect/github/callback`
```
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
```

## Notion  (~5 min)
1. https://www.notion.so/profile/integrations → New integration → type **Public**
2. Redirect URI: `https://use-bracket.com/api/connect/notion/callback`
3. Capabilities: Read content only
```
NOTION_CLIENT_ID=...
NOTION_CLIENT_SECRET=...
```
(Users pick which pages to share during Notion's own authorization screen.)

---

After adding keys: `sudo supervisorctl restart backend` (preview) or redeploy (production).
Cards flip from "SETUP REQUIRED" to "CONNECT" automatically.
