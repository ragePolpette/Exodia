import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { runHarness } from "../src/orchestration/run-harness.js";

test("dry-run bootstraps triage and execution with mock adapters", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "bpopilot-harness-"));
  const configPath = path.join(workspace, "harness.config.json");
  const config = {
    mode: "triage-and-execution",
    dryRun: true,
    memory: {
      backend: "file",
      filePath: "./memory.json"
    },
    execution: {
      baseBranch: "BPOFH",
      allowRealPrs: false
    },
    mockTickets: [
      {
        key: "BPO-101",
        projectKey: "BPO",
        summary: "Harness smoke validation",
        scope: "BpoPilot",
        repoTarget: "BPOFH"
      },
      {
        key: "OPS-9",
        projectKey: "OPS",
        summary: "Out of scope validation",
        scope: "Other",
        repoTarget: "OPS"
      }
    ]
  };

  await writeFile(configPath, JSON.stringify(config, null, 2));

  const summary = await runHarness({ configPath, dryRunOverride: true });

  assert.equal(summary.dryRun, true);
  assert.equal(summary.ticketCount, 2);
  assert.equal(summary.triage.length, 2);
  assert.equal(summary.execution.length, 1);
  assert.equal(summary.triage[0].status_decision, "feasible");
  assert.equal(summary.execution[0].status, "pr_opened");

  const savedMemory = JSON.parse(await readFile(summary.memoryFile, "utf8"));
  assert.equal(savedMemory.length, 2);
  assert.ok(savedMemory[0].ticket_key);
});
