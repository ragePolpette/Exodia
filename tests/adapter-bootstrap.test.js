import test from "node:test";
import assert from "node:assert/strict";

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
    execution: {
      baseBranch: "BPOFH",
      allowMerge: false
    },
    mockTickets: [],
    ...overrides
  };
}

test("adapter bootstrap selects mock adapters from explicit config", () => {
  const { adapters, kinds } = buildAdapters({
    config: createConfig(),
    logger: { debug() {} }
  });

  assert.equal(kinds.jira, "mock");
  assert.equal(adapters.jira.kind, "mock");
  assert.equal(adapters.llmContext.kind, "mock");
  assert.equal(adapters.llmMemory.kind, "mock");
  assert.equal(adapters.llmSqlDb.kind, "mock");
  assert.equal(adapters.bitbucket.kind, "mock");
});

test("adapter bootstrap registers mcp stubs when requested by config", () => {
  const { adapters, kinds } = buildAdapters({
    config: createConfig({
      adapters: {
        ...createConfig().adapters,
        jira: {
          kind: "mcp",
          mock: {
            ticketSource: "config.mockTickets"
          },
          mcp: {
            server: "jira-official",
            jql: "project = BPO"
          }
        },
        llmContext: {
          kind: "mcp",
          mock: {
            mappingSource: "ticket.contextMapping"
          },
          mcp: {
            server: "llm-context"
          }
        }
      }
    }),
    logger: { debug() {} }
  });

  assert.equal(kinds.jira, "mcp");
  assert.equal(kinds.llmContext, "mcp");
  assert.equal(adapters.jira.kind, "mcp");
  assert.equal(adapters.llmContext.kind, "mcp");
});
