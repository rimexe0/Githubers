# Handoff — Githubers ↔ AgentAutomator repo chat

Context handoff for a fresh chat. Read the auto-memory index first (durable facts:
`repo-chat-via-daemon`, `testing-preference`, `githubers-build-env`). This file adds
the current state + exact repro. **Both original open tasks are DONE and verified live**
as of 2026-07-01 (2nd session). What remains is optional/deferred (bottom).

## The two repos
- **Githubers** `/Users/rime/code/personal/Githubers` — Next.js 16 + React 19 + Postgres, Docker Compose (app on **:3000**). App lives in `app/`. Branch: `frontend-redesign`. Dev outside Docker uses :3100. **App code changes require `docker compose up -d --build`** (Dockerfile builds at image time; also runs DB migrations on start).
- **AgentAutomator** `/Users/rime/code/personal/AgentAutomator` — the "brain" daemon (Bun). Runs on the **host** at `127.0.0.1:3001`, reachable from Docker at `http://host.docker.internal:3001/api/v1`. Started manually. Changes uncommitted on `src/agent-runner.ts`, `src/config.ts`, `src/server.ts`, `src/process-runner.ts` (unchanged) — see "Nothing is committed".
- **Auth:** `Authorization: Bearer <AUTOMATOR_TOKEN>`. Token = `settings.automatorToken` in Githubers Postgres (currently a 4-char secret). Read it:
  `docker compose exec -T postgres psql -U githubers -d githubers -t -A -c "SELECT value #>> '{}' FROM settings WHERE key='automatorToken';"`
  **Do not echo the token to stdout** — the auto-mode classifier blocks it. Pipe it straight into the env var.

## Runtime state right now
- **Daemon is running as PID ~5210** under `nohup` (started from a Claude session shell, log at `/tmp/automator-daemon.log`), with the LATEST code. If gone, restart (see below).
- Mapped repos (`settings.automatorRepoPaths`, `owner/repo=/local/path` per line): `jackrussell-team/e-fatura_backend`, `jackrussell-team/finvest`, `jackrussell-team/jackrussel-Frontend`. Trigger columns intentionally empty.
- Docker up: `githubers-postgres-1` (healthy). Migration `005_chat_thinking.sql` applied.
- Free models rate-limit after heavy use; when limited they **hang silently** (see findings). User prefers to run live tests themselves — DO NOT burn paid/free calls to self-verify (memory `testing-preference`).

### Restart the daemon (required after ANY daemon edit — bun does NOT hot-reload)
```
cd /Users/rime/code/personal/AgentAutomator
export AUTOMATOR_TOKEN=$(docker compose -f /Users/rime/code/personal/Githubers/docker-compose.yml exec -T postgres psql -U githubers -d githubers -t -A -c "SELECT value #>> '{}' FROM settings WHERE key='automatorToken';" | tr -d '[:space:]')
pkill -f "index.ts serve --port 3001"; sleep 1
nohup bun run index.ts serve --port 3001 > /tmp/automator-daemon.log 2>&1 &
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $AUTOMATOR_TOKEN" http://127.0.0.1:3001/api/v1/config   # expect 200
```

## What's built (all working, tsc/lint/build clean, daemon tests 17/17)
Repo chat = Githubers UI → daemon → OpenCode `plan` agent (read-only) in the repo dir. Streaming NDJSON. Same execution substrate as autonomous runs.

**Daemon (`src/server.ts`, `src/config.ts`, `src/agent-runner.ts`, `src/process-runner.ts`):**
- `POST /api/v1/chat` (non-streaming), `POST /api/v1/chat/stream` (NDJSON `{type:"reasoning"|"tool"|"text"|"done"|"error"}`), `GET /api/v1/models` (free flagged).
- `opencode-plan` profile: `opencode run --format json --thinking --agent plan --variant low --dir {cwd} {prompt}`. Read-only verified.
- `lineToChatEvent` maps JSONL parts → text/reasoning/tool AND now `error` events. `withModel()` overrides `--model`.

**Githubers app:** Settings → "Agent automator" (`lib/schemas.ts`, `dashboard/SettingsForm.tsx`); Chat tab `dashboard/RepoChat.tsx`; persistence `chat_conversations`+`chat_messages` (migrations `004_chat.sql`, `005_chat_thinking.sql`), `server/chat.ts`, routes `/api/chat`, `/api/chat/[id]`, `/api/chat/[id]/messages` (streaming relay: forwards NDJSON, persists reply + thinking on `done`). Proxies `/api/automator/chat`, `/api/automator/models`.

