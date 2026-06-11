# Plan Status

## Current Status

Initial Next.js implementation is scaffolded and builds successfully.

## Progress

| Area | Status | Notes |
| --- | --- | --- |
| Planning docs | Complete | `plan.md` and this status tracker created and updated for Next.js. |
| Docker Compose | Complete | Root Compose runs app and Postgres; config validates. |
| TypeScript setup | Complete | Created with `npx create-next-app@latest` in `app/`. |
| Database schema | In progress | Initial Postgres migration added. |
| Backend API | In progress | Settings, projects, sync, changes, summaries, notification tests added. |
| Dashboard | In progress | Radix dashboard shell, forms, actions, feeds added. |
| GitHub polling | In progress | Projects v2 GraphQL polling and item snapshot diffing added. |
| Summarizers | In progress | LM Studio, Codex, OpenCode, none providers added. |
| Notifications | In progress | SMTP and Telegram test endpoints added. |
| Docs | In progress | README quick start added; deeper setup docs still needed. |

## Next Steps

1. Add richer issue/PR comment polling.
2. Wire daily summary notification delivery.
3. Add optional webhook receiver.
4. Add provider/status test endpoints for GitHub and LM Studio.
5. Expand setup docs for GitHub PAT permissions and deployment.

## Verification

- `npm run typecheck` passes in `app/`.
- `npm run build` passes in `app/`.
- `docker compose config` passes at repo root.
- `react-doctor` improved from 65/100 to 76/100 after accessibility/button/dependency fixes.
- Remaining `react-doctor` warnings are mostly intentional first-pass tradeoffs: sequential project sync, sequential provider fallback, and state that can be refactored later.

## Decisions

- Postgres is the only supported DB target.
- Polling is primary because deployment is LAN/Tailscale-first.
- Dashboard configuration is preferred over YAML project configuration.
- No dashboard auth in the first implementation.
- LM Studio is the default recommended summarizer target.
- Next.js replaces the previously planned separate Express/Vite split.
