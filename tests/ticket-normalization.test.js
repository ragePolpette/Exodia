import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { normalizeSupportTicket } from "../src/tickets/normalize-support-ticket.js";
import { McpLlmSqlDbAdapter } from "../src/adapters/llm-sql-db-mcp-adapter.js";
import { loadConfig } from "../src/config/load-config.js";

test("support ticket normalization extracts common assistance fields", () => {
  const ticket = normalizeSupportTicket({
    key: "DEVFH-9999",
    summary: "Incasso proforma bloccato",
    description: [
      "InnovaPro Commercialisti Associati",
      "pi: 03680241209",
      "url: https://app.fiscobot.it/home.aspx",
      "tel: 051347850",
      "",
      "Proforma non incassabile lato cliente"
    ].join("\n")
  });

  assert.equal(ticket.partitaIva, "03680241209");
  assert.equal(ticket.pageUrl, "https://app.fiscobot.it/home.aspx");
  assert.equal(ticket.phone, "051347850");
  assert.equal(ticket.companyOrStudio, "InnovaPro Commercialisti Associati");
  assert.equal(ticket.productTarget, "fiscobot");
});

test("support ticket normalization honors configurable target aliases", () => {
  const ticket = normalizeSupportTicket(
    {
      key: "GEN-101",
      summary: "Legacy-Suite login issue",
      description: "Studio Alpha\npi: IT00000000001"
    },
    {
      targeting: {
        rules: [
          {
            target: "legacy",
            repoTarget: "core-app",
            aliases: ["legacy-suite"],
            scopeAliases: ["coreapp"],
            projectKeys: ["GEN"]
          }
        ]
      }
    }
  );

  assert.equal(ticket.productTarget, "legacy");
});

test("sql db mcp adapter routes diagnostics to the requested database server", async () => {
  const calls = [];
  const adapter = new McpLlmSqlDbAdapter({
    enabled: true,
    prodServer: "llm-db-prod-mcp",
    devServer: "llm-db-dev-mcp",
    defaultDatabase: "prod",
    client: {
      request(payload) {
        calls.push(payload);
        return Promise.resolve({ used: true, source: "mcp", rows: [], summary: "ok" });
      }
    }
  });

  await adapter.runDiagnosticQuery({
    phase: "execution",
    ticketKey: "DEVFH-9999",
    query: "select 1",
    database: "dev"
  });

  assert.equal(calls[0].server, "llm-db-dev-mcp");
  assert.equal(calls[0].payload.database, "dev");
});

test("sql db mcp adapter supports unified topology through explicit targets", async () => {
  const calls = [];
  const adapter = new McpLlmSqlDbAdapter({
    enabled: true,
    topology: "unified",
    operations: {
      recordRun: {
        server: "llm-db-dev-mcp",
        enabled: true,
        database: "dev",
        sql: "insert into harness_runs(run_id, mode) values (@runId, @mode)"
      }
    },
    targets: {
      prod: {
        server: "llm-sql-db-mcp",
        database: "ProdDb",
        access: "read-only",
        action: "runDiagnosticQuery",
        maxRows: 25
      },
      dev: {
        server: "llm-sql-db-mcp",
        database: "DevDb",
        access: "schema-and-tests",
        action: "runDiagnosticQuery",
        maxRows: 10
      }
    },
    defaultDatabase: "prod",
    client: {
      request(payload) {
        calls.push(payload);
        return Promise.resolve({ used: true, source: "mcp", rows: [], summary: "ok" });
      }
    }
  });

  await adapter.runDiagnosticQuery({
    phase: "execution",
    ticketKey: "DEVFH-10000",
    query: "select 1",
    database: "dev"
  });

  assert.equal(calls[0].server, "llm-sql-db-mcp");
  assert.equal(calls[0].payload.database, "DevDb");
  assert.equal(calls[0].payload.maxRows, 10);
});

test("sql db mcp adapter skips run persistence when no writable statement is configured", async () => {
  const adapter = new McpLlmSqlDbAdapter({
    enabled: true,
    operations: {
      recordRun: {
        server: "llm-db-dev-mcp",
        enabled: false,
        sql: ""
      }
    },
    client: {
      request() {
        throw new Error("client should not be called when recordRun is disabled");
      }
    }
  });

  const result = await adapter.recordRun({
    mode: "triage-only",
    dryRun: true,
    ticketCount: 3
  });

  assert.equal(result.stored, false);
  assert.match(result.note, /disabled by local config/i);
});

test("loadConfig normalizes legacy sql db server fields into explicit targets", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "bpopilot-config-"));
  const configPath = path.join(workspace, "harness.config.json");

  await writeFile(
    configPath,
    JSON.stringify(
      {
        adapters: {
          llmSqlDb: {
            kind: "mcp",
            mcp: {
              server: "llm-sql-db-mcp",
              prodServer: "llm-db-prod-mcp",
              devServer: "llm-db-dev-mcp",
              enabled: true
            }
          }
        }
      },
      null,
      2
    )
  );

  const config = await loadConfig(configPath);

  assert.equal(config.adapters.llmSqlDb.mcp.topology, "split");
  assert.equal(config.adapters.llmSqlDb.mcp.targets.prod.server, "llm-db-prod-mcp");
  assert.equal(config.adapters.llmSqlDb.mcp.targets.dev.server, "llm-db-dev-mcp");
  assert.equal(config.adapters.llmSqlDb.mcp.targets.prod.action, "runDiagnosticQuery");
  assert.equal(config.adapters.llmSqlDb.mcp.targets.dev.maxRows, 50);
  assert.equal(config.adapters.llmSqlDb.mcp.operations.recordRun.server, "llm_db_dev_mcp");
  assert.equal(config.adapters.llmSqlDb.mcp.operations.recordRun.action, "recordHarnessRun");
  assert.equal(config.adapters.llmSqlDb.mcp.operations.recordRun.enabled, false);
  assert.equal(config.execution.baseBranch, "");
  assert.equal(config.adapters.llmMemory.mcp.namespace, "malkuth");
  assert.equal(config.adapters.llmSqlDb.mcp.namespace, "malkuth");
  assert.equal(config.targeting.rules.length, 3);
  assert.equal(config.targeting.rules[0].target, "legacy");
});
