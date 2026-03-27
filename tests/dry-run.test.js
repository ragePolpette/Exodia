import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { runHarness } from "../src/orchestration/run-harness.js";

test("dry-run bootstraps triage and execution with mock adapters", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "malkuth-dry-run-"));
  const configPath = path.join(workspace, "harness.config.json");
  const config = {
    mode: "triage-and-execution",
    dryRun: true,
    memory: {
      backend: "file",
      filePath: "./memory.json"
    },
    execution: {
      baseBranch: "main",
      allowRealPrs: false
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
        key: "GEN-101",
        projectKey: "GEN",
        summary: "Core-suite smoke validation",
        scope: "CoreApp",
        repoTarget: "core-app"
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
  assert.equal(summary.triage[0].product_target, "legacy");
  assert.equal(summary.triage[0].repo_target, "core-app");
  assert.equal(summary.execution[0].status, "pr_opened");
  assert.equal(summary.execution[0].productTarget, "legacy");

  const savedMemory = JSON.parse(await readFile(summary.memoryFile, "utf8"));
  assert.equal(savedMemory.length, 2);
  assert.ok(savedMemory[0].ticket_key);
  assert.equal(savedMemory[0].product_target, "legacy");
});
