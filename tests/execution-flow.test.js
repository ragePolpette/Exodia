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
      baseBranch: "BPOFH",
      allowRealPrs: false,
      allowMerge: false
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
