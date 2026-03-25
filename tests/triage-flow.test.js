import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { runHarness } from "../src/orchestration/run-harness.js";

async function runTriageScenario({ mockTickets, existingMemory = [] }) {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "bpopilot-triage-"));
  const configPath = path.join(workspace, "harness.config.json");
  const memoryPath = path.join(workspace, "memory.json");

  const config = {
    mode: "triage-only",
    dryRun: true,
    memory: {
      backend: "file",
      filePath: "./memory.json"
    },
    execution: {
      baseBranch: "BPOFH",
      allowRealPrs: false
    },
    mockTickets
  };

  await writeFile(configPath, JSON.stringify(config, null, 2));
  await writeFile(memoryPath, JSON.stringify(existingMemory, null, 2));

  return runHarness({ configPath, modeOverride: "triage-only", dryRunOverride: true });
}

test("triage marks mapped BpoPilot ticket as feasible", async () => {
  const summary = await runTriageScenario({
    mockTickets: [
      {
        key: "BPO-201",
        projectKey: "BPO",
        summary: "Implement mapped triage decision",
        contextMapping: {
          inScope: true,
          productTarget: "legacy",
          repoTarget: "BPOFH",
          feasibility: "feasible",
          confidence: 0.93,
          implementationHint: "Update BpoPilot triage pipeline"
        }
      }
    ]
  });

  assert.equal(summary.triage[0].status_decision, "feasible");
  assert.equal(summary.triage[0].product_target, "legacy");
});

test("triage marks non automatable ticket as not_feasible", async () => {
  const summary = await runTriageScenario({
    mockTickets: [
      {
        key: "BPO-202",
        projectKey: "BPO",
        summary: "Unknown legacy dependency",
        contextMapping: {
          inScope: true,
          productTarget: "legacy",
          repoTarget: "BPOFH",
          feasibility: "not_feasible",
          confidence: 0.28,
          implementationHint: "Needs manual domain investigation"
        }
      }
    ]
  });

  assert.equal(summary.triage[0].status_decision, "not_feasible");
});

test("triage skips already rejected ticket when no new conditions exist", async () => {
  const summary = await runTriageScenario({
    mockTickets: [
      {
        key: "BPO-203",
        projectKey: "BPO",
        summary: "Previously rejected automation",
        contextMapping: {
          inScope: true,
          productTarget: "legacy",
          repoTarget: "BPOFH",
          feasibility: "feasible"
        }
      }
    ],
    existingMemory: [
      {
        ticket_key: "BPO-203",
        project_key: "BPO",
        product_target: "legacy",
        repo_target: "BPOFH",
        status_decision: "not_feasible",
        confidence: 0.2,
        short_reason: "rejected before",
        implementation_hint: "",
        branch_name: "",
        pr_url: "",
        last_outcome: "not_feasible",
        recheck_conditions: [],
        updated_at: "2026-03-23T00:00:00.000Z"
      }
    ]
  });

  assert.equal(summary.triage[0].status_decision, "skipped_already_rejected");
  assert.equal(summary.triage[0].product_target, "legacy");
});

test("triage skips out-of-scope ticket when llm-context mapping is not in BpoPilot", async () => {
  const summary = await runTriageScenario({
    mockTickets: [
      {
        key: "OPS-204",
        projectKey: "OPS",
        summary: "Infra task outside BpoPilot",
        contextMapping: {
          inScope: false,
          productTarget: "unknown",
          repoTarget: "OPS",
          feasibility: "feasible",
          confidence: 0.1
        }
      }
    ]
  });

  assert.equal(summary.triage[0].status_decision, "skipped_out_of_scope");
  assert.equal(summary.triage[0].product_target, "unknown");
});

test("triage classifies explicit fiscobot tickets into the fiscobot target", async () => {
  const summary = await runTriageScenario({
    mockTickets: [
      {
        key: "FH-205",
        projectKey: "FH",
        summary: "Fiscobot registrazione contabile fallisce su documento importato",
        description: "Errore lato fiscobot sulla registrazione automatica.",
        contextMapping: {
          inScope: true,
          repoTarget: "pubblico+bpofh+fiscobot",
          feasibility: "feasible",
          confidence: 0.91,
          implementationHint: "Controllare registrazione contabile fiscobot"
        }
      }
    ]
  });

  assert.equal(summary.triage[0].status_decision, "feasible");
  assert.equal(summary.triage[0].product_target, "fiscobot");
  assert.equal(summary.triage[0].repo_target, "pubblico+bpofh+fiscobot");
});