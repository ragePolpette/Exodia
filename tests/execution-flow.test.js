import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { BitbucketAdapter } from "../src/adapters/bitbucket-adapter.js";
import { runHarness } from "../src/orchestration/run-harness.js";

async function runExecutionScenario({ mockTickets, existingMemory = [] }) {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "bpopilot-execution-"));
  const configPath = path.join(workspace, "harness.config.json");
  const memoryPath = path.join(workspace, "memory.json");
  const config = {
    mode: "triage-and-execution",
    dryRun: true,
    memory: {
      backend: "file",
      filePath: "./memory.json"
    },
    execution: {
      enabled: true,
      dryRun: true,
      baseBranch: "BPOFH",
      allowRealPrs: false,
      allowMerge: false,
      workspaceRoot: workspace
    },
    mockTickets
  };

  await writeFile(configPath, JSON.stringify(config, null, 2));
  await writeFile(memoryPath, JSON.stringify(existingMemory, null, 2));

  const summary = await runHarness({
    configPath,
    modeOverride: "triage-and-execution",
    dryRunOverride: true
  });

  const memory = JSON.parse(await readFile(memoryPath, "utf8"));
  return { summary, memory };
}

test("bitbucket adapter creates policy-compliant branch names", () => {
  const adapter = new BitbucketAdapter({ baseBranch: "BPOFH" });
  const branchName = adapter.planBranch({
    key: "BPO-321",
    summary: "Fix complex payment timeout bug"
  });

  assert.equal(branchName, "bpo-321-fix-complex-payment-timeout-bug");
});

test("dry-run mock execution stays on the safe mock path", async () => {
  const { summary } = await runExecutionScenario({
    mockTickets: [
      {
        key: "BPO-326",
        projectKey: "BPO",
        summary: "Dry run mock execution",
        repoTarget: "BPOFH",
        contextMapping: {
          inScope: true,
          repoTarget: "BPOFH",
          feasibility: "feasible",
          confidence: 0.93
        }
      }
    ]
  });

  assert.equal(summary.executionDryRun, true);
  assert.equal(summary.adapterKinds.bitbucket, "mock");
  assert.equal(summary.execution[0].status, "pr_opened");
});

test("execution skips feasible_low_confidence tickets", async () => {
  const { summary, memory } = await runExecutionScenario({
    mockTickets: [
      {
        key: "BPO-322",
        projectKey: "BPO",
        summary: "Low confidence mapping",
        repoTarget: "BPOFH",
        contextMapping: {
          inScope: true,
          repoTarget: "BPOFH",
          feasibility: "feasible_low_confidence",
          confidence: 0.51
        }
      }
    ]
  });

  assert.equal(summary.execution.length, 1);
  assert.equal(summary.execution[0].status, "skipped_low_confidence");
  assert.equal(memory[0].last_outcome, "skipped_low_confidence");
});

test("execution stops on blocked ticket without continuing to next item", async () => {
  const { summary, memory } = await runExecutionScenario({
    mockTickets: [
      {
        key: "BPO-323",
        projectKey: "BPO",
        summary: "Blocked by missing dependency",
        repoTarget: "BPOFH",
        contextMapping: {
          inScope: true,
          repoTarget: "BPOFH",
          feasibility: "blocked",
          blockers: ["missing test fixture"],
          confidence: 0.44
        }
      },
      {
        key: "BPO-324",
        projectKey: "BPO",
        summary: "Should never execute",
        repoTarget: "BPOFH",
        contextMapping: {
          inScope: true,
          repoTarget: "BPOFH",
          feasibility: "feasible",
          confidence: 0.93
        }
      }
    ]
  });

  assert.equal(summary.execution.length, 1);
  assert.equal(summary.execution[0].ticketKey, "BPO-323");
  assert.equal(summary.execution[0].status, "blocked");
  assert.equal(memory.find((item) => item.ticket_key === "BPO-324").last_outcome, "triaged");
});

test("execution creates a simulated pull request for feasible tickets", async () => {
  const { summary, memory } = await runExecutionScenario({
    mockTickets: [
      {
        key: "BPO-325",
        projectKey: "BPO",
        summary: "Create mock PR flow",
        repoTarget: "BPOFH",
        contextMapping: {
          inScope: true,
          repoTarget: "BPOFH",
          feasibility: "feasible",
          confidence: 0.95,
          implementationHint: "Update execution flow"
        }
      }
    ]
  });

  assert.equal(summary.execution.length, 1);
  assert.equal(summary.execution[0].status, "pr_opened");
  assert.match(summary.execution[0].pullRequestUrl, /^mock:\/\/pull-request\//);
  assert.equal(memory[0].pr_url, summary.execution[0].pullRequestUrl);
});

test("guardrail blocks real execution when bitbucket adapter is not mcp", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "bpopilot-execution-guard-"));
  const configPath = path.join(workspace, "harness.config.json");
  const config = {
    mode: "triage-and-execution",
    dryRun: false,
    memory: {
      backend: "file",
      filePath: "./memory.json"
    },
    execution: {
      enabled: true,
      dryRun: false,
      baseBranch: "BPOFH",
      allowRealPrs: true,
      allowMerge: false,
      workspaceRoot: workspace
    },
    mockTickets: [
      {
        key: "BPO-327",
        projectKey: "BPO",
        summary: "Should fail guardrail",
        repoTarget: "BPOFH",
        contextMapping: {
          inScope: true,
          repoTarget: "BPOFH",
          feasibility: "feasible",
          confidence: 0.95
        }
      }
    ]
  };

  await writeFile(configPath, JSON.stringify(config, null, 2));

  await assert.rejects(
    () =>
      runHarness({
        configPath,
        modeOverride: "triage-and-execution",
        dryRunOverride: false
      }),
    /Real execution requires adapters\.bitbucket\.kind = "mcp"/
  );
});

