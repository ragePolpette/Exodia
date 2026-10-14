import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { ExecutionAgent } from "../src/agents/execution-agent.js";
import { VerificationService } from "../src/verification/verification-service.js";

const execFileAsync = promisify(execFile);

async function createGitWorkspace() {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "exodia-lifecycle-"));
  const git = (args) =>
    execFileAsync("git", ["-c", "user.email=exodia@example.invalid", "-c", "user.name=Exodia", ...args], {
      cwd: workspace,
      windowsHide: true
    });
  await git(["init"]);
  await mkdir(path.join(workspace, "src"));
  await writeFile(path.join(workspace, "src", "app.js"), "export const value = 1;\n");
  await git(["add", "-A"]);
  await git(["commit", "-m", "seed"]);
  return workspace;
}

function createBitbucketAdapter({ commitResult = { commitSha: "abc123" }, workspaceRoot = "" } = {}) {
  const operations = [];
  return {
    operations,
    kind: "mcp",
    baseBranch: "main",
    workspaceRoot,
    planBranch: (ticket) => `fix/${ticket.key}-lifecycle`,
    async assertNoMergePolicy() {},
    async findOpenPullRequest() {
      return null;
    },
    async checkoutBranch(ticket, branchName) {
      operations.push(`checkout:${branchName}`);
    },
    async createBranch(ticket, branchName) {
      operations.push(`create:${branchName}`);
    },
    async createCommit(ticket, branchName, commitMessage, options) {
      operations.push({ commit: branchName, allowedPaths: options?.allowedPaths ?? null });
      return commitResult;
    },
    async pushBranch(ticket, branchName) {
      operations.push(`push:${branchName}`);
    },
    async openPullRequest(ticket, branchName, commitResult, options) {
      operations.push(`open_pr:${branchName}`);
      return { link: `https://example.invalid/pr/${ticket.key}`, title: ticket.summary, description: options.description };
    },
    async resetWorkspace(ticket, branchName) {
      operations.push(`reset:${branchName}`);
    }
  };
}

function createRuntime({ provider = "mock", implement } = {}) {
  const calls = [];
  return {
    calls,
    provider,
    config: { implementation: { maxVerificationLoops: 1 } },
    isPhaseEnabled: (phase) => Boolean(implement) && phase === "implementation",
    async implementPlan(input) {
      calls.push(input);
      return implement(input);
    }
  };
}

function createAgent({
  bitbucketAdapter,
  workspaceRoot,
  dryRun = false,
  verificationConfig = {
    allowedPathPrefixesByRepo: { "core-app": ["src"] },
    allowedCommandPrefixes: [["npm", "test"]]
  },
  agentRuntime = createRuntime()
}) {
  const memoryWrites = [];
  return {
    memoryWrites,
    agent: new ExecutionAgent({
      bitbucketAdapter,
      jiraAdapter: {},
      ticketMemoryAdapter: { upsertRecords: async (records) => memoryWrites.push(...records) },
      semanticMemoryAdapter: {},
      sqlDbAdapter: {},
      executionConfig: {
        enabled: true,
        dryRun,
        trustLevel: dryRun ? "mcp-readonly" : "mcp-write",
        allowRealPrs: true,
        baseBranch: "main",
        workspaceRoot,
        reuseOpenPullRequests: false
      },
      verificationConfig,
      agentRuntime,
      analysisArtifactStore: { list: async () => [] },
      implementationArtifactStore: { upsertArtifacts: async () => {} },
      logger: { info() {}, warn() {}, debug() {}, error() {} },
      securityConfig: {},
      runtimePromptConfig: {}
    })
  };
}

function buildItem(key, repoTarget = "core-app") {
  return {
    ticket: { key, projectKey: "GEN", summary: `Lifecycle ${key}`, productTarget: "legacy", repoTarget },
    decision: {
      ticket_key: key,
      project_key: "GEN",
      product_target: "legacy",
      repo_target: repoTarget,
      status_decision: "feasible",
      confidence: 0.95,
      short_reason: "ready",
      implementation_hint: ""
    },
    verification: { status: "approved" }
  };
}

