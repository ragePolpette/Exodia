import test from "node:test";
import assert from "node:assert/strict";

import {
  buildExecutionInsight,
  buildTriageInsight
} from "../src/memory/semantic-insights.js";

test("buildTriageInsight stores high-signal feasible mappings", () => {
  const insight = buildTriageInsight(
    { key: "DEVFH-1", summary: "Errore fattura" },
    {
      hints: ["pubblico\\api\\Controllers\\Fattura.cs"],
      blockers: []
    },
    {
      product_target: "fatturhello",
      repo_target: "pubblico",
      status_decision: "feasible",
      confidence: 0.82,
      short_reason: "ticket mapped to fatturhello and looks actionable",
      implementation_hint: "Inspect pubblico/api/Controllers/Fattura.cs",
      recheck_conditions: []
    }
  );

  assert.equal(insight.phase, "triage");
  assert.equal(insight.ticketKey, "DEVFH-1");
  assert.match(insight.content, /Fattura\.cs/);
});

test("buildTriageInsight skips low-signal feasible mappings", () => {
  const insight = buildTriageInsight(
    { key: "DEVFH-2", summary: "Errore generico" },
    {
      hints: [],
      blockers: []
    },
    {
      product_target: "fatturhello",
      repo_target: "pubblico",
      status_decision: "feasible",
      confidence: 0.61,
      short_reason: "generic mapping",
      implementation_hint: "",
      recheck_conditions: []
    }
  );

  assert.equal(insight, null);
});

test("buildExecutionInsight stores meaningful execution outcomes", () => {
  const insight = buildExecutionInsight(
    { key: "BPO-1", summary: "Apri PR" },
    {
      product_target: "legacy",
      repo_target: "api+asp",
      confidence: 0.9
    },
    {
      status: "pr_opened",
      reason: "opened pull request",
      branchName: "bpo-1-apri-pr",
      pullRequestUrl: "https://example.invalid/pr/1",
      productTarget: "legacy",
      repoTarget: "api+asp"
    }
  );

  assert.equal(insight.phase, "execution");
  assert.match(insight.content, /opened pull request/);
  assert.match(insight.content, /example\.invalid/);
});
