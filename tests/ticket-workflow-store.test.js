import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { FileMemoryStore } from "../src/memory/file-memory-store.js";
import { TicketWorkflowStore } from "../src/orchestration/ticket-workflow-store.js";

test("ticket workflow store persists candidate and approval state", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "exodia-workflow-store-"));
  const store = new TicketWorkflowStore(new FileMemoryStore(path.join(workspace, "workflow.json")));

  await store.ensureTickets([{ key: "GEN-1", projectKey: "GEN" }]);
  await store.recordCandidate({
    ticket_key: "GEN-1",
    project_key: "GEN",
    status_decision: "feasible",
    confidence: 0.88,
    product_target: "public-app",
    repo_target: "public-web",
    short_reason: "candidate looks actionable"
  });
  await store.markApproval({
    ticket: { key: "GEN-1", projectKey: "GEN" },
    required: true,
    status: "awaiting_response",
    interaction: { id: "interaction-1" },
    reason: "candidate waiting for approval"
  });

  const snapshot = await store.snapshot();

  assert.equal(snapshot.total, 1);
  assert.equal(snapshot.counts.awaiting_human_approval, 1);
  assert.equal(snapshot.records[0].approval.required, true);
  assert.equal(snapshot.records[0].approval.interactionId, "interaction-1");
  assert.equal(snapshot.records[0].candidate.productTarget, "public-app");
});
