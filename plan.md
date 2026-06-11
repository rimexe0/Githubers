# GitHub Project Board Change Watcher Plan

## Goal

Build a self-hosted TypeScript watcher and dashboard that tracks changes across multiple GitHub Projects v2 boards, linked private issues, PRs, and comments. It stores history in Postgres, summarizes changes with a configurable provider, and sends optional email/Telegram notifications.

## Confirmed Decisions

- Deployment: Docker Compose on LAN/Tailscale-accessible machine.
- Primary capture: hourly polling plus manual sync.
- Optional capture: GitHub webhooks can be enabled later.
- Database: Postgres for multiple project boards.
- Project scope: both org and user Projects v2.
- Repositories: private repos supported.
- Stack: full TypeScript.
- App framework: Next.js with App Router, TypeScript, and API route handlers.
- Dashboard: React and Radix UI primitives inside Next.js.
- Dashboard auth: none for now; intended for LAN/Tailscale only.
- Project configuration: managed from dashboard.
- Summary schedule: daily and manual.
- Poll schedule: hourly and manual.
- Summary provider: configurable from dashboard.
- Summary style: configurable from dashboard.
- Local LLM: LM Studio through OpenAI-compatible API.
- Fallback summarizers: Codex CLI and OpenCode CLI command adapters.
- Notifications: full email summary and concise Telegram situation summary.

## Architecture

```text
GitHub GraphQL/API
  -> hourly/manual poller
  -> diff engine
  -> Postgres history
  -> summarizer providers
  -> dashboard + notifications
```

Optional webhook path:

```text
GitHub webhooks
  -> webhook receiver
  -> normalized changes
  -> Postgres history
```

## Major Components

1. Next.js app
   - App Router dashboard.
   - API route handlers for settings, projects, sync, summaries, notifications, and optional webhooks.
   - Scheduler initialized inside the self-hosted Next.js server process.
   - GitHub client.
   - Postgres migration runner.

2. Dashboard
   - Radix-based React UI.
   - Project management.
   - Settings management.
   - Recent changes feed.
   - Sync run history.
   - Summary generation and history.
   - Notification settings/tests.

3. Database
   - Settings.
   - GitHub projects.
   - Linked repositories.
   - Project item snapshots.
   - Issue/PR snapshots.
   - Comments.
   - Normalized changes.
   - Sync runs.
   - Summary runs and summaries.
   - Notification deliveries.

4. Summarizers
   - LM Studio OpenAI-compatible API.
   - Codex command provider.
   - OpenCode command provider.
   - None/raw digest fallback.

5. Notifications
   - SMTP email, including Gmail app-password setup.
   - Telegram bot token/chat ID.

## Build Phases

### Phase 1: Foundation

- Create Dockerfile, docker-compose, env example.
- Add Next.js TypeScript build setup.
- Add Postgres migration runner and schema.
- Add dashboard shell with Radix UI.

### Phase 2: Configuration UI

- Store GitHub token and runtime settings.
- Add/edit/delete projects.
- Add/edit/delete linked repositories.
- Configure summarizer provider order.
- Configure LM Studio, Codex, OpenCode.
- Configure summary style and schedule.
- Configure SMTP and Telegram.

### Phase 3: Polling and Change Capture

- Fetch user/org Projects v2 data.
- Fetch linked issue/PR state and comments.
- Snapshot current state.
- Diff snapshots into normalized changes.
- Add manual sync.
- Add hourly scheduler.

### Phase 4: Summaries and Notifications

- Generate daily summaries.
- Generate manual summaries.
- Try provider order from settings.
- Store provider/fallback results.
- Send email full summary.
- Send concise Telegram summary.

### Phase 5: Optional Webhooks and Hardening

- Add webhook endpoint and signature validation.
- Normalize webhook payloads.
- Add health checks.
- Add richer dashboard diagnostics.
- Add backup/restore docs.

## Verification Targets

- `npm run typecheck`
- `npm run build`
- `docker compose config`
- App starts with Postgres using `docker compose up`.
- Dashboard can save settings and add projects.
- Manual sync creates a sync run.
- Manual summary creates a summary run.
