# Handoff — Githubers ↔ AgentAutomator repo chat

Context handoff for a fresh chat. Read the auto-memory index first (it has the
durable facts); this file adds the immediate open tasks + exact repro.

## The two repos
- **Githubers** `/Users/rime/code/personal/Githubers` — Next.js 16 + React 19 + Postgres, runs in Docker Compose (app on **:3000**). The app lives in `app/`. Branch: `frontend-redesign`. Dev outside Docker uses :3100 (3000 is Docker). App code changes require `docker compose up -d --build` (Dockerfile builds at image time; it also runs DB migrations on start).
- **AgentAutomator** `/Users/rime/code/personal/AgentAutomator` — the "brain" daemon (Bun). Runs on the **host** at `127.0.0.1:3001`, reachable from the Docker app at `http://host.docker.internal:3001/api/v1`. Started manually (NOT auto): `AUTOMATOR_TOKEN=<tok> bun run index.ts serve --port 3001`. Changes uncommitted on: `src/agent-runner.ts`, `src/config.ts`, `src/server.ts`.
- **Auth:** `Authorization: Bearer <AUTOMATOR_TOKEN>`. The token is `settings.automatorToken` in the Githubers Postgres (currently a 4-char secret). Read it: `docker compose exec -T postgres psql -U githubers -d githubers -t -A -c "SELECT value #>> '{}' FROM settings WHERE key='automatorToken';"`

## Runtime state right now
- Daemon is running (I started it in the background). If it's gone, restart with the command above using the token from the DB.
- Mapped repos (in `settings.automatorRepoPaths`, `owner/repo=/local/path` per line): `jackrussell-team/e-fatura_backend`, `jackrussell-team/finvest`, `jackrussell-team/jackrussel-Frontend`. Trigger columns intentionally empty (no autonomous runs auto-fire).
- **The free OpenCode models are rate-limited** from heavy testing; they hang on new requests until they cool down. Paid models (`openai/gpt-5.5-fast`, etc.) are in the dropdown; the user prefers to run live tests themselves and NOT burn paid/free calls for self-verification (see memory `testing-preference`).

## What's already built (working, tsc/lint/build clean)
Repo chat = Githubers UI → daemon → OpenCode `plan` agent (read-only) in the repo dir. Same execution substrate as autonomous runs.

**Daemon (`src/server.ts`, `src/config.ts`, `src/agent-runner.ts`):**
- `POST /api/v1/chat` — non-streaming: runs `opencode-plan` profile, returns `{reply, thinking, profile}`.
- `POST /api/v1/chat/stream` — NDJSON stream of `{type:"reasoning"|"tool"|"text"|"done"|"error"}` via `ReadableStream` + `runAgentProfile` `onOutput`. Guarded against client-disconnect crash with a shared `closed` flag (Bun throws "Controller is already closed" and crashes the daemon otherwise). `idleTimeout: 255` set on `Bun.serve` (default 10s killed streams).
- `GET /api/v1/models` — runs `opencode models`, flags free (id contains "free").
- `opencode-plan` profile: `opencode run --format json --thinking --agent plan --variant low --dir {cwd} {prompt}`. `--thinking` makes reasoning parts appear. Read-only verified (plan agent refuses writes).
- `parseChatOutput`/`lineToChatEvent` map OpenCode JSONL parts → text (answer) / reasoning (thoughts) / tool (file ops via `state.title`). `withModel()` in agent-runner overrides `--model`.

**Githubers app:**
- Settings → "Agent automator": enable, base URL, token, repo→path map, trigger columns. (`lib/schemas.ts`, `dashboard/SettingsForm.tsx`)
- Chat tab `dashboard/RepoChat.tsx`: conversation rail, model dropdown (free grouped), streaming render, collapsible `ThinkingBlock` (auto-opens while streaming). Responsive: rail hidden on mobile behind a history toggle; header wraps.
- Persistence: `chat_conversations` + `chat_messages` (migration `004_chat.sql`), `server/chat.ts`, routes `/api/chat`, `/api/chat/[id]`, `/api/chat/[id]/messages` (streaming relay: forwards NDJSON, persists reply on `done`).
- Proxies: `/api/automator/chat` (repos+enabled), `/api/automator/models`. Plus prior Agent-Runs feature (`/api/automator/runs*`, `AgentRuns.tsx`).

## OPEN TASKS (what the user just asked for)

### 1. Show rate limits / errors in the UI (currently infinite loading) — HIGH PRIORITY
**Repro:** pick a free model, send a message → UI stuck in loading forever.
**Root cause:** OpenCode retries the free-tier limit *internally* (OpenCode desktop shows "free limit reached" then retries), so the process never exits → the daemon's `runAgentProfile` never resolves → `/chat/stream` never emits `done` → the UI's assistant placeholder stays "working…" forever. Also the daemon's streaming `onOutput` **ignores stderr** (`if (streamName !== "stdout") return` in `src/server.ts` ~line 468), and the "free limit reached" notice likely arrives on stderr / as a non-JSON line, so it's never surfaced.
**Fix plan (daemon):**
- In `handleChatStream`, also inspect **stderr** chunks (and non-JSON stdout lines) for rate-limit/auth patterns. Extend `rate_limit.patterns` in `config.ts` to include `"free limit"`, `"limit reached"`, `"retry"`.
- On detection mid-stream: emit `{type:"error", message:"Free model rate limit reached — pick another model"}` then `{type:"done", ...}` and **terminate the OpenCode process** so it stops retrying. Capture the pid via `runAgentProfile`'s `onStart` (add it to the streaming call; `terminateProcess(pid, pgid)` exists in `process-runner.ts`). May need to thread pid out of `runAgentProfile` (it currently only passes onStart to store).
- Consider a hard max-duration guard on the stream as a backstop.
**Fix plan (UI, `RepoChat.tsx`):**
- Render `error` events prominently (banner is there; also stop the "working…" placeholder — mark the streaming message failed).
- Add a client-side inactivity timeout (e.g. no event for ~90s → show "the model may be rate-limited or slow; try another model" + a Cancel/Stop button that aborts the fetch).
- Ideally show a small rate-limit indicator when a free model is selected.

### 2. Persist the thinking blocks — the user wants them kept
Currently `thinking` is transient (streamed, not stored) — it disappears when a saved conversation is reloaded.
**Fix plan:**
- Migration `005_*.sql`: add `thinking jsonb` (default `'[]'`) to `chat_messages`.
- `server/chat.ts`: `appendMessage` takes optional `thinking`; `getConversation` returns it.
- `/api/chat/[id]/messages` streaming route: it already sniffs the `done` event for `reply`; also capture `done.thinking` and store it with the assistant message.
- `RepoChat.tsx`: `openConversation` maps persisted `thinking` onto messages so `ThinkingBlock` renders on reload.

## Gotchas (don't rediscover these)
- Bun.serve default `idleTimeout` 10s kills streams → set high (done: 255).
- Client disconnect closes the stream controller; late `enqueue`/`close` throws and **crashes the daemon** → guard with a `closed` flag (done for chat; apply to any new streaming endpoint).
- Free models rate-limit after ~15 rapid calls, then hang (no clean error) — this is exactly task #1.
- Container must be rebuilt for app changes; daemon must be restarted for daemon changes.
- Don't self-test with paid models / many free calls — hand off for the user to test (memory `testing-preference`).

## Verify (once free model cools down or via a paid model the user picks)
Open Chat tab (desktop + phone), pick a repo, ask an exploratory question → thinking + tool reads stream live, then answer; conversations persist in the rail.

Nothing is committed. Ask the user before committing (daemon + app).
