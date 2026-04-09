import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { runHarness } from "../src/orchestration/run-harness.js";

test("triage does not require sql diagnostics when tickets do not request them", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "legacy-suite-sqldb-skip-"));
  const configPath = path.join(workspace, "harness.config.json");
  const config = {
    mode: "triage-only",
    dryRun: true,
    memory: {
      backend: "file",
      filePath: "./memory.json"
    },
    adapters: {
      jira: {
        kind: "mcp",
        mock: { ticketSource: "config.mockTickets" },
        mcp: { server: "jira-official", jql: "project = LEG" }
      },
      llmContext: {
        kind: "mcp",
        mock: { mappingSource: "ticket.contextMapping" },
        mcp: { server: "llm-context", workspaceRoot: workspace }
      },
      llmMemory: {
        kind: "mcp",
        mock: { backend: "file" },
        mcp: { server: "llm-memory", namespace: "malkuth-ticket-harness" }
      },
      llmSqlDb: {
        kind: "mcp",
        mock: { recordRuns: true },
        mcp: {
          server: "llm-sql-db-mcp",
          topology: "split",
          targets: {
            prod: {
              server: "llm-db-prod-mcp",
              database: "prod",
              access: "read-only"
            },
            dev: {
              server: "llm-db-dev-mcp",
              database: "dev",
              access: "schema-and-tests"
            }
          },
          prodServer: "llm-db-prod-mcp",
          devServer: "llm-db-dev-mcp",
          defaultDatabase: "prod",
          enabled: true,
          namespace: "malkuth-ticket-harness"
        }
      },
      bitbucket: {
        kind: "mock",
        mock: { workspaceRoot: workspace },
        mcp: { server: "llm-bitbucket-mcp" }
      }
    },
    execution: {
      enabled: false,
      dryRun: true,
      baseBranch: "main",
      allowRealPrs: false,
      allowMerge: false,
      workspaceRoot: workspace
    },
    mcpBridge: {
      mode: "fixture",
      fixtureFile: "",
      fixtures: {
        "jira-official.searchTicketsByJql": {
          tickets: [{ key: "LEG-501", projectKey: "LEG", summary: "No DB needed" }]
        },
        "llm-context.mapTicketToCodebase": {
          repoTarget: "core-app",
          area: "core-platform",
          inScope: true,
          feasibility: "feasible",
          confidence: 0.9,
          implementationHint: "Context mapping is enough"
        },
        "llm-memory.listTicketMemoryRecords": { records: [] },
        "llm-memory.upsertTicketMemoryRecords": { records: [] },
        "llm-sql-db-mcp.recordHarnessRun": {
          runId: "diag-run",
          mode: "triage-only",
          stored: true
        }
      },
      command: "",
      args: []
    },
    mockTickets: []
  };

  await writeFile(configPath, JSON.stringify(config, null, 2));

  const summary = await runHarness({
    configPath,
    modeOverride: "triage-only",
    dryRunOverride: true
  });

  assert.equal(summary.triage[0].status_decision, "feasible");
});

test("sql diagnostics are used on demand in triage and execution", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "legacy-suite-sqldb-use-"));
  const configPath = path.join(workspace, "harness.config.json");
  const config = {
    mode: "triage-and-execution",
    dryRun: true,
    memory: {
      backend: "file",
      filePath: "./memory.json"
    },
    adapters: {
      jira: {
        kind: "mock",
        mock: { ticketSource: "config.mockTickets" },
        mcp: { server: "jira-official" }
      },
      llmContext: {
        kind: "mock",
        mock: { mappingSource: "ticket.contextMapping" },
        mcp: { server: "llm-context" }
      },
      llmMemory: {
        kind: "mock",
        mock: { backend: "file" },
        mcp: { server: "llm-memory" }
      },
      llmSqlDb: {
        kind: "mcp",
        mock: { recordRuns: true },
        mcp: {
          server: "llm-sql-db-mcp",
          topology: "split",
          targets: {
            prod: {
              server: "llm-db-prod-mcp",
              database: "prod",
              access: "read-only"
            },
            dev: {
              server: "llm-db-dev-mcp",
              database: "dev",
              access: "schema-and-tests"
            }
          },
          prodServer: "llm-db-prod-mcp",
          devServer: "llm-db-dev-mcp",
          defaultDatabase: "prod",
          enabled: true,
          namespace: "malkuth-ticket-harness"
        }
      },
      bitbucket: {
        kind: "mock",
        mock: { workspaceRoot: workspace },
        mcp: { server: "llm-bitbucket-mcp" }
      }
    },
    execution: {
      enabled: true,
      dryRun: true,
      baseBranch: "main",
      allowRealPrs: false,
      allowMerge: false,
      workspaceRoot: workspace
    },
    mcpBridge: {
      mode: "fixture",
      fixtureFile: "",
      fixtures: {
        "llm-db-prod-mcp.runDiagnosticQuery.triage": {
          used: true,
          summary: "diagnostic evidence found",
          blockers: [],
          shouldBlock: false,
          rows: []
        },
        "llm-db-prod-mcp.runDiagnosticQuery.execution": {
          used: true,
          summary: "diagnostic evidence found",
          blockers: ["pending db validation"],
          shouldBlock: true,
          rows: []
        },
        "llm-sql-db-mcp.recordHarnessRun": {
          runId: "diag-run-2",
          mode: "triage-and-execution",
          stored: true
        }
      },
      command: "",
      args: []
    },
    mockTickets: [
      {
        key: "LEG-502",
        projectKey: "LEG",
        summary: "Use diagnostics on demand",
        productTarget: "legacy",
        repoTarget: "core-app",
        contextMapping: {
          inScope: true,
          repoTarget: "core-app",
          feasibility: "feasible",
          confidence: 0.92,
          implementationHint: "Base implementation hint"
        },
        diagnostics: {
          triage: {
            query: "select * from triage_signals where ticket = :ticketKey"
          },
          execution: {
            query: "select * from execution_signals where ticket = :ticketKey"
          }
        }
      }
    ]
  };

  await writeFile(configPath, JSON.stringify(config, null, 2));

  const summary = await runHarness({
    configPath,
    modeOverride: "triage-and-execution",
    dryRunOverride: true
  });

  assert.match(summary.triage[0].implementation_hint, /diagnostic evidence found/);
  assert.equal(summary.execution[0].status, "blocked");
});
