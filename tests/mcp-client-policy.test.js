import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";

import { createMcpClient } from "../src/mcp/create-mcp-client.js";
import { terminateProcessTree } from "../src/agent-runtime/runtime-process-policy.js";

test("fixture MCP client rejects actions outside the configured allowlist", async () => {
  const client = createMcpClient({
    mode: "fixture",
    fixtures: {
      "llm-context.mapTicketToCodebase": { ok: true }
    },
    allowedActionsByServer: {
      "llm-context": ["mapTicketToCodebase"]
    }
  });

  const allowed = await client.request({
    server: "llm-context",
    action: "mapTicketToCodebase",
    payload: {}
  });

  assert.deepEqual(allowed, { ok: true });

  await assert.rejects(
    client.request({
      server: "llm-context",
      action: "searchEverything",
      payload: {}
    }),
    /not allowed by bridge policy/i
  );
});

test("external MCP client surfaces a typed error when the bridge is not configured", async () => {
  const client = createMcpClient({
    mode: "external",
    command: "",
    args: []
  });

  await assert.rejects(
    client.request({
      server: "llm-context",
      action: "mapTicketToCodebase",
      payload: {}
    }),
    (error) => error.code === "MCP_BRIDGE_NOT_CONFIGURED"
  );
});

test("external MCP client surfaces a typed timeout error", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "exodia-mcp-timeout-"));
  const bridgeScript = path.join(workspace, "timeout-bridge.mjs");

  await writeFile(
    bridgeScript,
    `
setTimeout(() => {
  process.stdout.write("{}");
}, 250);
process.stdin.resume();
`
  );

  const client = createMcpClient({
    mode: "external",
    command: "node",
    args: [bridgeScript],
    timeoutMs: 50
  });

  await assert.rejects(
    client.request({
      server: "llm-context",
      action: "mapTicketToCodebase",
      payload: {}
    }),
    (error) => error.code === "MCP_BRIDGE_TIMEOUT"
  );
});

test("external MCP client surfaces a typed invalid response error", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "exodia-mcp-invalid-"));
  const bridgeScript = path.join(workspace, "invalid-bridge.mjs");

  await writeFile(
    bridgeScript,
    `
process.stdin.resume();
process.stdout.write("not-json");
`
  );

  const client = createMcpClient({
    mode: "external",
    command: "node",
    args: [bridgeScript]
  });

  await assert.rejects(
    client.request({
      server: "llm-context",
      action: "mapTicketToCodebase",
      payload: {}
    }),
    (error) => error.code === "MCP_BRIDGE_INVALID_RESPONSE"
  );
});

async function createCountingBridge(prefix, body) {
  const workspace = await mkdtemp(path.join(os.tmpdir(), prefix));
  const counterFile = path.join(workspace, "attempts.log");
  const bridgeScript = path.join(workspace, "bridge.mjs");
  await writeFile(
    bridgeScript,
    `
import { appendFileSync } from "node:fs";
appendFileSync(${JSON.stringify(counterFile)}, "x");
${body}
`
  );
  return { workspace, counterFile, bridgeScript };
}

test("external MCP client retries read-only actions only", async () => {
  const { counterFile, bridgeScript } = await createCountingBridge(
    "exodia-mcp-retry-",
    "process.stdin.resume(); process.stdin.on('end', () => process.exit(1));"
  );
  const client = createMcpClient({
    mode: "external",
    command: process.execPath,
    args: [bridgeScript],
    retries: 2,
    retryDelayMs: 1
  });

  await assert.rejects(
    client.request({ server: "atlassian_rovo_mcp", action: "searchTicketsByJql", payload: {} }),
    (error) => error.code === "MCP_BRIDGE_FAILED"
  );
  assert.equal((await readFile(counterFile, "utf8")).length, 3);

  for (const action of ["createCommit", "pushBranch", "openPullRequest", "addTicketComment", "postMessage"]) {
    await writeFile(counterFile, "");
    await assert.rejects(
      client.request({ server: "any", action, payload: {} }),
      (error) => error.code === "MCP_BRIDGE_FAILED"
    );
    assert.equal((await readFile(counterFile, "utf8")).length, 1, `${action} must not be retried`);
  }
});

test("external MCP bridge receives only allowlisted environment variables", async () => {
  const { bridgeScript } = await createCountingBridge(
    "exodia-mcp-env-",
    "process.stdin.resume(); process.stdin.on('end', () => process.stdout.write(JSON.stringify({ secret: process.env.EXODIA_TEST_SECRET ?? null, passthrough: process.env.EXODIA_TEST_PASSTHROUGH ?? null, hasPath: Boolean(process.env.PATH) })));"
  );
  const processEnv = {
    ...process.env,
    EXODIA_TEST_SECRET: "sk-should-not-leak",
    EXODIA_TEST_PASSTHROUGH: "visible"
  };
  const client = createMcpClient({
    mode: "external",
    command: process.execPath,
    args: [bridgeScript],
    envPassthrough: ["EXODIA_TEST_PASSTHROUGH"],
    processEnv
  });

  const response = await client.request({ server: "llm-context", action: "mapTicketToCodebase", payload: {} });

  assert.deepEqual(response, { secret: null, passthrough: "visible", hasPath: true });
});

test("process tree termination uses taskkill on Windows", () => {
  const calls = [];
  const fakeSpawn = (command, args) => {
    calls.push([command, ...args]);
    return { on() {} };
  };
  let killed = false;

  terminateProcessTree({ pid: 4242, kill: () => { killed = true; } }, { platform: "win32", spawnProcess: fakeSpawn });
  assert.deepEqual(calls, [["taskkill", "/pid", "4242", "/t", "/f"]]);
  assert.equal(killed, false);

  terminateProcessTree({ pid: 4242, kill: () => { killed = true; } }, { platform: "linux", spawnProcess: fakeSpawn });
  assert.equal(killed, true);
});