test("guardrail blocks real execution when allowRealPrs is false", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "bpopilot-execution-mcp-guard-"));
  const configPath = path.join(workspace, "harness.config.json");
  const config = {
    mode: "triage-and-execution",
    dryRun: false,
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
        kind: "mock",
        mock: { recordRuns: true },
        mcp: { server: "llm-sql-db-mcp" }
      },
      bitbucket: {
        kind: "mcp",
        mock: { workspaceRoot: workspace },
        mcp: {
          server: "llm-bitbucket-mcp",
          repository: "BPOFH",
          project: "BPO",
          workspaceRoot: workspace
        }
      }
    },
    execution: {
      enabled: true,
      dryRun: false,
      baseBranch: "BPOFH",
      allowRealPrs: false,
      allowMerge: false,
      workspaceRoot: workspace
    },
    mcpBridge: {
      mode: "fixture",
      fixtureFile: "",
      fixtures: {},
      command: "",
      args: []
    },
    mockTickets: [
      {
        key: "BPO-328",
        projectKey: "BPO",
        summary: "Should fail allowRealPrs guardrail",
        repoTarget: "BPOFH",
        contextMapping: {
          inScope: true,
          repoTarget: "BPOFH",
          feasibility: "feasible",
          confidence: 0.95
        }
      }
    ]
  };

  await writeFile(configPath, JSON.stringify(config, null, 2));

  await assert.rejects(
    () =>
      runHarness({
        configPath,
        modeOverride: "triage-and-execution",
        dryRunOverride: false
      }),
    /Real execution requires execution\.allowRealPrs = true/
  );
});

test("mcp execution can create branch, commit and pull request when config is coherent", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "bpopilot-execution-mcp-real-"));
  const configPath = path.join(workspace, "harness.config.json");
  const config = {
    mode: "triage-and-execution",
    dryRun: false,
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
        kind: "mock",
        mock: { recordRuns: true },
        mcp: { server: "llm-sql-db-mcp" }
      },
      bitbucket: {
        kind: "mcp",
        mock: { workspaceRoot: workspace },
        mcp: {
          server: "llm-bitbucket-mcp",
          repository: "BPOFH",
          project: "BPO",
          workspaceRoot: workspace
        }
      }
    },
    execution: {
      enabled: true,
      dryRun: false,
      baseBranch: "BPOFH",
      allowRealPrs: true,
      allowMerge: false,
      workspaceRoot: workspace
    },
    mcpBridge: {
      mode: "fixture",
      fixtureFile: "",
      fixtures: {
        "llm-bitbucket-mcp.createBranch": {
          branchName: "bpo-329-real-mcp-execution",
          baseBranch: "BPOFH"
        },
        "llm-bitbucket-mcp.checkoutBranch": {
          branchName: "bpo-329-real-mcp-execution",
          workspaceRoot: workspace
        },
        "llm-bitbucket-mcp.createCommit": {
          commitSha: "abc123"
        },
        "llm-bitbucket-mcp.openPullRequest": {
          title: "[BPO-329] Real MCP execution",
          link: "https://example.invalid/pr/329"
        }
      },
      command: "",
      args: []
    },
    mockTickets: [
      {
        key: "BPO-329",
        projectKey: "BPO",
        summary: "Real MCP execution",
        repoTarget: "BPOFH",
        contextMapping: {
          inScope: true,
          repoTarget: "BPOFH",
          feasibility: "feasible",
          confidence: 0.96
        }
      }
    ]
  };

  await writeFile(configPath, JSON.stringify(config, null, 2));

  const summary = await runHarness({
    configPath,
    modeOverride: "triage-and-execution",
    dryRunOverride: false
  });

  assert.equal(summary.adapterKinds.bitbucket, "mcp");
  assert.equal(summary.executionDryRun, false);
  assert.equal(summary.execution[0].status, "pr_opened");
  assert.equal(summary.execution[0].pullRequestUrl, "https://example.invalid/pr/329");
});
