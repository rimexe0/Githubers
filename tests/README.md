# Smoke Tests

End-to-end smoke checks for the local Githubers + AgentAutomator stack.

## Run

Start the app and daemon first:

```sh
cd /Users/rime/code/personal/Githubers
docker compose up -d --build app

cd /Users/rime/code/personal/AgentAutomator
HOST=0.0.0.0 bun run index.ts serve --port 3001 --token <token-from-githubers-settings>
```

Then run:

```sh
node tests/smoke.mjs --with-model
```

Without `--with-model`, the script skips model-backed checks and only tests the
dashboard, daemon proxy, WebSocket RPC, and PTY terminal path.

## Environment

- `GITHUBERS_BASE` defaults to `http://127.0.0.1:3000`
- `SMOKE_CHAT_REPO` defaults to the first repo returned by `/api/automator/chat`
- `SMOKE_CHAT_MODEL` defaults to `opencode/deepseek-v4-flash-free`
- `SMOKE_DOCTOR_PROFILE` defaults to `opencode-free`

The script reads the daemon token from `/api/settings` but never prints it.
