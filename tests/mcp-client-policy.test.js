import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";

import { createMcpClient } from "../src/mcp/create-mcp-client.js";

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
