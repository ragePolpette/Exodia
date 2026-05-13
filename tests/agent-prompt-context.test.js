import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { AgentPromptContextBuilder, resolveWorkspaceRoot } from "../src/agent-runtime/agent-prompt-context.js";

const fixtureRoot = path.resolve("tests", "fixtures", "agent-context");
const repoRoot = path.join(fixtureRoot, "exodia-repo");
const targetRoot = path.join(fixtureRoot, "target-worktree");
const missingTargetRoot = path.join(fixtureRoot, "missing-target-worktree");

test("agent prompt context reads repo EXODIA before target EXODIA", async () => {
  const builder = new AgentPromptContextBuilder(
    {
      agentRuntime: { workspaceRoot: targetRoot },
      adapters: {
        jira: { kind: "mcp", mcp: { server: "atlassian" } },
        llmContext: { kind: "mcp", mcp: { server: "llm-context" } },
        llmMemory: { kind: "mock" }
      }
    },
    { repoRoot }
  );

  const loaded = await builder.loadInstructionFiles();
  assert.equal(loaded.workspaceRoot, targetRoot);
  assert.equal(loaded.files.length, 2);
  assert.deepEqual(loaded.files.map((file) => file.label), [
    "Exodia general instructions",
    "Target worktree instructions"
  ]);

  const prompt = await builder.buildPrompt("base prompt", { phase: "analysis", agentRole: "analysis-agent" });
  assert.ok(prompt.indexOf("general exodia rules") < prompt.indexOf("target product rules"));
  assert.match(prompt, /llm-context: use the connected MCP server llm-context/);
});

test("agent prompt context warns when target EXODIA is missing", async () => {
  const builder = new AgentPromptContextBuilder({ agentRuntime: { workspaceRoot: missingTargetRoot } }, { repoRoot });

  const loaded = await builder.loadInstructionFiles();
  assert.equal(loaded.missingGeneral, false);
  assert.equal(loaded.missingTarget, true);

  const prompt = await builder.buildPrompt("base prompt", { phase: "audit", agentRole: "audit-agent" });
  assert.match(prompt, /Missing target worktree EXODIA.md/);
});

test("resolveWorkspaceRoot prefers explicit agent runtime workspace", () => {
  assert.equal(
    resolveWorkspaceRoot({
      agentRuntime: { workspaceRoot: "C:/target" },
      execution: { workspaceRoot: "C:/execution" }
    }),
    "C:/target"
  );
});


test("agent prompt context can require target EXODIA", async () => {
  const builder = new AgentPromptContextBuilder(
    { agentRuntime: { workspaceRoot: missingTargetRoot, requireTargetInstructions: true } },
    { repoRoot }
  );

  await assert.rejects(
    () => builder.loadInstructionFiles(),
    /EXODIA_TARGET_INSTRUCTIONS_MISSING/
  );
});
