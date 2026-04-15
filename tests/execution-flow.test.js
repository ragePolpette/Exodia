import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { BitbucketAdapter } from "../src/adapters/bitbucket-adapter.js";
import { runHarness } from "../src/orchestration/run-harness.js";

async function runExecutionScenario({ mockTickets, existingMemory = [] }) {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "exodia-execution-"));
  const configPath = path.join(workspace, "harness.config.json");
  const memoryPath = path.join(workspace, "memory.json");
  const normalizedMockTickets = mockTickets.map((ticket) => ({
    productTarget: ticket.productTarget ?? "legacy",
    ...ticket
  }));
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
      baseBranch: "main",
      allowRealPrs: false,
      allowMerge: false,
      workspaceRoot: workspace
    },
    mockTickets: normalizedMockTickets
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
  const adapter = new BitbucketAdapter({ baseBranch: "main" });
  const branchName = adapter.planBranch({
    key: "GEN-321",
    summary: "Fix complex payment timeout bug"
  });

  assert.equal(branchName, "gen-321-fix-complex-payment-timeout-bug");
});

test("dry-run mock execution stays on the safe mock path", async () => {
  const { summary } = await runExecutionScenario({
    mockTickets: [
      {
        key: "GEN-326",
        projectKey: "GEN",
        summary: "Dry run mock execution",
        repoTarget: "core-app",
        contextMapping: {
          inScope: true,
          repoTarget: "core-app",
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
        key: "GEN-322",
        projectKey: "GEN",
        summary: "Low confidence mapping",
        repoTarget: "core-app",
        contextMapping: {
          inScope: true,
          repoTarget: "core-app",
          feasibility: "feasible_low_confidence",
          confidence: 0.51
        }
      }
    ]
  });

  assert.equal(summary.verification.length, 1);
  assert.equal(summary.verification[0].status, "needs_review");
  assert.equal(summary.execution.length, 0);
  assert.equal(memory[0].last_outcome, "triaged");
});

test("verification blocks a blocked ticket while allowing later approved execution", async () => {
  const { summary, memory } = await runExecutionScenario({
    mockTickets: [
      {
        key: "GEN-323",
        projectKey: "GEN",
        summary: "Blocked by missing dependency",
        repoTarget: "core-app",
        contextMapping: {
          inScope: true,
          repoTarget: "core-app",
          feasibility: "blocked",
          blockers: ["missing test fixture"],
          confidence: 0.44
        }
      },
      {
        key: "GEN-324",
        projectKey: "GEN",
        summary: "Should never execute",
        repoTarget: "core-app",
        contextMapping: {
          inScope: true,
          repoTarget: "core-app",
          feasibility: "feasible",
          confidence: 0.93
        }
      }
    ]
  });

  assert.equal(summary.verification.length, 2);
  assert.equal(summary.verification[0].ticketKey, "GEN-323");
  assert.equal(summary.verification[0].status, "blocked");
  assert.equal(summary.execution.length, 1);
  assert.equal(summary.execution[0].ticketKey, "GEN-324");
  assert.equal(summary.execution[0].status, "pr_opened");
  assert.equal(memory.find((item) => item.ticket_key === "GEN-323").last_outcome, "blocked");
  assert.equal(memory.find((item) => item.ticket_key === "GEN-324").last_outcome, "pr_opened");
});

test("execution creates a simulated pull request for feasible tickets", async () => {
  const { summary, memory } = await runExecutionScenario({
    mockTickets: [
      {
        key: "GEN-325",
        projectKey: "GEN",
        summary: "Create mock PR flow",
        repoTarget: "core-app",
        contextMapping: {
          inScope: true,
          repoTarget: "core-app",
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

test("verification blocks execution when explicit ticket target conflicts with triage target", async () => {
  const { summary, memory } = await runExecutionScenario({
    mockTickets: [
      {
        key: "GEN-326A",
        projectKey: "GEN",
        summary: "Conflicting explicit target",
        productTarget: "public-app",
        repoTarget: "public-web",
        contextMapping: {
          inScope: true,
          productTarget: "legacy",
          repoTarget: "core-app",
          feasibility: "feasible",
          confidence: 0.94
        }
      }
    ]
  });

  assert.equal(summary.verification.length, 1);
  assert.equal(summary.verification[0].status, "needs_review");
  assert.match(summary.verification[0].reason, /conflicts with triage target/i);
  assert.equal(summary.execution.length, 0);
  assert.equal(memory[0].last_outcome, "triaged");
});

test("verification blocks execution when commit payload is not single-line safe", async () => {
  const { summary } = await runExecutionScenario({
    mockTickets: [
      {
        key: "GEN-326B",
        projectKey: "GEN",
        summary: "Unsafe summary\nwith newline",
        repoTarget: "core-app",
        contextMapping: {
          inScope: true,
          productTarget: "legacy",
          repoTarget: "core-app",
          feasibility: "feasible",
          confidence: 0.95
        }
      }
    ]
  });

  assert.equal(summary.verification.length, 1);
  assert.equal(summary.verification[0].status, "blocked");
  assert.match(summary.verification[0].reason, /commit message must stay on a single line/i);
  assert.equal(summary.execution.length, 0);
});

test("guardrail blocks real execution when bitbucket adapter is not mcp", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "exodia-execution-guard-"));
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
      trustLevel: "mcp-write",
      baseBranch: "main",
      allowRealPrs: true,
      allowMerge: false,
      workspaceRoot: workspace
    },
    mockTickets: [
      {
        key: "GEN-327",
        projectKey: "GEN",
        summary: "Should fail guardrail",
        productTarget: "legacy",
        repoTarget: "core-app",
        contextMapping: {
          inScope: true,
          repoTarget: "core-app",
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
  const workspace = await mkdtemp(path.join(os.tmpdir(), "exodia-execution-mcp-guard-"));
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
        mcp: { server: "atlassian_rovo_mcp" }
      },
      llmContext: {
        kind: "mock",
        mock: { mappingSource: "ticket.contextMapping" },
        mcp: { server: "llm_context" }
      },
      llmMemory: {
        kind: "mock",
        mock: { backend: "file" },
        mcp: { server: "llm_memory" }
      },
      llmSqlDb: {
        kind: "mock",
        mock: { recordRuns: true },
        mcp: { server: "llm_db_prod_mcp" }
      },
      bitbucket: {
        kind: "mcp",
        mock: { workspaceRoot: workspace },
        mcp: {
          server: "llm_bitbucket_mcp",
          repository: "core-app",
          project: "GEN",
          workspaceRoot: workspace,
          operations: {
            findOpenPullRequest: {
              action: "findOpenPullRequest",
              enabled: true
            }
          }
        }
      }
    },
    execution: {
      enabled: true,
      dryRun: false,
      baseBranch: "main",
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
        key: "GEN-328",
        projectKey: "GEN",
        summary: "Should fail allowRealPrs guardrail",
        productTarget: "legacy",
        repoTarget: "core-app",
        contextMapping: {
          inScope: true,
          repoTarget: "core-app",
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

test("guardrail blocks MCP dry-run when trust level stays on mock", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "exodia-execution-trust-guard-"));
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
        mcp: { server: "atlassian_rovo_mcp" }
      },
      llmContext: {
        kind: "mock",
        mock: { mappingSource: "ticket.contextMapping" },
        mcp: { server: "llm_context" }
      },
      llmMemory: {
        kind: "mock",
        mock: { backend: "file" },
        mcp: { server: "llm_memory" }
      },
      llmSqlDb: {
        kind: "mock",
        mock: { recordRuns: true },
        mcp: { server: "llm_db_prod_mcp" }
      },
      bitbucket: {
        kind: "mcp",
        mock: { workspaceRoot: workspace },
        mcp: {
          server: "llm_bitbucket_mcp",
          repository: "your-repository",
          project: "YOUR_PROJECT",
          workspaceRoot: workspace
        }
      }
    },
    execution: {
      enabled: true,
      dryRun: true,
      trustLevel: "mock",
      baseBranch: "main",
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
    mockTickets: []
  };

  await writeFile(configPath, JSON.stringify(config, null, 2));

  await assert.rejects(
    () =>
      runHarness({
        configPath,
        modeOverride: "triage-and-execution",
        dryRunOverride: true
      }),
    /MCP dry-run requires execution\.trustLevel/
  );
});

test("guardrail blocks execution when repository is outside the allowlist", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "exodia-execution-repo-policy-"));
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
        mcp: { server: "atlassian_rovo_mcp" }
      },
      llmContext: {
        kind: "mock",
        mock: { mappingSource: "ticket.contextMapping" },
        mcp: { server: "llm_context" }
      },
      llmMemory: {
        kind: "mock",
        mock: { backend: "file" },
        mcp: { server: "llm_memory" }
      },
      llmSqlDb: {
        kind: "mock",
        mock: { recordRuns: true },
        mcp: { server: "llm_db_prod_mcp" }
      },
      bitbucket: {
        kind: "mcp",
        mock: { workspaceRoot: workspace },
        mcp: {
          server: "llm_bitbucket_mcp",
          repository: "your-repository",
          project: "YOUR_PROJECT",
          workspaceRoot: workspace
        }
      }
    },
    execution: {
      enabled: true,
      dryRun: false,
      trustLevel: "mcp-write",
      baseBranch: "main",
      allowRealPrs: true,
      allowMerge: false,
      allowedRepositories: ["different-repository"],
      allowedBaseBranches: ["main"],
      workspaceRoot: workspace
    },
    mcpBridge: {
      mode: "fixture",
      fixtureFile: "",
      fixtures: {},
      command: "",
      args: []
    },
    mockTickets: []
  };

  await writeFile(configPath, JSON.stringify(config, null, 2));

  await assert.rejects(
    () =>
      runHarness({
        configPath,
        modeOverride: "triage-and-execution",
        dryRunOverride: false
      }),
    /repository is not allowed by execution policy/i
  );
});

