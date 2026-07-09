# Githubers

AI Slop Self-hosted GitHub Projects v2 change watcher for LAN/Tailscale deployments.

## Stack

- Next.js App Router and TypeScript.
- Radix UI primitives.
- Postgres.
- Docker Compose.
- GitHub GraphQL polling.
- Optional GitHub webhook ingestion with signature validation.
- LM Studio OpenAI-compatible summaries, with Codex/OpenCode command fallbacks.
- SMTP email and Telegram notification settings.

## Quick Start

```bash
docker compose up --build
```

Open `http://localhost:3000`.

The Compose stack exposes only the dashboard on host port `3000`. Postgres stays internal to Docker to avoid conflicts with an existing local Postgres on port `5432`.

## Local Development

```bash
cd app
cp .env.example .env.local
npm install
npm run db:migrate
npm run dev
```

You need Postgres running and `DATABASE_URL` configured.

## GitHub Token

Use a classic PAT for GitHub Projects v2 polling. Fine-grained PATs can read private repos, issues, and pull requests, but they do not currently expose the Projects v2 read permission this app needs.

Configured projects are added and edited from the dashboard. The poller supports org and user Projects v2 and records board item changes, issue/PR metadata changes, and the latest issue/PR comments returned by GitHub. The comments-per-issue/PR polling limit is configurable in settings.

Classic PAT checklist:

- Required scopes: `read:project` and `repo`.
- `read:project` is needed for Projects v2 GraphQL access.
- `repo` is needed because your linked repositories are private.
- If using an organization with SSO, authorize the token for that org.
- Paste the token into the dashboard settings, then use `Test GitHub` before running sync.

Fine-grained PATs are not enough for this app until GitHub adds Projects v2 permissions to them. If you see `Resource not accessible by personal access token` when syncing a project, replace the token with a classic PAT that has `repo` + `read:project`.

GitHub App alternative:

- Install the app on the target org/user repositories.
- Grant read access to Projects, Issues, Pull requests, Metadata, and Discussions/comments where applicable.
- Use an installation token as the dashboard GitHub token.

## LM Studio

Use any OpenAI-compatible LM Studio endpoint.

Same machine as Docker:

```text
http://host.docker.internal:1234/v1
```

Server to PC over Tailscale:

```text
http://100.x.y.z:1234/v1
```

Configure provider order from the dashboard, for example:

```text
lmstudio,codex,opencode,none
```

## Gmail SMTP

Use a Gmail app password, not your normal account password. Typical settings:

```text
SMTP host: smtp.gmail.com
SMTP port: 587
SMTP user: your Gmail address
SMTP password: app password
```

## Telegram

Create a bot with BotFather, then paste the bot token and target chat ID in the dashboard.

## Webhooks

Webhooks are optional for LAN/Tailscale mode. If you expose the app to GitHub or tunnel it, configure this endpoint:

```text
POST /api/webhooks/github
```

Set the same webhook secret in the dashboard. Supported events are stored as normalized webhook changes, while polling remains the reconciliation source of truth.

## Health Checks

- `GET /api/health` checks the app database connection.
- Dashboard buttons test GitHub and LM Studio connections.

## Deployment Notes

- This app is designed for LAN/Tailscale. No dashboard auth is enabled by default.
- Keep Postgres volume backups if the history matters: `postgres-data` contains the reconstructed event history.
- Do not expose LM Studio publicly. If the app runs on a different server, point it at your PC's Tailscale IP.
- For Gmail SMTP, use an app password and keep 2FA enabled.

## Verification

Current verification commands:

```bash
cd app
npm run typecheck
npm run build
npx -y react-doctor@latest . --verbose
```

From the repo root:

```bash
docker compose config
```

End-to-end smoke test, with Githubers and AgentAutomator already running:

```bash
node tests/smoke.mjs --with-model
```

See `tests/README.md` for the daemon command and optional environment knobs.

## Useful Commands

```bash
docker compose ps
docker compose logs -f app
docker compose down
```

Health check:

```bash
curl http://localhost:3000/api/health
```

## Tracking

See `plan.md` and `plan_status.md` for implementation status.
