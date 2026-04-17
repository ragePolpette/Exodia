import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runHarness } from "../src/orchestration/run-harness.js";

test("mcp run falls back locally when llm-context, llm-memory and sql-db are unavailable", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "exodia-mcp-fallback-"));
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
        mcp: {
          server: "jira-official",
          jql: "project = GEN"
        }
      },
      llmContext: {
        kind: "mcp",
        mock: { mappingSource: "ticket.contextMapping" },
        mcp: {
          server: "llm-context",
          workspaceRoot: workspace,
          fallbackToMockOnError: true
        }
      },
      llmMemory: {
        kind: "mcp",
        mock: { backend: "file" },
        mcp: {
          server: "llm-memory",
          namespace: "exodia-fallback",
          fallbackToMockOnError: true
        }
      },
      llmSqlDb: {
        kind: "mcp",
        mock: { recordRuns: true },
        mcp: {
          server: "llm-sql-db-mcp",
          enabled: true,
          namespace: "exodia-fallback",
          fallbackToMockOnError: true,
          operations: {
            recordRun: {
              server: "llm-db-dev-mcp",
              action: "recordHarnessRun",
              enabled: true,
              database: "dev",
              sql: "insert into harness_runs(run_id, mode) values (@runId, @mode)"
            }
          }
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
    targeting: {
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
    },
    mcpBridge: {
      mode: "fixture",
      fixtureFile: "",
      fixtures: {
        "jira-official.searchTicketsByJql": {
          tickets: [
            {
              key: "GEN-701",
              projectKey: "GEN",
              summary: "Fallback path test"
            }
          ]
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

  assert.equal(summary.adapterKinds.jira, "mcp");
  assert.equal(summary.adapterKinds.llmContext, "mcp");
  assert.equal(summary.adapterKinds.llmMemory, "mcp");
  assert.equal(summary.adapterKinds.llmSqlDb, "mcp");
  assert.equal(summary.triage.length, 1);
  assert.equal(summary.triage[0].product_target, "legacy");
  assert.equal(summary.triage[0].status_decision, "feasible");
  assert.equal(summary.recordedRunId.startsWith("run-"), true);
  assert.match(summary.auditTrail.at(-1).message, /run record handled/i);
});