const prompts = { implementationPrompt: "", implementationVerificationPrompt: "" };

test("execution refuses to run without an explicit workspace root", async () => {
  const bitbucketAdapter = createBitbucketAdapter();
  const { agent } = createAgent({ bitbucketAdapter, workspaceRoot: "" });

  await assert.rejects(agent.run([buildItem("GEN-1")]), /never falls back to the current directory/);
  assert.deepEqual(bitbucketAdapter.operations, []);
});

test("real execution is blocked before touching git when the repository has no path allowlist", async () => {
  const workspace = await createGitWorkspace();
  const bitbucketAdapter = createBitbucketAdapter();
  const { agent } = createAgent({ bitbucketAdapter, workspaceRoot: workspace });

  const result = await agent.executeItem(buildItem("GEN-2", "unlisted-repo"), prompts, "real", new Map());

  assert.equal(result.status, "blocked");
  assert.match(result.reason, /no allowedPathPrefixesByRepo entry for unlisted-repo/);
  assert.deepEqual(bitbucketAdapter.operations, []);
});

test("a skipped commit fails the ticket, resets the worktree and never opens an empty pull request", async () => {
  const workspace = await createGitWorkspace();
  const bitbucketAdapter = createBitbucketAdapter({ commitResult: { commitSha: "head", skipped: true } });
  const { agent } = createAgent({ bitbucketAdapter, workspaceRoot: workspace });

  const result = await agent.executeItem(buildItem("GEN-3"), prompts, "real", new Map());

  assert.equal(result.status, "failed");
  assert.match(result.reason, /no changes inside the allowed paths/);
  assert.equal(result.workspaceReset, "done");
  assert.deepEqual(bitbucketAdapter.operations.at(-1), "reset:fix/GEN-3-lifecycle");
  assert.ok(!bitbucketAdapter.operations.some((op) => `${op}`.startsWith("push:") || `${op}`.startsWith("open_pr:")));
  assert.deepEqual(
    bitbucketAdapter.operations.find((op) => typeof op === "object"),
    { commit: "fix/GEN-3-lifecycle", allowedPaths: ["src"] }
  );
});

test("a failed implementation resets only the ticket worktree", async () => {
  const workspace = await createGitWorkspace();
  const bitbucketAdapter = createBitbucketAdapter();
  const { agent } = createAgent({
    bitbucketAdapter,
    workspaceRoot: workspace,
    agentRuntime: createRuntime({
      implement: () => ({ status: "failed", summary: "tests keep failing", changedFiles: [], failureKind: "runtime_failed" })
    })
  });

  const result = await agent.executeItem(buildItem("GEN-4"), prompts, "real", new Map());

  assert.equal(result.status, "failed");
  assert.equal(bitbucketAdapter.operations.at(-1), "reset:fix/GEN-4-lifecycle");
});

test("the diff gate blocks oversized changes and reports the diff stat", async () => {
  const workspace = await createGitWorkspace();
  await writeFile(path.join(workspace, "src", "app.js"), "export const value = 2;\n");
  await writeFile(path.join(workspace, "src", "extra.js"), "export const extra = true;\n");
  const bitbucketAdapter = createBitbucketAdapter();
  const { agent } = createAgent({
    bitbucketAdapter,
    workspaceRoot: workspace,
    verificationConfig: {
      allowedPathPrefixesByRepo: { "core-app": ["src"] },
      allowedCommandPrefixes: [["npm", "test"]],
      diffGate: { maxFiles: 1, maxChangedLines: 100 }
    }
  });

  const result = await agent.executeItem(buildItem("GEN-5"), prompts, "real", new Map());

  assert.equal(result.status, "blocked");
  assert.match(result.reason, /diff gate: 2 changed files exceed the limit of 1/);
  assert.match(result.diffStat, /src\/app\.js/);
  assert.match(result.diffStat, /src\/extra\.js \| 1 \+ \(new file\)/);
  assert.equal(bitbucketAdapter.operations.at(-1), "reset:fix/GEN-5-lifecycle");
});

