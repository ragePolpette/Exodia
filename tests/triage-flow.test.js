import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { runHarness } from "../src/orchestration/run-harness.js";

async function runTriageScenario({ mockTickets, existingMemory = [] }) {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "legacy-suite-triage-"));
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
      baseBranch: "main",
      allowRealPrs: false
    },
    targeting: {
      rules: [
        {
          target: "legacy",
          repoTarget: "core-app",
          area: "core-platform",
          inScope: true,
          feasibility: "feasible",
          implementationHint: "Inspect core platform code",
          aliases: ["legacy-suite"],
          scopeAliases: ["coreapp"],
          projectKeys: ["LEG"]
        },
        {
          target: "financebot",
          repoTarget: "automation-suite",
          area: "automation-workflows",
          inScope: true,
          feasibility: "feasible",
          implementationHint: "Inspect automation workflows",
          aliases: ["financebot"],
          scopeAliases: ["automation"],
          projectKeys: ["BOT"]
        }
      ]
    },
    mockTickets
  };

  await writeFile(configPath, JSON.stringify(config, null, 2));
  await writeFile(memoryPath, JSON.stringify(existingMemory, null, 2));

  return runHarness({ configPath, modeOverride: "triage-only", dryRunOverride: true });
}

test("triage marks mapped LegacySuite ticket as feasible", async () => {
  const summary = await runTriageScenario({
    mockTickets: [
      {
        key: "LEG-201",
        projectKey: "LEG",
        summary: "Implement mapped triage decision",
        contextMapping: {
          inScope: true,
          productTarget: "legacy",
          repoTarget: "core-app",
          feasibility: "feasible",
          confidence: 0.93,
          implementationHint: "Update LegacySuite triage pipeline"
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
        key: "LEG-202",
        projectKey: "LEG",
        summary: "Unknown legacy dependency",
        contextMapping: {
          inScope: true,
          productTarget: "legacy",
          repoTarget: "core-app",
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
        key: "LEG-203",
        projectKey: "LEG",
        summary: "Previously rejected automation",
        contextMapping: {
          inScope: true,
          productTarget: "legacy",
          repoTarget: "core-app",
          feasibility: "feasible"
        }
      }
    ],
    existingMemory: [
      {
        ticket_key: "LEG-203",
        project_key: "LEG",
        product_target: "legacy",
        repo_target: "core-app",
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

test("triage skips out-of-scope ticket when llm-context mapping is not in LegacySuite", async () => {
  const summary = await runTriageScenario({
    mockTickets: [
      {
        key: "OPS-204",
        projectKey: "OPS",
        summary: "Infra task outside LegacySuite",
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

test("triage classifies explicit financebot tickets into the financebot target", async () => {
  const summary = await runTriageScenario({
    mockTickets: [
      {
        key: "BOT-205",
        projectKey: "BOT",
        summary: "FinanceBot registrazione contabile fallisce su documento importato",
        description: "Errore lato financebot sulla registrazione automatica.",
        contextMapping: {
          inScope: true,
          repoTarget: "public-web+shared-lib+financebot",
          feasibility: "feasible",
          confidence: 0.91,
          implementationHint: "Controllare registrazione contabile financebot"
        }
      }
    ]
  });

  assert.equal(summary.triage[0].status_decision, "feasible");
  assert.equal(summary.triage[0].product_target, "financebot");
  assert.equal(summary.triage[0].repo_target, "public-web+shared-lib+financebot");
});

test("triage uses configured mapping defaults when context omits area and feasibility", async () => {
  const summary = await runTriageScenario({
    mockTickets: [
      {
        key: "LEG-206",
        projectKey: "LEG",
        summary: "Legacy-suite dashboard issue",
        contextMapping: {
          inScope: true,
          productTarget: "legacy",
          confidence: 0.84
        }
      }
    ]
  });

  assert.equal(summary.triage[0].status_decision, "feasible");
  assert.equal(summary.triage[0].repo_target, "core-app");
  assert.equal(summary.triage[0].implementation_hint, "Inspect core platform code");
});
