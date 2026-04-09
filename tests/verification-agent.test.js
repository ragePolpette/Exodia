import test from "node:test";
import assert from "node:assert/strict";

import { VerificationService } from "../src/verification/verification-service.js";

function createItem(overrides = {}) {
  return {
    ticket: {
      key: "GEN-900",
      projectKey: "GEN",
      summary: "Safe verification ticket",
      productTarget: "legacy",
      repoTarget: "core-app",
      ...overrides.ticket
    },
    decision: {
      product_target: "legacy",
      repo_target: "core-app",
      status_decision: "feasible",
      confidence: 0.91,
      ...overrides.decision
    }
  };
}

function createPayload(overrides = {}) {
  return {
    branchName: "gen-900-safe-verification-ticket",
    commitMessage: "feat(GEN-900): Safe verification ticket",
    pullRequestTitle: "[GEN-900] Safe verification ticket",
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
        productTarget: "webportal"
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
      pullRequestTitle: "[GEN-900] Unsafe title\nsecond line"
    })
  );

  assert.equal(result.status, "blocked");
  assert.match(result.reason, /pull request title must stay on a single line/i);
});
