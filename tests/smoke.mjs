#!/usr/bin/env node

const baseUrl = process.env.GITHUBERS_BASE ?? "http://127.0.0.1:3000";
const withModel = process.argv.includes("--with-model");
const chatModel = process.env.SMOKE_CHAT_MODEL ?? "opencode/deepseek-v4-flash-free";
const doctorProfile = process.env.SMOKE_DOCTOR_PROFILE ?? "opencode-free";

const results = [];

function pass(name, details = "") {
  results.push({ ok: true, name, details });
  console.log(`ok - ${name}${details ? ` (${details})` : ""}`);
}

function fail(name, error) {
  const message = error instanceof Error ? error.message : String(error);
  results.push({ ok: false, name, details: message });
  console.error(`not ok - ${name}: ${message}`);
}

async function check(name, fn) {
  try {
    await fn();
  } catch (error) {
    fail(name, error);
  }
}

async function request(path, options = {}) {
  const response = await fetch(new URL(path, baseUrl), options);
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${typeof body === "string" ? body : JSON.stringify(body)}`);
  }
  return body;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function deriveWsUrl(settings) {
  if (settings.automatorWsUrl) return settings.automatorWsUrl;
  const httpUrl = new URL(settings.automatorBaseUrl);
  if (httpUrl.hostname === "host.docker.internal") httpUrl.hostname = "127.0.0.1";
  httpUrl.protocol = httpUrl.protocol === "https:" ? "wss:" : "ws:";
  httpUrl.pathname = httpUrl.pathname.replace(/\/?$/, "/ws");
  httpUrl.search = "";
  return httpUrl.toString();
}

function withToken(wsUrl, token) {
  const url = new URL(wsUrl);
  if (token) url.searchParams.set("token", token);
  return url.toString();
}

async function readSettings() {
  const settings = await request("/api/settings");
  assert(settings.automatorEnabled === true, "AgentAutomator is not enabled in settings");
  assert(settings.automatorBaseUrl, "automatorBaseUrl is missing");
  return settings;
}

async function smokeHttp(settings) {
  await check("githubers health", async () => {
    const health = await request("/api/health");
    assert(health.status === "ok" && health.database === true, "database health is not ok");
    pass("githubers health");
  });

  await check("automator health proxy", async () => {
    const health = await request("/api/automator/health", { method: "POST" });
    assert(health.ok === true, "daemon did not report ok");
    pass("automator health proxy", `${health.runCount ?? 0} run(s)`);
  });

  await check("automator config proxy", async () => {
    const config = await request("/api/automator/config");
    assert(Array.isArray(config.profiles) && config.profiles.length > 0, "profiles missing");
    pass("automator config proxy", `${config.profiles.length} profile(s)`);
  });

  await check("automator runs proxy", async () => {
    const runs = await request("/api/automator/runs");
    assert(Array.isArray(runs), "runs response is not an array");
    pass("automator runs proxy", `${runs.length} run(s)`);
  });

  await check("automator chat repo list", async () => {
    const chat = await request("/api/automator/chat");
    assert(chat.enabled === true, "chat proxy is disabled");
    assert(Array.isArray(chat.repos), "repo list missing");
    pass("automator chat repo list", `${chat.repos.length} repo(s)`);
  });

  await check("automator import status", async () => {
    const status = await request("/api/automator/import-chats");
    assert(typeof status.active === "boolean", "import status missing active flag");
    pass("automator import status", `phase=${status.phase ?? "unknown"}`);
  });

  await check("automator AGENTS.md file discovery", async () => {
    const repos = await request("/api/automator/chat");
    const repo = process.env.SMOKE_CHAT_REPO ?? repos.repos?.[0];
    assert(repo, "no repo available for AGENTS.md discovery");
    const files = await request(`/api/automator/agentsmd/files?repo=${encodeURIComponent(repo)}`);
    assert(Array.isArray(files), "files response is not an array");
    assert(files.some((file) => file.exists), "no AGENTS.md/CLAUDE.md files found");
    pass("automator AGENTS.md file discovery", repo);
  });

  return settings;
}

async function smokeWebSocket(settings) {
  const wsUrl = withToken(deriveWsUrl(settings), settings.automatorToken);
  const frames = [];
  const socket = new WebSocket(wsUrl);

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("WebSocket open timed out")), 10_000);
    socket.onopen = () => {
      clearTimeout(timeout);
      resolve();
    };
    socket.onerror = () => {
      clearTimeout(timeout);
      reject(new Error("WebSocket failed to open"));
    };
  });

  socket.onmessage = (event) => {
    const frame = JSON.parse(event.data);
    frames.push(frame);
    if (frame.channel === "term:smoke" && frame.type === "stdout" && String(frame.payload?.data ?? "").includes("SMOKE_TERM_OK")) {
      socket.send(JSON.stringify({ channel: "term:smoke", type: "stdin", payload: { data: "exit\n" } }));
    }
  };

  socket.send(JSON.stringify({ channel: "rpc", type: "rpc-request", payload: { id: "ping-1", method: "ping" } }));
  socket.send(JSON.stringify({ channel: "rpc", type: "rpc-request", payload: { id: "runs-1", method: "runs.list" } }));
  socket.send(JSON.stringify({ channel: "term:smoke", type: "subscribe", payload: { cols: 80, rows: 24, cwd: process.cwd() } }));

  await new Promise((resolve) => setTimeout(resolve, 500));
  socket.send(JSON.stringify({ channel: "term:smoke", type: "stdin", payload: { data: "echo SMOKE_TERM_OK\n" } }));
  await new Promise((resolve) => setTimeout(resolve, 2_500));
  socket.close();

  const pong = frames.find((frame) => frame.channel === "rpc" && frame.payload?.id === "ping-1");
  assert(pong?.payload?.ok === true && pong.payload.result?.pong === true, "missing rpc ping response");

  const runList = frames.find((frame) => frame.channel === "rpc" && frame.payload?.id === "runs-1");
  assert(runList?.payload?.ok === true && Array.isArray(runList.payload.result?.runs), "missing runs.list response");

  const terminalOutput = frames
    .filter((frame) => frame.channel === "term:smoke" && frame.type === "stdout")
    .map((frame) => String(frame.payload?.data ?? ""))
    .join("");
  assert(terminalOutput.includes("SMOKE_TERM_OK"), "terminal output did not include marker");

  const terminalExit = frames.find((frame) => frame.channel === "term:smoke" && frame.type === "status" && frame.payload?.state === "exited");
  assert(terminalExit?.payload?.exitCode === 0, "terminal did not exit cleanly");

  pass("multiplexed WebSocket RPC + PTY", `${runList.payload.result.runs.length} run(s)`);
}

async function readStream(response) {
  assert(response.body, "response has no body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let output = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    output += decoder.decode(value, { stream: true });
  }
  output += decoder.decode();
  return output;
}

async function smokeModelBackedEndpoints() {
  await check("free-model repo chat stream", async () => {
    const chat = await request("/api/automator/chat");
    const repo = process.env.SMOKE_CHAT_REPO ?? chat.repos?.[0];
    assert(repo, "no repo available for chat smoke");

    const conversation = await request("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repo, model: chatModel, profile: "opencode-plan" }),
    });

    const response = await fetch(new URL(`/api/chat/${conversation.id}/messages`, baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: chatModel,
        profile: "opencode-plan",
        content: "Smoke test only. Reply with SMOKE_CHAT_OK and one filename from this repo. Do not edit files.",
      }),
      signal: AbortSignal.timeout(90_000),
    });
    assert(response.ok, `chat stream returned ${response.status}`);
    const output = await readStream(response);
    assert(output.includes("\"type\":\"done\""), "chat stream did not finish");
    assert(output.includes("SMOKE_CHAT_OK"), "chat stream did not include marker");
    pass("free-model repo chat stream", `${repo} via ${chatModel}`);
  });

  await check("free-model AGENTS.md doctor", async () => {
    const result = await request("/api/automator/agentsmd/doctor", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profile: doctorProfile,
        content: "# AGENTS.md\n\n- Never push, commit, or open a PR without explicit user approval.\n- Use Bun in this repository.\n",
      }),
    });
    assert(typeof result.score === "number", "doctor score missing");
    assert(Array.isArray(result.findings), "doctor findings missing");
    pass("free-model AGENTS.md doctor", `score=${result.score}`);
  });
}

console.log(`Smoke target: ${baseUrl}`);
const settings = await readSettings();
await smokeHttp(settings);
await check("multiplexed WebSocket RPC + PTY", () => smokeWebSocket(settings));
if (withModel) await smokeModelBackedEndpoints();
else console.log("skip - model-backed checks (pass --with-model to enable)");

const failed = results.filter((result) => !result.ok);
if (failed.length > 0) {
  console.error(`\n${failed.length} smoke check(s) failed.`);
  process.exit(1);
}
console.log(`\n${results.length} smoke check(s) passed.`);
