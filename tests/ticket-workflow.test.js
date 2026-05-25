import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { runHarness } from "../src/orchestration/run-harness.js";

async function createWorkflowScenario(config) {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "exodia-ticket-workflow-"));
  const configPath = path.join(workspace, "harness.config.json");
  await writeFile(configPath, JSON.stringify(config, null, 2));
  return { workspace, configPath };
}

function buildConfig(ticketOverrides = {}) {
  return {
    mode: "triage-and-execution",
    dryRun: true,
    memory: {
      backend: "file",
      filePath: "./memory.json"
    },
    workflow: {
      enabled: true,
      stateFile: "./workflow-state.json",
      humanApprovalPolicy: "always"
    },
    interaction: {
      enabled: true,
      mode: "deferred",
      storeFile: "./interactions.json",
      destinations: ["ticket"],
      allowedPhases: ["candidate_approval"],
      maxQuestionsPerTicket: 2
    },
    execution: {
      enabled: true,
      dryRun: true,
      baseBranch: "main",
      allowRealPrs: false,
      allowMerge: false
    },
    mockTickets: [
      {
        key: "GEN-930",
        projectKey: "GEN",
        summary: "Portal dashboard total is stale",
        contextMapping: {
          inScope: true,
          productTarget: "public-app",
          repoTarget: "public-web",
          area: "dashboard",
          feasibility: "feasible",
          confidence: 0.9,
          implementationHint: "Inspect dashboard total calculation"
        },
        ...ticketOverrides
      }
    ]
  };
}

test("workflow approval gate pauses candidates before verification and execution", async () => {
  const { workspace, configPath } = await createWorkflowScenario(buildConfig());

  const summary = await runHarness({
    configPath,
    modeOverride: "triage-and-execution",
    dryRunOverride: true
  });

  assert.equal(summary.triage[0].status_decision, "feasible");
  assert.equal(summary.verification.length, 0);
  assert.equal(summary.execution.length, 0);
  assert.equal(summary.workflow.counts.awaiting_human_approval, 1);
  assert.equal(summary.interactionStats.pending, 0);

  const interactions = JSON.parse(await readFile(path.join(workspace, "interactions.json"), "utf8"));
  assert.equal(interactions.length, 1);
  assert.equal(interactions[0].phase, "candidate_approval");
  assert.equal(interactions[0].status, "awaiting_response");
});

test("workflow approval answer resumes the ticket on the next run", async () => {
  const { workspace, configPath } = await createWorkflowScenario(buildConfig());

  await runHarness({
    configPath,
    modeOverride: "triage-and-execution",
    dryRunOverride: true
  });

  await writeFile(
    configPath,
    JSON.stringify(
      buildConfig({
        interactionResponses: [
          {
            text: "approvo, procedi con analisi e piano",
            respondedAt: new Date(Date.now() + 1000).toISOString()
          }
        ]
      }),
      null,
      2
    )
  );

  const summary = await runHarness({
    configPath,
    modeOverride: "triage-and-execution",
    dryRunOverride: true
  });

  assert.equal(summary.workflow.counts.pr_opened, 1);
  assert.equal(summary.verification[0].status, "approved");
  assert.equal(summary.execution[0].status, "pr_opened");

  const workflow = JSON.parse(await readFile(path.join(workspace, "workflow-state.json"), "utf8"));
  assert.equal(workflow[0].approval.status, "approved");
});
