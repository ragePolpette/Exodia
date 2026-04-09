import test from "node:test";
import assert from "node:assert/strict";

import {
  defaultRepoTarget,
  inferProductTargetFromEvidence,
  parseServerRegistryToml,
  resolveSqlBridgeInvocation,
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
        text: "{\"issues\":[{\"key\":\"WEB-1\"}]}"
      }
    ]
  });

  assert.deepEqual(result.data, {
    issues: [{ key: "WEB-1" }]
  });
});

test("inferProductTargetFromEvidence honors canonical target semantics", () => {
  assert.equal(
    inferProductTargetFromEvidence(
      {
        summary: "Errore financebot registrazione",
        rawDescription: "",
        pageUrl: ""
      },
      []
    ),
    "financebot"
  );

  assert.equal(
    inferProductTargetFromEvidence(
      {
        summary: "Problema legacy-suite anagrafica",
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
        summary: "Errore portal-web in fattura",
        rawDescription: "",
        pageUrl: ""
      },
      []
    ),
    "webportal"
  );

  assert.equal(
    inferProductTargetFromEvidence(
      {
        key: "WEB-10",
        projectKey: "WEB",
        summary: "Errore salvataggio documento",
        rawDescription: "",
        pageUrl: ""
      },
      []
    ),
    "webportal"
  );
});

test("defaultRepoTarget matches harness repo conventions", () => {
  assert.equal(defaultRepoTarget("legacy"), "api+asp");
  assert.equal(defaultRepoTarget("webportal"), "public-web");
  assert.equal(defaultRepoTarget("financebot"), "public-web+shared-lib+financebot");
  assert.equal(defaultRepoTarget("unknown"), "UNKNOWN");
});

test("target rules can override aliases, project keys and repo defaults", () => {
  const targeting = {
    rules: [
      {
        target: "legacy",
        repoTarget: "core-app",
        area: "core-platform",
        inScope: true,
        feasibility: "feasible",
        implementationHint: "Inspect core platform code",
        aliases: ["legacy-suite"],
        scopeAliases: ["coreapp"],
        projectKeys: ["GEN"]
      }
    ]
  };

  assert.equal(
    inferProductTargetFromEvidence(
      {
        summary: "Issue in Legacy-Suite dashboard",
        rawDescription: "",
        pageUrl: ""
      },
      [],
      null,
      targeting
    ),
    "legacy"
  );

  assert.equal(
    inferProductTargetFromEvidence(
      {
        key: "GEN-10",
        projectKey: "GEN",
        summary: "Generic ticket",
        rawDescription: "",
        pageUrl: ""
      },
      [],
      null,
      targeting
    ),
    "legacy"
  );

  assert.equal(defaultRepoTarget("legacy", targeting), "core-app");
});

test("bridge SQL diagnostics resolve anonymized prod reads for prod targets", () => {
  const invocation = resolveSqlBridgeInvocation("llm-db-prod-mcp", "runDiagnosticQuery", {
    database: "prod",
    query: "select 1",
    parameters: {}
  });

  assert.equal(invocation.executable, true);
  assert.equal(invocation.toolName, "db_prod_read_anonymized");
  assert.equal(invocation.toolArgs.sql, "select 1");
});

test("bridge SQL run logging refuses non-writable targets without configured dev server", async () => {
  const invocation = resolveSqlBridgeInvocation("llm-db-prod-mcp", "recordHarnessRun", {
    runId: "run-1",
    mode: "triage-only",
    sql: "insert into harness_runs values (@runId)"
  });

  assert.equal(invocation.executable, false);
  assert.equal(invocation.response.stored, false);
  assert.match(invocation.response.note, /requires a writable llm-db-dev-mcp/i);
});
