# Githubers

AI Slop Self-hosted GitHub Projects v2 change watcher for LAN/Tailscale deployments.

## Stack

- Next.js App Router and TypeScript.
- Radix UI primitives.
- Postgres.
- Docker Compose.
- GitHub GraphQL polling.
- LM Studio OpenAI-compatible summaries, with Codex/OpenCode command fallbacks.
- SMTP email and Telegram notification settings.

## Quick Start

```bash
docker compose up --build
```

Open `http://localhost:3000`.

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

Use a fine-grained PAT or GitHub App that can read private repos, issues, pull requests, comments, and Projects v2 data for the configured owners/repositories.

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

## Tracking

See `plan.md` and `plan_status.md` for implementation status.
