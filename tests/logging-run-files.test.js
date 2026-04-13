import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { runHarness } from "../src/orchestration/run-harness.js";

test("run harness writes jsonl and summary files when file logging is enabled", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "malkuth-logging-"));
  const configPath = path.join(workspace, "harness.config.json");

  const config = {
    mode: "triage-only",
    dryRun: true,
    memory: {
      backend: "file",
      filePath: "./memory.json"
    },
    logging: {
      level: "info",
      includeTimestamp: true,
      file: {
        enabled: true,
        rootDir: "./logs"
      }
    },
    execution: {
      enabled: false,
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
          inScope: true,
          feasibility: "feasible",
          implementationHint: "Inspect core platform code",
          aliases: ["legacy-suite"],
          scopeAliases: ["coreapp"],
          projectKeys: ["GEN"]
        }
      ]
    },
    mockTickets: [
      {
        key: "GEN-801",
        projectKey: "GEN",
        summary: "Logging smoke test",
        contextMapping: {
          inScope: true,
          productTarget: "legacy",
          repoTarget: "core-app",
          feasibility: "feasible",
          confidence: 0.92,
          implementationHint: "Inspect core platform code"
        }
      }
    ]
  };

  await writeFile(configPath, JSON.stringify(config, null, 2));

  const summary = await runHarness({
    configPath,
    modeOverride: "triage-only",
    dryRunOverride: true
  });

  assert.ok(summary.runId.startsWith("malkuth-"));
  assert.ok(summary.logFiles?.jsonl);
  assert.ok(summary.logFiles?.summaryText);
  assert.ok(summary.logFiles?.summaryJson);

  await stat(summary.logFiles.jsonl);
  await stat(summary.logFiles.summaryText);
  await stat(summary.logFiles.summaryJson);

  const jsonlContent = await readFile(summary.logFiles.jsonl, "utf8");
  assert.match(jsonlContent, /"runId":"malkuth-/);
  assert.match(jsonlContent, /Harness run started/);

  const summaryText = await readFile(summary.logFiles.summaryText, "utf8");
  assert.match(summaryText, /Malkuth Final Report/);

  const summaryJson = JSON.parse(await readFile(summary.logFiles.summaryJson, "utf8"));
  assert.equal(summaryJson.runId, summary.runId);
  assert.equal(summaryJson.ticketCount, 1);
});
