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
        server: "llm-sql-db-mcp"
      }
    },
    targets: {
      prod: {
        server: "llm-sql-db-mcp",
        database: "ProdDb",
        access: "read-only"
      },
      dev: {
        server: "llm-sql-db-mcp",
        database: "DevDb",
        access: "schema-and-tests"
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
  assert.equal(config.adapters.llmSqlDb.mcp.operations.recordRun.server, "llm-sql-db-mcp");
});
