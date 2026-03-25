import test from "node:test";
import assert from "node:assert/strict";

import {
  defaultRepoTarget,
  inferProductTargetFromEvidence,
  parseServerRegistryToml,
  resolveServerDefinition,
  unwrapToolResult
} from "../src/mcp/bridge-core.js";

test("parseServerRegistryToml reads command and args from codex-style registry", () => {
  const registry = parseServerRegistryToml(`
[mcp_servers.llm-context]
command = "npx"
args = ["-y", "mcp-remote", "http://127.0.0.1:8765/mcp", "--transport", "http-only"]

[mcp_servers.atlassian-rovo-mcp]
command = "npx"
args = ["-y", "mcp-remote@latest", "https://mcp.atlassian.com/v1/mcp"]
startup_timeout_sec = 25.0
`);

  assert.equal(registry["llm-context"].command, "npx");
  assert.deepEqual(registry["llm-context"].args, [
    "-y",
    "mcp-remote",
    "http://127.0.0.1:8765/mcp",
    "--transport",
    "http-only"
  ]);
  assert.equal(registry["atlassian-rovo-mcp"].startup_timeout_sec, 25);
});

test("resolveServerDefinition accepts underscore and hyphen aliases", () => {
  const registry = {
    "llm-context": {
      command: "npx",
      args: []
    }
  };

  assert.equal(resolveServerDefinition(registry, "llm-context")?.command, "npx");
  assert.equal(resolveServerDefinition(registry, "llm_context")?.command, "npx");
});

test("unwrapToolResult parses JSON text payloads emitted by MCP tools", () => {
  const result = unwrapToolResult({
    content: [
      {
        type: "text",
        text: "{\"issues\":[{\"key\":\"DEVFH-1\"}]}"
      }
    ]
  });

  assert.deepEqual(result.data, {
    issues: [{ key: "DEVFH-1" }]
  });
});

test("inferProductTargetFromEvidence honors canonical target semantics", () => {
  assert.equal(
    inferProductTargetFromEvidence(
      {
        summary: "Errore fiscobot registrazione",
        rawDescription: "",
        pageUrl: ""
      },
      []
    ),
    "fiscobot"
  );

  assert.equal(
    inferProductTargetFromEvidence(
      {
        summary: "Problema BPO anagrafica",
        rawDescription: "",
        pageUrl: ""
      },
      []
    ),
    "legacy"
  );

  assert.equal(
    inferProductTargetFromEvidence(
      {
        summary: "Errore yeti in fattura",
        rawDescription: "",
        pageUrl: ""
      },
      []
    ),
    "fatturhello"
  );

  assert.equal(
    inferProductTargetFromEvidence(
      {
        key: "DEVFH-10",
        projectKey: "DEVFH",
        summary: "Errore salvataggio documento",
        rawDescription: "",
        pageUrl: ""
      },
      []
    ),
    "fatturhello"
  );
});

test("defaultRepoTarget matches harness repo conventions", () => {
  assert.equal(defaultRepoTarget("legacy"), "api+asp");
  assert.equal(defaultRepoTarget("fatturhello"), "pubblico");
  assert.equal(defaultRepoTarget("fiscobot"), "pubblico+bpofh+fiscobot");
  assert.equal(defaultRepoTarget("unknown"), "UNKNOWN");
});
