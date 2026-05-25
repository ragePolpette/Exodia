import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { collectMonitoringSnapshot } from "../src/monitoring/monitoring-service.js";

test("monitoring snapshot aggregates recent run summaries and JSONL levels", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "exodia-monitor-"));
  const dayOne = path.join(rootDir, "2026-03-26");
  const dayTwo = path.join(rootDir, "2026-03-27");
  await mkdir(dayOne, { recursive: true });
  await mkdir(dayTwo, { recursive: true });

  await writeFile(
    path.join(dayOne, "run-a.summary.json"),
    JSON.stringify({
      runId: "exodia-a",
      startedAt: "2026-03-26T09:00:00.000Z",
      mode: "triage-only",
      dryRun: true,
      ticketCount: 2,
      triageCounts: { feasible: 1, blocked: 1 },
      verificationCounts: {},
      executionCounts: {},
      interactionStats: { pending: 1, resolved: 0 },
      resumeStats: {}
    }, null, 2)
  );
  await writeFile(
    path.join(dayOne, "run-a.jsonl"),
    [
      JSON.stringify({ level: "info", message: "run started" }),
      JSON.stringify({ level: "warn", message: "triage ambiguous" })
    ].join("\n")
  );

  await writeFile(
    path.join(dayTwo, "run-b.summary.json"),
    JSON.stringify({
      runId: "exodia-b",
      startedAt: "2026-03-27T10:00:00.000Z",
      mode: "triage-and-execution",
      dryRun: false,
      ticketCount: 3,
      triageCounts: { feasible: 3 },
      verificationCounts: { approved: 3 },
      executionCounts: { pr_opened: 1, implemented: 2 },
      interactionStats: { pending: 0, resolved: 2 },
      resumeStats: {}
    }, null, 2)
  );
  await writeFile(
    path.join(dayTwo, "run-b.jsonl"),
    [
      JSON.stringify({ level: "info", message: "run started" }),
      JSON.stringify({ level: "error", message: "adapter timeout" })
    ].join("\n")
  );

  const snapshot = await collectMonitoringSnapshot(rootDir, { limit: 10 });

  assert.equal(snapshot.totalRuns, 2);
  assert.equal(snapshot.aggregates.ticketsProcessed, 5);
  assert.equal(snapshot.aggregates.pendingInteractions, 1);
  assert.equal(snapshot.aggregates.resolvedInteractions, 2);
  assert.equal(snapshot.aggregates.warningRuns, 1);
  assert.equal(snapshot.aggregates.errorRuns, 1);
  assert.equal(snapshot.runs[0].runId, "exodia-b");
  assert.equal(snapshot.runs[0].status, "error");
  assert.equal(snapshot.runs[1].status, "warning");
});
