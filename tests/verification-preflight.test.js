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