## What the 2nd session fixed (both original tasks) — DONE + LIVE

### 1. Rate limits / errors no longer hang the UI ✅
**Corrected root cause (the ORIGINAL handoff's assumption was WRONG):** a rate-limited free model emits **ZERO output and does NOT exit** — verified by running one real call: 2+ minutes of empty stdout/stderr, process still alive. So stderr/pattern-matching can *never* catch this case (nothing is ever emitted). Also OpenCode writes errors to **stdout as JSON events** `{"type":"error","error":{"data":{"message":...}}}` with **exit 1** — NOT to stderr.
**Daemon fix (`handleChatStream`):**
- **Inactivity watchdog (60s no output) + hard max-duration cap (4min)** → kills the OpenCode process (`terminateProcess`, pid captured via new `onStart` passthrough in `runAgentProfile`), emits `error`+`done`, closes the stream once. This is the real backstop for the silent hang.
- Parses stdout JSON `{"type":"error"}` events → surfaces them live and terminates.
- Scans non-JSON stdout + stderr for rate-limit/auth patterns (secondary).
- `rateLimitMessage()` / `parseRetryAfterSeconds()` / `formatDuration()` build a human message ("Free model usage limit reached (HTTP 429)… switch to a paid model or wait…") with a reset-time countdown WHEN available.
**UI fix (`RepoChat.tsx`):** error banner + red "failed" bubble (stops the "working…" spinner); client-side 70s inactivity abort; Send becomes **Cancel** while streaming; free-model hint under the model picker.

### 2. Thinking blocks persisted ✅
Migration `005_chat_thinking.sql` (`thinking jsonb default '[]'`); `appendMessage` takes optional thinking; messages route sniffs `done.thinking`; `RepoChat.openConversation` maps persisted thinking back onto `ThinkingBlock`. Verified: assistant rows in DB carry stored thinking; renders on reload.

## OPEN / REMAINING (optional — none block the feature)

1. **Reset-time countdown (DEFERRED — user said "deal with it later").** The friendly 429 message currently shows WITHOUT the time. Reason: OpenCode's 429 carries a `retry-after` header (~44197s ≈ 12h, looks like a daily/midnight reset) but it lands **only in OpenCode's internal debug log** (`~/.local/share/opencode/log/*.log`, as `responseHeaders`), NOT in the CLI stdout the daemon sees. Extraction (`parseRetryAfterSeconds`, broadened `retry_after_pattern`) is already in place and will render `12h 17m`-style IF the value ever appears in output. **To actually deliver it:** have the daemon read the latest opencode log file after a rate-limit and grep the most recent `retry-after` for that session id — fragile correlation, ~30 min.
2. **Nothing is committed** in either repo. Daemon: `agent-runner.ts`, `config.ts`, `server.ts`. App: `RepoChat.tsx`, `server/chat.ts`, chat API routes, migrations `004`+`005`. Ask the user before committing.
3. **Minor polish (not blockers):**
   - A rate-limited/failed turn persists a `"(no response)"` assistant message → on reload you see the user question with an empty reply. Could suppress persistence when the turn ended in error.
   - Timeouts are fixed (60s daemon / 70s client) for ALL models — a genuinely slow-but-working free model could be cut off. Could scope the aggressive timeout to free models only.

## Gotchas (don't rediscover these)
- **`bun run index.ts serve` does NOT hot-reload server code** — after any daemon edit you MUST kill+restart, or it silently runs stale code. (This trap wasted a round: the fix looked broken but the daemon was just old.)
- App changes need `docker compose up -d --build` (Docker builds at image time + runs migrations).
- Bun.serve default `idleTimeout` 10s kills streams → set 255 (done).
- Client disconnect closes the stream controller; late `enqueue`/`close` throws and **crashes the daemon** → guard with a `closed` flag (done for chat; apply to any new streaming endpoint).
- Rate-limited free model = zero output + no exit (task #1's whole reason). OpenCode errors → stdout JSON events, exit 1, not stderr.
- Don't self-test with paid models / many free calls — hand off for the user (memory `testing-preference`).

## Verify (user runs live)
Chat tab (desktop + phone), pick a repo, ask an exploratory question → thinking + tool reads stream live, then answer; conversations persist in the rail; reload a saved conversation → thinking blocks still render. When rate-limited: error appears within ~60s (not infinite loading), spinner stops, message explains the 429.
