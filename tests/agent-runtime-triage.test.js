import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { runHarness } from "../src/orchestration/run-harness.js";
import { buildAgentRuntime } from "../src/agent-runtime/build-agent-runtime.js";

async function createScenario(config) {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "exodia-agent-runtime-"));
  const configPath = path.join(workspace, "harness.config.json");
  await writeFile(configPath, JSON.stringify(config, null, 2));
  return { workspace, configPath };
}

test("codex-cli runtime provider can parse structured JSON from a subprocess", async () => {
  const runtime = buildAgentRuntime({
    enabled: true,
    provider: "codex-cli",
    enabledPhases: ["analysis"],
    providers: {
      "codex-cli": {
        command: process.execPath,
        args: [
          "-e",
          "let data='';process.stdin.on('data',chunk=>data+=chunk);process.stdin.on('end',()=>{const request=JSON.parse(data);process.stdout.write(JSON.stringify({status:'proposal_ready',summary:`Handled ${request.phase}`,feasibility:'feasible',confidence:0.9,productTarget:'public-app',repoTarget:'public-web',area:'portal',proposedFix:{summary:'Inspect portal issue',steps:['Reproduce issue']},verificationPlan:{summary:'Run portal checks',checks:['npm test'],successCriteria:['bug fixed']}}));});"
        ],
        timeoutMs: 5000
      }
    }
  });

  const result = await runtime.analyzeTicket({
    ticket: {
      key: "DEVFH-10",
      summary: "Portal issue"
    }
  });

  assert.equal(result.phase, "analysis");
  assert.equal(result.provider, "codex-cli");
  assert.equal(result.productTarget, "public-app");
  assert.equal(result.repoTarget, "public-web");
  assert.equal(result.proposedFix.steps[0], "Reproduce issue");
});

test("triage writes analysis artifacts when the analysis runtime is enabled", async () => {
  const { workspace, configPath } = await createScenario({
    mode: "triage-only",
    dryRun: true,
    memory: {
      backend: "file",
      filePath: "./memory.json"
    },
    agentRuntime: {
      enabled: true,
      provider: "mock",
      artifactFile: "./agent-artifacts.json",
      enabledPhases: ["analysis"]
    },
    execution: {
      baseBranch: "main",
      allowRealPrs: false
    },
    mockTickets: [
      {
        key: "GEN-801",
        projectKey: "GEN",
        summary: "Public portal profile save fails",
        contextMapping: {
          inScope: true,
          productTarget: "public-app",
          repoTarget: "public-web",
          area: "profile",
          feasibility: "feasible",
          confidence: 0.88,
          implementationHint: "Inspect profile save workflow"
        }
      }
    ]
  });

  const summary = await runHarness({ configPath, modeOverride: "triage-only", dryRunOverride: true });
  const artifacts = JSON.parse(await readFile(path.join(workspace, "agent-artifacts.json"), "utf8"));

  assert.equal(summary.triage[0].status_decision, "feasible");
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].ticketKey, "GEN-801");
  assert.equal(artifacts[0].provider, "mock");
  assert.equal(artifacts[0].productTarget, "public-app");
});

test("analysis runtime can drive clarification requests through the existing interaction loop", async () => {
  const { workspace, configPath } = await createScenario({
    mode: "triage-only",
    dryRun: true,
    memory: {
      backend: "file",
      filePath: "./memory.json"
    },
    agentRuntime: {
      enabled: true,
      provider: "mock",
      artifactFile: "./agent-artifacts.json",
      enabledPhases: ["analysis"]
    },
    interaction: {
      enabled: true,
      mode: "deferred",
      storeFile: "./interactions.json",
      destinations: ["ticket"],
      allowedPhases: ["triage"],
      maxQuestionsPerTicket: 1,
      transports: {
        ticket: {
          enabled: true,
          commentPrefix: "[Exodia]"
        },
        slack: {
          enabled: false,
          server: "",
          postAction: "",
          collectRepliesAction: "",
          channel: "",
          channelsByPhase: {}
        }
      }
    },
    execution: {
      baseBranch: "main",
      allowRealPrs: false
    },
    mockTickets: [
      {
        key: "GEN-802",
        projectKey: "GEN",
        summary: "Need more context before fixing profile save",
        contextMapping: {
          inScope: true,
          productTarget: "public-app",
          repoTarget: "public-web",
          area: "profile",
          feasibility: "feasible",
          confidence: 0.88
        },
        missingInformation: [
          "What exact user flow reproduces the failure after profile save?"
        ]
      }
    ]
  });

  const summary = await runHarness({ configPath, modeOverride: "triage-only", dryRunOverride: true });
  const interactions = JSON.parse(await readFile(path.join(workspace, "interactions.json"), "utf8"));
  const artifacts = JSON.parse(await readFile(path.join(workspace, "agent-artifacts.json"), "utf8"));

  assert.equal(summary.triage[0].status_decision, "blocked");
  assert.match(summary.triage[0].short_reason, /awaiting human clarification/i);
  assert.equal(interactions.length, 1);
  assert.equal(interactions[0].status, "awaiting_response");
  assert.equal(artifacts[0].status, "needs_human");
  assert.equal(
    artifacts[0].questions[0].question,
    "What exact user flow reproduces the failure after profile save?"
  );
});
