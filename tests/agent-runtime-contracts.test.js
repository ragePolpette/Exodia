import test from "node:test";
import assert from "node:assert/strict";

import { buildAgentRuntime } from "../src/agent-runtime/build-agent-runtime.js";
import { normalizeAgentRuntimeConfig } from "../src/agent-runtime/agent-runtime-contracts.js";
import { buildAdapters } from "../src/adapters/bootstrap-adapters.js";

function createConfig(overrides = {}) {
  return {
    mode: "triage-only",
    dryRun: true,
    memory: {
      backend: "file",
      filePath: "C:\\temp\\memory.json"
    },
    adapters: {
      jira: {
        kind: "mock",
        mock: {
          ticketSource: "config.mockTickets"
        },
        mcp: {
          server: "jira-official"
        }
      },
      llmContext: {
        kind: "mock",
        mock: {
          mappingSource: "ticket.contextMapping"
        },
        mcp: {
          server: "llm-context"
        }
      },
      llmMemory: {
        kind: "mock",
        mock: {
          backend: "file"
        },
        mcp: {
          server: "llm-memory"
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
    agentRuntime: {
      enabled: true,
      provider: "mock",
      enabledPhases: ["analysis", "audit"],
      implementation: {
        maxVerificationLoops: 4
      },
      providers: {
        mock: {}
      }
    },
    execution: {
      baseBranch: "main",
      allowMerge: false
    },
    mcpBridge: {
      mode: "fixture",
      fixtures: {},
      fixtureFile: "",
      command: "",
      args: [],
      allowedActionsByServer: {}
    },
    mockTickets: [],
    ...overrides
  };
}

test("agent runtime config normalization provides provider defaults", () => {
  const normalized = normalizeAgentRuntimeConfig({
    enabled: true,
    provider: "codex-cli",
    providers: {
      "codex-cli": {
        command: "codex-dev",
        args: ["run"]
      }
    }
  });

  assert.equal(normalized.provider, "codex-cli");
  assert.deepEqual(normalized.enabledPhases, ["analysis", "audit", "implementation"]);
  assert.equal(normalized.providers["codex-cli"].command, "codex-dev");
  assert.equal(normalized.audit.maxRefinementIterations, 2);
  assert.equal(normalized.implementation.maxVerificationLoops, 3);
});

test("mock agent runtime returns structured analysis output", async () => {
  const runtime = buildAgentRuntime(
    {
      enabled: true,
      provider: "mock",
      enabledPhases: ["analysis"],
      implementation: {
        maxVerificationLoops: 5
      }
    },
    { debug() {} }
  );

  const result = await runtime.analyzeTicket({
    ticket: {
      key: "DEVFH-1",
      summary: "Portal login fails after password reset"
    },
    mapping: {
      productTarget: "public-app",
      repoTarget: "public-web",
      area: "auth",
      feasibility: "feasible",
      confidence: 0.84
    }
  });

  assert.equal(result.phase, "analysis");
  assert.equal(result.status, "proposal_ready");
  assert.equal(result.productTarget, "public-app");
  assert.equal(result.repoTarget, "public-web");
  assert.equal(result.verificationPlan.maxVerificationLoops, 5);
  assert.equal(result.questions.length, 0);
});

test("adapter bootstrap returns an agent runtime instance", () => {
  const { agentRuntime } = buildAdapters({
    config: createConfig(),
    logger: { debug() {} }
  });

  assert.equal(agentRuntime.provider, "mock");
  assert.equal(agentRuntime.isPhaseEnabled("analysis"), true);
  assert.equal(agentRuntime.isPhaseEnabled("implementation"), false);
});
