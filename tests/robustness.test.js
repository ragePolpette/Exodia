import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { FileMemoryStore } from "../src/memory/file-memory-store.js";
import { runHarness } from "../src/orchestration/run-harness.js";

async function listFilesRecursive(root) {
  const entries = await readdir(root, { withFileTypes: true, recursive: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => path.join(entry.parentPath ?? entry.path, entry.name));
}

test("a failing run still writes a failure summary with the audit trail", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "exodia-run-failure-"));
  const configPath = path.join(workspace, "harness.config.json");
  await writeFile(
    configPath,
    JSON.stringify({
      mode: "triage-and-execution",
      dryRun: false,
      memory: { filePath: "./memory.json" },
      logging: { file: { enabled: true, rootDir: "./logs" } },
      execution: { enabled: true, dryRun: false, trustLevel: "mcp-write", allowRealPrs: true, workspaceRoot: "." },
      mockTickets: [
        {
          key: "GEN-1",
          projectKey: "GEN",
          summary: "Guardrail failure",
          productTarget: "legacy",
          repoTarget: "core-app",
          contextMapping: { inScope: true, repoTarget: "core-app", feasibility: "feasible", confidence: 0.95 }
        }
      ]
    })
  );

  await assert.rejects(
    runHarness({ configPath, modeOverride: "triage-and-execution", dryRunOverride: false }),
    /Real execution requires adapters\.bitbucket\.kind = "mcp"/
  );

  const files = await listFilesRecursive(path.join(workspace, "logs"));
  const summaryJson = files.find((file) => file.endsWith(".summary.json"));
  const summaryText = files.find((file) => file.endsWith(".summary.txt"));
  assert.ok(summaryJson, "summary json must be written");
  assert.ok(summaryText, "summary text must be written");

  const summary = JSON.parse(await readFile(summaryJson, "utf8"));
  assert.equal(summary.status, "failed");
  assert.match(summary.error, /bitbucket\.kind/);
  assert.equal(summary.ticketCount, 1);
  assert.equal(summary.workflow.total, 1);
  assert.equal(summary.auditTrail.at(-1).message, "harness run failed");
  assert.match(await readFile(summaryText, "utf8"), /Status: failed/);
});

test("file memory store readers never observe a partially written file", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "exodia-atomic-store-"));
  const filePath = path.join(workspace, "nested", "state.json");
  const store = new FileMemoryStore(filePath);
  const payload = "x".repeat(4 * 1024 * 1024);
  await store.saveAll([{ index: -1, payload }]);

  let writing = true;
  const parseErrors = [];
  const reader = (async () => {
    while (writing) {
      try {
        JSON.parse(await readFile(filePath, "utf8"));
      } catch (error) {
        parseErrors.push(error.message);
      }
    }
  })();

  for (let index = 0; index < 15; index += 1) {
    await store.saveAll([{ index, payload }]);
  }
  writing = false;
  await reader;

  assert.deepEqual(parseErrors, []);
  assert.equal(JSON.parse(await readFile(filePath, "utf8"))[0].index, 14);
  assert.deepEqual(await readdir(path.dirname(filePath)), ["state.json"]);
});
