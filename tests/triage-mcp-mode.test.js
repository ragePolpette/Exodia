import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { runHarness } from "../src/orchestration/run-harness.js";

test("triage works in mcp mode through the configured bridge client", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "legacy-suite-triage-mcp-"));
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
        mock: {
          ticketSource: "config.mockTickets"
        },
        mcp: {
          server: "jira-official",
          jql: "project = LEG"
        }
      },
      llmContext: {
        kind: "mcp",
        mock: {
          mappingSource: "ticket.contextMapping"
        },
        mcp: {
          server: "llm-context",
          workspaceRoot: "C:\\path\\to\\your\\workspace"
        }
      },
      llmMemory: {
        kind: "mcp",
        mock: {
          backend: "file"
        },
        mcp: {
          server: "llm-memory",
          namespace: "malkuth-ticket-harness"
        }
      },
      llmSqlDb: {
        kind: "mock",
        mock: {
          recordRuns: true
        },
        mcp: {
          server: "llm-sql-db-mcp"
        }
      },
      bitbucket: {
        kind: "mock",
        mock: {
          workspaceRoot: ""
        },
        mcp: {
          server: "llm-bitbucket-mcp"
        }
      }
    },
    execution: {
      baseBranch: "main",
      allowRealPrs: false,
      allowMerge: false
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
          projectKeys: ["LEG"]
        }
      ]
    },
    mcpBridge: {
      mode: "fixture",
      fixtureFile: "",
      fixtures: {
        "jira-official.searchTicketsByJql": {
          "tickets": [
            {
              "key": "LEG-401",
              "projectKey": "LEG",
              "summary": "Fetch real triage candidates"
            }
          ]
        },
        "llm-context.mapTicketToCodebase": {
          "repoTarget": "core-app",
          "area": "core-platform",
          "inScope": true,
          "feasibility": "feasible",
          "confidence": 0.88,
          "implementationHint": "Inspect core platform code"
        },
        "llm-memory.captureInferenceMemory": {
          "stored": true,
          "source": "fixture"
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
  assert.equal(summary.triage.length, 1);
  assert.equal(summary.triage[0].status_decision, "feasible");
  assert.equal(summary.resumeStats.memoryRecordsAfter, 1);
});

test("triage mcp mode supports Jira filter-based lookup through bridge translation", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "malkuth-triage-filter-"));
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
        mock: {
          ticketSource: "config.mockTickets"
        },
        mcp: {
          server: "jira-official",
          filterId: "12345"
        }
      },
      llmContext: {
        kind: "mcp",
        mock: {
          mappingSource: "ticket.contextMapping"
        },
        mcp: {
          server: "llm-context",
          workspaceRoot: "C:\\path\\to\\your\\workspace"
        }
      },
      llmMemory: {
        kind: "mcp",
        mock: {
          backend: "file"
        },
        mcp: {
          server: "llm-memory",
          namespace: "malkuth"
        }
      },
      llmSqlDb: {
        kind: "mock",
        mock: {
          recordRuns: true
        },
        mcp: {
          server: "llm-sql-db-mcp"
        }
      },
      bitbucket: {
        kind: "mock",
        mock: {
          workspaceRoot: ""
        },
        mcp: {
          server: "llm-bitbucket-mcp"
        }
      }
    },
    execution: {
      baseBranch: "main",
      allowRealPrs: false,
      allowMerge: false
    },
    mcpBridge: {
      mode: "fixture",
      fixtureFile: "",
      fixtures: {
        "jira-official.searchTicketsByFilter": {
          "tickets": [
            {
              "key": "GEN-402",
              "projectKey": "GEN",
              "summary": "Fetch triage candidates from filter"
            }
          ]
        },
        "llm-context.mapTicketToCodebase": {
          "repoTarget": "core-app",
          "area": "core-platform",
          "inScope": true,
          "feasibility": "feasible",
          "confidence": 0.88,
          "implementationHint": "Inspect core platform code"
        },
        "llm-memory.captureInferenceMemory": {
          "stored": true,
          "source": "fixture"
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

  assert.equal(summary.triage.length, 1);
  assert.equal(summary.triage[0].ticket_key, "GEN-402");
  assert.equal(summary.triage[0].status_decision, "feasible");
});