test("the diff gate enforces the changed line limit", async () => {
  const workspace = await createGitWorkspace();
  await writeFile(path.join(workspace, "src", "app.js"), "a\nb\nc\nd\n");
  const service = new VerificationService({ diffGate: { maxFiles: 10, maxChangedLines: 3 } });

  const gate = await service.enforceDiffGate({
    item: buildItem("GEN-6"),
    workspaceRoot: workspace,
    payload: {},
    executionMode: "real"
  });

  assert.equal(gate.result.status, "blocked");
  assert.match(gate.result.reason, /5 changed lines exceed the limit of 3/);
});

test("successful real execution includes the diff stat in the result and pull request", async () => {
  const workspace = await createGitWorkspace();
  await writeFile(path.join(workspace, "src", "app.js"), "export const value = 3;\n");
  const bitbucketAdapter = createBitbucketAdapter();
  const { agent } = createAgent({ bitbucketAdapter, workspaceRoot: workspace });

  const result = await agent.executeItem(buildItem("GEN-7"), prompts, "real", new Map());

  assert.equal(result.status, "pr_opened");
  assert.match(result.diffStat, /1 file\(s\) changed, 2 line\(s\) changed/);
  assert.match(result.pullRequestDescription, /Diff stat:/);
});

test("real execution requires a non-empty preflight command allowlist", async () => {
  const workspace = await createGitWorkspace();
  await writeFile(path.join(workspace, "src", "app.js"), "export const value = 4;\n");
  const bitbucketAdapter = createBitbucketAdapter();
  const { agent } = createAgent({
    bitbucketAdapter,
    workspaceRoot: workspace,
    verificationConfig: { allowedPathPrefixesByRepo: { "core-app": ["src"] }, allowedCommandPrefixes: [] }
  });

  const result = await agent.executeItem(buildItem("GEN-8"), prompts, "real", new Map());

  assert.equal(result.status, "blocked");
  assert.match(result.reason, /non-empty verification\.allowedCommandPrefixes/);
});

test("preflight commands are killed after their timeout", async () => {
  const workspace = await createGitWorkspace();
  const service = new VerificationService({
    allowedPathPrefixesByRepo: { "core-app": ["src"] },
    allowedCommandPrefixes: [[process.execPath]],
    preflightCommands: [
      { label: "slow-check", command: process.execPath, args: ["-e", "setTimeout(() => {}, 10000)"], timeoutMs: 200 }
    ]
  });

  const result = await service.runPreflight({ item: buildItem("GEN-9"), workspaceRoot: workspace, payload: {} });

  assert.equal(result.status, "blocked");
  assert.match(result.reason, /timed out \(slow-check\)/);
});

test("preflight command output is bounded by maxBuffer", async () => {
  const workspace = await createGitWorkspace();
  const service = new VerificationService({
    allowedPathPrefixesByRepo: { "core-app": ["src"] },
    allowedCommandPrefixes: [[process.execPath]],
    preflightMaxBufferBytes: 1024,
    preflightCommands: [
      { label: "noisy-check", command: process.execPath, args: ["-e", "process.stdout.write('x'.repeat(100000))"] }
    ]
  });

  const result = await service.runPreflight({ item: buildItem("GEN-10"), workspaceRoot: workspace, payload: {} });

  assert.equal(result.status, "blocked");
  assert.match(result.reason, /exceeded the output limit \(noisy-check\)/);
});

test("dry-run skips implementation for runtimes that could write to the worktree", async () => {
  const workspace = await createGitWorkspace();
  const runtime = createRuntime({
    provider: "codex-cli",
    implement: () => ({ status: "completed", summary: "would write", changedFiles: ["src/app.js"] })
  });
  const bitbucketAdapter = createBitbucketAdapter();
  const { agent } = createAgent({ bitbucketAdapter, workspaceRoot: workspace, dryRun: true, agentRuntime: runtime });

  const result = await agent.executeItem(buildItem("GEN-11"), prompts, "dry-run-mcp", new Map());

  assert.equal(runtime.calls.length, 0);
  assert.equal(result.implementationStatus, "skipped_dry_run");
  assert.equal(result.status, "dry_run_planned");
  assert.ok(!bitbucketAdapter.operations.some((op) => `${op}`.startsWith("reset:")));
});

