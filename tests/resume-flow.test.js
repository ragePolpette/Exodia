import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { runHarness } from "../src/orchestration/run-harness.js";

test("resume reuses memory and skips tickets already in progress", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "bpopilot-resume-"));
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
    mockTickets: [
      {
        key: "BPO-601",
        projectKey: "BPO",
        summary: "Resume existing work",
        repoTarget: "BPOFH",
        contextMapping: {
          inScope: true,
          repoTarget: "BPOFH",
          feasibility: "feasible",
          confidence: 0.91
        }
      }
    ]
  };

  await writeFile(configPath, JSON.stringify(config, null, 2));
  await writeFile(
    memoryPath,
    JSON.stringify(
      [
        {
          ticket_key: "BPO-601",
          project_key: "BPO",
          repo_target: "BPOFH",
          status_decision: "feasible",
          confidence: 0.91,
          short_reason: "already being worked",
          implementation_hint: "",
          branch_name: "bpo-601-resume-existing-work",
          pr_url: "mock://pull-request/bpo-601",
          last_outcome: "pr_opened",
          recheck_conditions: [],
          updated_at: "2026-03-23T00:00:00.000Z"
        }
      ],
      null,
      2
    )
  );

  const summary = await runHarness({
    configPath,
    modeOverride: "triage-and-execution",
    dryRunOverride: true
  });

  assert.equal(summary.triage[0].status_decision, "skipped_already_in_progress");
  assert.equal(summary.execution.length, 0);
  assert.equal(summary.resumeStats.skippedAlreadyInProgress, 1);
  assert.equal(summary.resumeStats.memoryRecordsBefore, 1);
});
