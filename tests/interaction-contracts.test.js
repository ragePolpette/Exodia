import test from "node:test";
import assert from "node:assert/strict";

import {
  isAuthorizedResponder,
  normalizeInteractionResponse,
  parseInteractionCommand,
  resolveApprovalDecision
} from "../src/interaction/interaction-contracts.js";

test("approval decisions require an anchored explicit command", () => {
  assert.equal(resolveApprovalDecision("/exodia approve"), "approved");
  assert.equal(resolveApprovalDecision("  /Exodia   reject not now"), "rejected");
  assert.equal(resolveApprovalDecision("approve"), "approved");
  assert.equal(resolveApprovalDecision("Reject, wrong repository"), "rejected");
  assert.equal(resolveApprovalDecision("ok"), "");
  assert.equal(resolveApprovalDecision("go"), "");
  assert.equal(resolveApprovalDecision("yes"), "");
  assert.equal(resolveApprovalDecision("no"), "");
  assert.equal(resolveApprovalDecision("approved"), "");
  assert.equal(resolveApprovalDecision("I would approve this"), "");
  assert.equal(resolveApprovalDecision("please /exodia approve"), "");
  assert.equal(resolveApprovalDecision("/exodia answer approve"), "");
});

test("answer commands expose the body without the prefix", () => {
  assert.deepEqual(parseInteractionCommand("/exodia answer the repo is core-app"), {
    command: "answer",
    body: "the repo is core-app"
  });
  assert.equal(parseInteractionCommand("plain clarification").command, "");
});

test("responder authorization matches account id, email or display name and denies by default", () => {
  const response = normalizeInteractionResponse(
    {
      text: "/exodia approve",
      author: { accountId: "557058:abc", emailAddress: "Lead@Example.invalid", displayName: "Team Lead" },
      created: "2099-01-01T00:00:00.000Z"
    },
    "ticket"
  );

  assert.equal(isAuthorizedResponder(response, []), false);
  assert.equal(isAuthorizedResponder(response, undefined), false);
  assert.equal(isAuthorizedResponder(response, ["557058:abc"]), true);
  assert.equal(isAuthorizedResponder(response, ["lead@example.invalid"]), true);
  assert.equal(isAuthorizedResponder(response, ["team lead"]), true);
  assert.equal(isAuthorizedResponder(response, ["someone-else"]), false);
});

test("unparsable response timestamps are not replaced with the current time", () => {
  const response = normalizeInteractionResponse({ text: "hello", respondedAt: "yesterday-ish" }, "ticket");
  assert.equal(response.respondedAt, "");
});

test("slack epoch timestamps are parsed instead of rejected", () => {
  const response = normalizeInteractionResponse({ text: "hello", ts: "1711533600.000100", user: "U123" }, "slack");
  assert.equal(response.respondedAt, "2024-03-27T10:00:00.000Z");
  assert.equal(response.author, "U123");
});