test("a failed or blocked ticket does not stop the rest of the queue", async () => {
  const workspace = await createGitWorkspace();
  await writeFile(path.join(workspace, "src", "app.js"), "export const value = 12;\n");
  const bitbucketAdapter = createBitbucketAdapter();
  const { agent, memoryWrites } = createAgent({ bitbucketAdapter, workspaceRoot: workspace });

  const results = await agent.run([buildItem("GEN-12", "unlisted-repo"), buildItem("GEN-13")]);

  assert.deepEqual(results.map((result) => result.status), ["blocked", "pr_opened"]);
  assert.deepEqual(memoryWrites.map((record) => record.last_outcome), ["blocked", "pr_opened"]);
});

test("an unexpected error in one ticket is reported as failed and the queue continues", async () => {
  const workspace = await createGitWorkspace();
  await writeFile(path.join(workspace, "src", "app.js"), "export const value = 14;\n");
  const bitbucketAdapter = createBitbucketAdapter();
  const originalCreateBranch = bitbucketAdapter.createBranch;
  bitbucketAdapter.createBranch = async (ticket, branchName) => {
    if (ticket.key === "GEN-14") {
      throw new Error("worktree is dirty");
    }
    return originalCreateBranch(ticket, branchName);
  };
  const { agent } = createAgent({ bitbucketAdapter, workspaceRoot: workspace });

  const results = await agent.run([buildItem("GEN-14"), buildItem("GEN-15")]);

  assert.equal(results[0].status, "failed");
  assert.match(results[0].reason, /worktree is dirty/);
  assert.equal(results[1].status, "pr_opened");
});

test("the execution report lists the diff stat of each ticket", async () => {
  const { renderExecutionReport } = await import("../src/execution/render-execution-report.js");
  const report = renderExecutionReport({
    mode: "triage-and-execution",
    dryRun: false,
    adapterKinds: { jira: "mock", llmContext: "mock", llmMemory: "mock", llmSqlDb: "mock", bitbucket: "mcp" },
    verification: [],
    verificationCounts: {},
    executionCounts: { pr_opened: 1 },
    resumeStats: { skippedAlreadyRejected: 0, skippedAlreadyInProgress: 0 },
    triage: [],
    execution: [
      {
        ticketKey: "GEN-16",
        status: "pr_opened",
        productTarget: "legacy",
        repoTarget: "core-app",
        reason: "ok",
        diffStat: " src/app.js | 2 +-\n1 file(s) changed, 2 line(s) changed"
      }
    ]
  });

  assert.match(report, /diff stat:\n\s+src\/app\.js \| 2 \+-/);
});

test("a dirty worktree error before branch creation never triggers a reset", async () => {
  const workspace = await createGitWorkspace();
  const bitbucketAdapter = createBitbucketAdapter();
  bitbucketAdapter.createBranch = async () => {
    throw new Error("Ticket worktree has uncommitted changes; aborting before touching it");
  };
  const { agent } = createAgent({ bitbucketAdapter, workspaceRoot: workspace });

  const [result] = await agent.run([buildItem("GEN-17")]);

  assert.equal(result.status, "failed");
  assert.match(result.reason, /uncommitted changes/);
  assert.ok(!bitbucketAdapter.operations.some((op) => `${op}`.startsWith("reset:")));
});

test("an unexpected error after branch creation resets the ticket worktree", async () => {
  const workspace = await createGitWorkspace();
  await writeFile(path.join(workspace, "src", "app.js"), "export const value = 18;\n");
  const bitbucketAdapter = createBitbucketAdapter();
  bitbucketAdapter.pushBranch = async () => {
    throw new Error("push rejected");
  };
  const { agent } = createAgent({ bitbucketAdapter, workspaceRoot: workspace });

  const [result] = await agent.run([buildItem("GEN-18")]);

  assert.equal(result.status, "failed");
  assert.equal(result.workspaceReset, "done");
  assert.equal(bitbucketAdapter.operations.at(-1), "reset:fix/GEN-18-lifecycle");
});
