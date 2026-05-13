import test from "node:test";
import assert from "node:assert/strict";

import { buildAgentRuntime } from "../src/agent-runtime/build-agent-runtime.js";
import { buildPiRpcArgs, buildPiRuntimePrompt, resolvePiToolPolicy } from "../src/agent-runtime/pi-agent-runtime-adapter.js";

test("Pi adapter builds RPC args from provider config", () => {
  const args = buildPiRpcArgs({
    cliPath: "C:\\pi\\dist\\cli.js",
    provider: "ollama",
    model: "qwen2.5-coder",
    noSession: false,
    sessionDir: "./data/pi-sessions",
    tools: ["read", "grep", "find", "ls"],
    noContextFiles: true
  });

  assert.deepEqual(args, [
    "C:\\pi\\dist\\cli.js",
    "--mode",
    "rpc",
    "--provider",
    "ollama",
    "--model",
    "qwen2.5-coder",
    "--no-context-files",
    "--tools",
    "read,grep,find,ls",
    "--session-dir",
    "./data/pi-sessions"
  ]);
});

test("Pi adapter prompt embeds the Exodia runtime payload", () => {
  const prompt = buildPiRuntimePrompt({
    phase: "analysis",
    provider: "pi",
    model: "qwen2.5-coder",
    requireStructuredOutput: true,
    toolPolicy: ["read-only"],
    payload: {
      ticket: {
        key: "GEN-948"
      }
    }
  });

  assert.match(prompt, /Return exactly one JSON object/);
  assert.match(prompt, /Runtime phase: analysis/);
  assert.match(prompt, /Tool\/workspace policy: read-only/);
  assert.match(prompt, /"key": "GEN-948"/);
});

test("Pi adapter resolves safe default tool policy by phase", () => {
  assert.deepEqual(resolvePiToolPolicy("analysis"), [
    "read-only workspace access",
    "inspect and search code only",
    "do not edit files",
    "do not create branches",
    "do not run destructive commands"
  ]);

  assert.deepEqual(resolvePiToolPolicy("implementation").slice(0, 2), [
    "workspace-write inside the configured target worktree only",
    "create or reuse a dedicated ticket branch"
  ]);

  assert.deepEqual(
    resolvePiToolPolicy("audit", {
      toolsByPhase: {
        audit: ["custom read-only audit"]
      }
    }),
    ["custom read-only audit"]
  );
});

test("Pi runtime provider reads JSONL agent_end output", async () => {
  const runtime = buildAgentRuntime(
    {
      enabled: true,
      provider: "pi",
      model: "qwen2.5-coder",
      enabledPhases: ["analysis"],
      providers: {
        pi: {
          command: process.execPath,
          args: [
            "-e",
            "process.stdin.once('data',()=>{const result={status:'proposal_ready',summary:'Pi analysis completed',feasibility:'feasible',confidence:0.88,productTarget:'public-app',repoTarget:'public-web',area:'payments',proposedFix:{summary:'Fix partial payment status',steps:['Inspect scadenzario payment aggregation'],risks:[],assumptions:[]},verificationPlan:{summary:'Verify partial payment state',checks:['targeted test'],successCriteria:['invoice remains partially paid'],maxVerificationLoops:2},questions:[]};const msg={role:'assistant',content:JSON.stringify(result)};process.stdout.write(JSON.stringify({type:'message_end',message:msg})+'\\n');process.stdout.write(JSON.stringify({type:'agent_end',messages:[msg]})+'\\n');});"
          ],
          timeoutMs: 5000,
          envPassthrough: []
        }
      }
    },
    { debug() {} }
  );

  const result = await runtime.analyzeTicket({
    ticket: {
      key: "GEN-948",
      summary: "Partial invoice payment is marked complete"
    }
  });

  assert.equal(result.phase, "analysis");
  assert.equal(result.provider, "pi");
  assert.equal(result.model, "qwen2.5-coder");
  assert.equal(result.status, "proposal_ready");
  assert.equal(result.feasibility, "feasible");
  assert.equal(result.productTarget, "public-app");
  assert.equal(result.verificationPlan.maxVerificationLoops, 2);
});
