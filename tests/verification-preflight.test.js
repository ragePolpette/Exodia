import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { runHarness } from "../src/orchestration/run-harness.js";

const execFileAsync = promisify(execFile);

async function initGitWorkspace(workspace) {
  await execFileAsync("git", ["init"], { cwd: workspace, windowsHide: true });
}

test("preflight blocks execution when changed files escape the configured allowlist", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "malkuth-preflight-paths-"));
  const configPath = path.join(workspace, "harness.config.json");
  await initGitWorkspace(workspace);
  await mkdir(path.join(workspace, "allowed"), { recursive: true });
  await writeFile(path.join(workspace, "forbidden.txt"), "forbidden change\n");

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
    verification: {
      enabled: true,
      minConfidence: 0.75,
      maxCommitMessageLength: 120,
      maxPullRequestTitleLength: 120,
      allowedPathPrefixesByRepo: {
        "BPOFH": ["allowed"]
      },
      preflightCommands: []
    },
    mockTickets: [
      {
        key: "BPO-700",
        projectKey: "BPO",
        summary: "Path allowlist block",
        productTarget: "legacy",
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

  const summary = await runHarness({
    configPath,
    modeOverride: "triage-and-execution",
    dryRunOverride: true
  });

  assert.equal(summary.verification[0].status, "approved");
  assert.equal(summary.execution.length, 1);
  assert.equal(summary.execution[0].status, "blocked");
  assert.match(summary.execution[0].reason, /changed paths outside allowlist/i);
});

test("preflight blocks execution when a configured command fails", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "malkuth-preflight-command-"));
  const configPath = path.join(workspace, "harness.config.json");
  await initGitWorkspace(workspace);
  await mkdir(path.join(workspace, "allowed"), { recursive: true });
  await writeFile(path.join(workspace, "allowed", "note.txt"), "safe change\n");

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
    verification: {
      enabled: true,
      minConfidence: 0.75,
      maxCommitMessageLength: 120,
      maxPullRequestTitleLength: 120,
      allowedPathPrefixesByRepo: {},
      preflightCommands: [
        {
          label: "failing-check",
          command: process.execPath,
          args: ["-e", "process.exit(2)"]
        }
      ]
    },
    mockTickets: [
      {
        key: "BPO-701",
        projectKey: "BPO",
        summary: "Command preflight block",
        productTarget: "legacy",
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

  const summary = await runHarness({
    configPath,
    modeOverride: "triage-and-execution",
    dryRunOverride: true
  });

  assert.equal(summary.verification[0].status, "approved");
  assert.equal(summary.execution.length, 1);
  assert.equal(summary.execution[0].status, "blocked");
  assert.match(summary.execution[0].reason, /preflight command failed/i);
  assert.match(summary.execution[0].reason, /failing-check/i);
});

test("preflight blocks execution when the public hygiene scan finds sensitive references", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "malkuth-preflight-sensitive-"));
  const configPath = path.join(workspace, "harness.config.json");
  await initGitWorkspace(workspace);
  await mkdir(path.join(workspace, "src"), { recursive: true });
  await writeFile(path.join(workspace, "src", "leak.js"), "const tenant = 'tenant.acme.internal';\n");

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
    verification: {
      enabled: true,
      minConfidence: 0.75,
      maxCommitMessageLength: 120,
      maxPullRequestTitleLength: 120,
      allowedPathPrefixesByRepo: {},
      preflightCommands: [],
      sensitiveScan: {
        enabled: true,
        workspaceRoot: workspace,
        includePaths: ["src"],
        forbiddenLiteralPatterns: ["tenant.acme.internal"],
        forbiddenRegexPatterns: [],
        exampleFiles: []
      }
    },
    mockTickets: [
      {
        key: "GEN-702",
        projectKey: "GEN",
        summary: "Sensitive scan block",
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

  const summary = await runHarness({
    configPath,
    modeOverride: "triage-and-execution",
    dryRunOverride: true
  });

  assert.equal(summary.verification[0].status, "approved");
  assert.equal(summary.execution.length, 1);
  assert.equal(summary.execution[0].status, "blocked");
  assert.match(summary.execution[0].reason, /public hygiene scan failed/i);
});

test("preflight blocks execution when the command is outside the allowlist", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "malkuth-preflight-allowlist-"));
  const configPath = path.join(workspace, "harness.config.json");
  await initGitWorkspace(workspace);
  await mkdir(path.join(workspace, "allowed"), { recursive: true });
  await writeFile(path.join(workspace, "allowed", "note.txt"), "safe change\n");

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
    verification: {
      enabled: true,
      minConfidence: 0.75,
      maxCommitMessageLength: 120,
      maxPullRequestTitleLength: 120,
      allowedPathPrefixesByRepo: {},
      allowedCommandPrefixes: [["node", "-e"]],
      preflightCommands: [
        {
          label: "disallowed-check",
          command: process.execPath,
          args: ["-e", "process.exit(0)"]
        }
      ],
      sensitiveScan: {
        enabled: false
      }
    },
    mockTickets: [
      {
        key: "GEN-703",
        projectKey: "GEN",
        summary: "Allowlist block",
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

  const summary = await runHarness({
    configPath,
    modeOverride: "triage-and-execution",
    dryRunOverride: true
  });

  assert.equal(summary.verification[0].status, "approved");
  assert.equal(summary.execution.length, 1);
  assert.equal(summary.execution[0].status, "blocked");
  assert.match(summary.execution[0].reason, /not allowed by policy/i);
});
