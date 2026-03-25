import test from "node:test";
import assert from "node:assert/strict";

import { VerificationService } from "../src/verification/verification-service.js";

function createItem(overrides = {}) {
  return {
    ticket: {
      key: "BPO-900",
      projectKey: "BPO",
      summary: "Safe verification ticket",
      productTarget: "legacy",
      repoTarget: "api+asp",
      ...overrides.ticket
    },
    decision: {
      product_target: "legacy",
      repo_target: "api+asp",
      status_decision: "feasible",
      confidence: 0.91,
      ...overrides.decision
    }
  };
}

function createPayload(overrides = {}) {
  return {
    branchName: "bpo-900-safe-verification-ticket",
    commitMessage: "feat(BPO-900): Safe verification ticket",
    pullRequestTitle: "[BPO-900] Safe verification ticket",
    ...overrides
  };
}

test("verification service approves coherent execution payloads", () => {
  const service = new VerificationService();
  const result = service.verify(createItem(), createPayload());

  assert.equal(result.status, "approved");
});

test("verification service requests review on target mismatch", () => {
  const service = new VerificationService();
  const result = service.verify(
    createItem({
      ticket: {
        productTarget: "fatturhello"
      }
    }),
    createPayload()
  );

  assert.equal(result.status, "needs_review");
  assert.match(result.reason, /conflicts with triage target/i);
});

test("verification service blocks multiline pull request titles", () => {
  const service = new VerificationService();
  const result = service.verify(
    createItem(),
    createPayload({
      pullRequestTitle: "[BPO-900] Unsafe title\nsecond line"
    })
  );

  assert.equal(result.status, "blocked");
  assert.match(result.reason, /pull request title must stay on a single line/i);
});
