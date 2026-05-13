import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCodexExecArgs,
  buildCodexExecPrompt,
  buildPhaseOutputSchema
} from "../src/agent-runtime/codex-cli-wrapper.js";

test("codex wrapper builds a strict phase schema for structured output", () => {
  const schema = buildPhaseOutputSchema("analysis");
  assert.equal(schema.type, "object");
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, [
    "status",
    "summary",
    "feasibility",
    "confidence",
    "productTarget",
    "repoTarget",
    "area",
    "proposedFix",
    "verificationPlan",
    "questions"
  ]);
  assert.equal(schema.properties.status.type, "string");
  assert.equal(schema.properties.confidence.type, "number");
  assert.equal(schema.properties.proposedFix.type, "object");
  assert.equal(schema.properties.proposedFix.additionalProperties, false);
  assert.deepEqual(schema.properties.proposedFix.required, [
    "summary",
    "steps",
    "risks",
    "assumptions"
  ]);
  assert.equal(schema.properties.verificationPlan.additionalProperties, false);
});

test("codex wrapper builds non-interactive exec arguments with schema and output files", () => {
  const args = buildCodexExecArgs({
    phase: "audit",
    cwd: "C:\\repo",
    model: "gpt-5-codex",
    outputSchemaPath: "C:\\tmp\\audit.schema.json",
    outputLastMessagePath: "C:\\tmp\\audit.output.json",
    sandbox: "read-only",
    profile: "default",
    useOss: true,
    localProvider: "lmstudio"
  });

  assert.deepEqual(args.slice(0, 4), ["exec", "--skip-git-repo-check", "--color", "never"]);
  assert.ok(args.includes("--output-schema"));
  assert.ok(args.includes("C:\\tmp\\audit.schema.json"));
  assert.ok(args.includes("--output-last-message"));
  assert.ok(args.includes("C:\\tmp\\audit.output.json"));
  assert.ok(args.includes("--model"));
  assert.ok(args.includes("gpt-5-codex"));
  assert.ok(args.includes("--oss"));
  assert.ok(args.includes("--local-provider"));
  assert.equal(args.at(-1), "-");
});

test("codex wrapper prompt embeds the runtime envelope as JSON", () => {
  const prompt = buildCodexExecPrompt({
    phase: "implementation",
    provider: "codex-cli",
    payload: {
      ticket: {
        key: "GEN-100"
      }
    }
  });

  assert.match(prompt, /Return exactly one JSON object/);
  assert.match(prompt, /analysis\.status must be proposal_ready/);
  assert.match(prompt, /"phase": "implementation"/);
  assert.match(prompt, /"key": "GEN-100"/);
});
