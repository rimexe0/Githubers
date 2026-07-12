import assert from "node:assert/strict";
import test from "node:test";
import { fetchAutomatorOpenIssues, fetchAutomatorPullRequests, type AutomatorConfig } from "./automator";
import { withFallback } from "./board";

const config: AutomatorConfig = { enabled: true, baseUrl: "http://automator.test/api/v1", token: "test", repoPaths: new Map(), triggers: new Map() };

test("GitHub reads use repos/read without a local repo mapping", async () => {
  const previous = globalThis.fetch;
  const bodies: unknown[] = [];
  globalThis.fetch = async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return Response.json({ items: [{ id: "I1", number: 1, title: "Issue", html_url: "https://example.test/1", updated_at: "2026-01-01T00:00:00Z" }, { id: "PR1", number: 2, pull_request: {} }] });
  };
  try {
    const rows = await fetchAutomatorOpenIssues(config, [{ ownerLogin: "owner", repoName: "repo" }]);
    assert.equal(rows[0]?.issues.length, 1);
    assert.deepEqual(bodies[0], { kind: "github", request: { operation: "issues", repo: "owner/repo", state: "open", limit: 30 } });
  } finally { globalThis.fetch = previous; }
});

test("pull request reads normalize merged REST responses", async () => {
  const previous = globalThis.fetch;
  let call = 0;
  globalThis.fetch = async () => Response.json({ items: call++ === 0 ? [{ id: "P1", number: 1, state: "open" }] : [{ id: "P2", number: 2, state: "closed", merged_at: "2026-01-01T00:00:00Z" }] });
  try {
    const rows = await fetchAutomatorPullRequests(config, [{ ownerLogin: "owner", repoName: "repo" }]);
    assert.equal(rows[0]?.open[0]?.state, "OPEN");
    assert.equal(rows[0]?.closed[0]?.state, "MERGED");
  } finally { globalThis.fetch = previous; }
});

test("GitHub GraphQL fallback is used when AgentAutomator fails", async () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    const value = await withFallback(async () => { throw new Error("daemon offline"); }, async () => "graphql", "test read unavailable");
    assert.equal(value, "graphql");
  } finally { console.warn = warn; }
});
