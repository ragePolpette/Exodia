import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { runHarness } from "../src/orchestration/run-harness.js";

test("resume reuses memory and skips tickets already in progress", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "exodia-resume-"));
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
      baseBranch: "main",
      allowRealPrs: false,
      allowMerge: false,
      workspaceRoot: workspace
    },
    targeting: {
      rules: [
        {
          target: "legacy",
          repoTarget: "core-app",
          area: "core-platform",
          aliases: ["core-suite"],
          scopeAliases: ["coreapp"],
          projectKeys: ["GEN"]
        }
      ]
    },
    mockTickets: [
      {
        key: "GEN-601",
        projectKey: "GEN",
        summary: "Resume existing work",
        repoTarget: "core-app",
        contextMapping: {
          inScope: true,
          productTarget: "legacy",
          repoTarget: "core-app",
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
          ticket_key: "GEN-601",
          project_key: "GEN",
          product_target: "legacy",
          repo_target: "core-app",
          status_decision: "feasible",
          confidence: 0.91,
          short_reason: "already being worked",
          implementation_hint: "",
          branch_name: "gen-601-resume-existing-work",
          pr_url: "mock://pull-request/gen-601",
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
