import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { redactText } from "../src/security/redaction.js";
import { buildRuntimeDiagnostics } from "../src/agent-runtime/runtime-diagnostics.js";
import { resolveSensitiveScanConfig, scanWorkspace } from "../src/security/public-hygiene.js";

const fakeOpenAiKey = ["sk", "proj", "A1b2C3d4E5f6G7h8I9j0K1l2"].join("-");
const fakeAwsKey = ["AKIA", "IOSFODNN7EXAMPLE"].join("");
const fakeAtlassianToken = ["ATATT", "3xFfGF0abcdefghijklmnopqrstuvwxyz0123456789"].join("");
const fakeBitbucketToken = ["ATBB", "abcdefghijklmnopqrstuvwxyz012345"].join("");

test("redaction covers API keys, bearer tokens, cloud keys, Atlassian tokens and emails", () => {
  const input = [
    `OPENAI_API_KEY=${fakeOpenAiKey}`,
    "Authorization: Bearer abc.def.ghi-jkl_mno",
    `aws=${fakeAwsKey}`,
    `jira=${fakeAtlassianToken}`,
    `bitbucket=${fakeBitbucketToken}`,
    "owner=jane.doe@example.com"
  ].join("\n");

  const output = redactText(input);

  for (const secret of [fakeOpenAiKey, "abc.def.ghi-jkl_mno", fakeAwsKey, fakeAtlassianToken, fakeBitbucketToken, "jane.doe@example.com"]) {
    assert.ok(!output.includes(secret), `${secret} leaked`);
  }
  assert.match(output, /Authorization: Bearer \[redacted:secret\]/);
  assert.match(output, /owner=\[redacted:email\]/);
});

test("runtime diagnostics redact stdout and stderr tails before they reach artifacts", () => {
  const diagnostics = buildRuntimeDiagnostics({
    message: `failed with key ${fakeOpenAiKey}`,
    args: ["--token", fakeAtlassianToken],
    stdout: `${"x".repeat(5000)} leaked ${fakeOpenAiKey}`,
    stderr: `Authorization: Bearer supersecretvalue123 for ops@example.com`
  });

  const serialized = JSON.stringify(diagnostics);
  assert.ok(!serialized.includes(fakeOpenAiKey));
  assert.ok(!serialized.includes(fakeAtlassianToken));
  assert.ok(!serialized.includes("supersecretvalue123"));
  assert.ok(!serialized.includes("ops@example.com"));
  assert.ok(diagnostics.stdoutTail.length <= 4000);
});

test("public hygiene scan keeps secret patterns even when config passes empty lists", async () => {
  assert.ok(resolveSensitiveScanConfig({ forbiddenRegexPatterns: [] }).forbiddenRegexPatterns.length > 0);

  const workspace = await mkdtemp(path.join(os.tmpdir(), "exodia-hygiene-defaults-"));
  await mkdir(path.join(workspace, "src"));
  await writeFile(path.join(workspace, "src", "config.js"), `export const key = "${fakeAwsKey}";\n`);

  const result = await scanWorkspace(workspace, {
    enabled: true,
    includePaths: ["src"],
    forbiddenRegexPatterns: [],
    exampleFiles: [{ path: "missing.json", jsonFieldPolicies: [] }]
  });

  assert.ok(result.issues.some((issue) => issue.type === "forbidden_pattern" && issue.filePath === "src/config.js"));
});

test("pull request descriptions redact runtime evidence lists", async () => {
  const { ExecutionAgent } = await import("../src/agents/execution-agent.js");
  const agent = new ExecutionAgent({
    bitbucketAdapter: {},
    executionConfig: {},
    verificationConfig: {},
    securityConfig: {},
    runtimePromptConfig: {}
  });

  const description = agent.buildPullRequestDescription({
    scopedTicket: { key: "GEN-1", summary: "Leak check" },
    analysisArtifact: { proposedFix: { steps: [`export KEY=${fakeOpenAiKey}`] } },
    implementationExtras: {
      changedFiles: ["src/app.js"],
      verificationResults: ["curl -H 'Authorization: Bearer abcdefghijklmnop' failed"]
    }
  });

  assert.ok(!description.includes(fakeOpenAiKey));
  assert.ok(!description.includes("abcdefghijklmnop"));
});