test("mcp execution can create branch, commit and pull request when config is coherent", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "exodia-execution-mcp-real-"));
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
        mcp: { server: "atlassian_rovo_mcp" }
      },
      llmContext: {
        kind: "mock",
        mock: { mappingSource: "ticket.contextMapping" },
        mcp: { server: "llm_context" }
      },
      llmMemory: {
        kind: "mock",
        mock: { backend: "file" },
        mcp: { server: "llm_memory" }
      },
      llmSqlDb: {
        kind: "mock",
        mock: { recordRuns: true },
        mcp: { server: "llm_db_prod_mcp" }
      },
      bitbucket: {
        kind: "mcp",
        mock: { workspaceRoot: workspace },
        mcp: {
          server: "llm_bitbucket_mcp",
          repository: "core-app",
          project: "GEN",
          workspaceRoot: workspace,
          operations: {
            findOpenPullRequest: {
              action: "findOpenPullRequest",
              enabled: true
            }
          }
        }
      }
    },
    execution: {
      enabled: true,
      dryRun: false,
      baseBranch: "main",
      allowRealPrs: true,
      allowMerge: false,
      workspaceRoot: workspace
    },
    mcpBridge: {
      mode: "fixture",
      fixtureFile: "",
      fixtures: {
        "llm_bitbucket_mcp.findOpenPullRequest": null,
        "llm_bitbucket_mcp.createBranch": {
          branchName: "gen-329-real-mcp-execution",
          baseBranch: "main"
        },
        "llm_bitbucket_mcp.checkoutBranch": {
          branchName: "gen-329-real-mcp-execution",
          workspaceRoot: workspace
        },
        "llm_bitbucket_mcp.createCommit": {
          commitSha: "abc123"
        },
        "llm_bitbucket_mcp.openPullRequest": {
          title: "[GEN-329] Real MCP execution",
          link: "https://example.invalid/pr/329"
        }
      },
      command: "",
      args: []
    },
    mockTickets: [
      {
        key: "GEN-329",
        projectKey: "GEN",
        summary: "Real MCP execution",
        productTarget: "legacy",
        repoTarget: "core-app",
        contextMapping: {
          inScope: true,
          repoTarget: "core-app",
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

test("execution reuses an already open pull request when found in bitbucket", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "exodia-execution-existing-pr-"));
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
        mcp: { server: "atlassian_rovo_mcp" }
      },
      llmContext: {
        kind: "mock",
        mock: { mappingSource: "ticket.contextMapping" },
        mcp: { server: "llm_context" }
      },
      llmMemory: {
        kind: "mock",
        mock: { backend: "file" },
        mcp: { server: "llm_memory" }
      },
      llmSqlDb: {
        kind: "mock",
        mock: { recordRuns: true },
        mcp: { server: "llm_db_prod_mcp" }
      },
      bitbucket: {
        kind: "mcp",
        mock: { workspaceRoot: workspace },
        mcp: {
          server: "llm_bitbucket_mcp",
          repository: "core-app",
          project: "GEN",
          workspaceRoot: workspace,
          operations: {
            findOpenPullRequest: {
              action: "findOpenPullRequest",
              enabled: true
            }
          }
        }
      }
    },
    execution: {
      enabled: true,
      dryRun: false,
      baseBranch: "main",
      allowRealPrs: true,
      allowMerge: false,
      workspaceRoot: workspace
    },
    mcpBridge: {
      mode: "fixture",
      fixtureFile: "",
      fixtures: {
        "llm_bitbucket_mcp.findOpenPullRequest": {
          pullRequest: {
            title: "[GEN-330] Existing pull request",
            link: "https://example.invalid/pr/330",
            sourceBranch: "gen-330-reuse-existing-pr"
          }
        }
      },
      command: "",
      args: []
    },
    mockTickets: [
      {
        key: "GEN-330",
        projectKey: "GEN",
        summary: "Reuse existing PR",
        productTarget: "legacy",
        repoTarget: "core-app",
        contextMapping: {
          inScope: true,
          repoTarget: "core-app",
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

  assert.equal(summary.execution[0].status, "pr_opened");
  assert.equal(summary.execution[0].pullRequestUrl, "https://example.invalid/pr/330");
  assert.match(summary.execution[0].reason, /already open pull request/i);
});

test("run summary includes a readable audit trail", async () => {
  const { summary } = await runExecutionScenario({
    mockTickets: [
      {
        key: "GEN-331",
        projectKey: "GEN",
        summary: "Audit trail sample",
        repoTarget: "core-app",
        contextMapping: {
          inScope: true,
          repoTarget: "core-app",
          feasibility: "feasible",
          confidence: 0.95
        }
      }
    ]
  });

  assert.ok(Array.isArray(summary.auditTrail));
  assert.ok(summary.auditTrail.length >= 4);
  assert.equal(summary.auditTrail[0].phase, "run");
  assert.match(summary.finalReport, /Exodia Final Report/);
});
