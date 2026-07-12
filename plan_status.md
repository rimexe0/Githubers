# Plan Status

## Current Status

Core local/Tailscale watcher implementation is in place and builds successfully.

## Progress

| Area | Status | Notes |
| --- | --- | --- |
| Planning docs | Complete | `plan.md` and this status tracker created and updated for Next.js. |
| Docker Compose | Complete | Root Compose runs app and Postgres; config validates. |
| TypeScript setup | Complete | Created with `npx create-next-app@latest` in `app/`. |
| Database schema | Complete for core | Initial Postgres schema covers settings, projects, repos, snapshots, comments, changes, summaries, and notification deliveries. |
| Backend API | Complete for core | Settings, projects, sync, changes, summaries, notification tests, health checks, and webhook route added. |
| Dashboard | Complete for core | Radix dashboard supports project add/edit/delete, settings management, manual sync, manual summary, full summary viewing, notification tests, and provider health tests. |
| GitHub polling | Complete for core | Projects v2 GraphQL polling, item diffing, issue/PR metadata snapshots, and configurable latest-comment diffing added. |
| Summarizers | Complete for core | LM Studio, Codex, OpenCode, and none providers added with UI-configurable order. |
| Notifications | Complete for core | Generated summaries deliver full email and concise Telegram messages when configured. |
| Docs | In progress | README quick start, LM Studio, Gmail, Telegram, webhook, and verification notes added. |
| AgentAutomator integration | Complete for current daemon contract | Repository reads with GraphQL fallback, authoritative project policy, Briefing, read-only PR review, preview-token remote actions, complete rules lifecycle, structured monitor events, and correlated RPC added. |

## Next Steps

1. Add optional historical comment backfill if latest-comment polling is not enough.
2. Add filters/search for changes and summaries.
3. Add per-project sync buttons and per-project last-sync status.
4. Add dashboard auth if the app ever leaves LAN/Tailscale.
5. Add end-to-end tests with mocked GitHub GraphQL payloads.

## Verification

- `npm run typecheck` passes in `app/`.
- `npm test` passes in `app/`.
- `npm run build` passes in `app/`.
- `docker compose config` passes at repo root.
- Full `react-doctor` scan passes at 100/100.
- Local Docker setup was verified: app and Postgres run, migration applies, dashboard and `/api/health` respond.

## Setup Notes

- Added `app/.dockerignore` after Docker initially sent a huge build context.
- Production image now uses standalone Next output plus `migrate.mjs`, avoiding copying full `node_modules` into the runner image.
- Postgres host port mapping was removed because local port `5432` was already allocated; the app connects to Postgres through the Compose network.

## Decisions

- Postgres is the only supported DB target.
- Polling is primary because deployment is LAN/Tailscale-first.
- Dashboard configuration is preferred over YAML project configuration.
- No dashboard auth in the first implementation.
- LM Studio is the default recommended summarizer target.
- Next.js replaces the previously planned separate Express/Vite split.
