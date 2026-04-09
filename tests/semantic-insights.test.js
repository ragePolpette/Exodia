import test from "node:test";
import assert from "node:assert/strict";

import {
  buildExecutionInsight,
  buildTriageInsight
} from "../src/memory/semantic-insights.js";

test("buildTriageInsight stores high-signal feasible mappings", () => {
  const insight = buildTriageInsight(
    { key: "WEB-1", summary: "Public portal invoice issue" },
    {
      hints: ["public-web\\api\\Controllers\\InvoiceController.cs"],
      blockers: []
    },
    {
      product_target: "webportal",
      repo_target: "public-web",
      status_decision: "feasible",
      confidence: 0.82,
      short_reason: "ticket mapped to webportal and looks actionable",
      implementation_hint: "Inspect public-web/api/Controllers/InvoiceController.cs",
      recheck_conditions: []
    }
  );

  assert.equal(insight.phase, "triage");
  assert.equal(insight.ticketKey, "WEB-1");
  assert.match(insight.content, /InvoiceController\.cs/);
});

test("buildTriageInsight skips low-signal feasible mappings", () => {
  const insight = buildTriageInsight(
    { key: "WEB-2", summary: "Generic portal issue" },
    {
      hints: [],
      blockers: []
    },
    {
      product_target: "webportal",
      repo_target: "public-web",
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
    { key: "GEN-1", summary: "Open PR" },
    {
      product_target: "legacy",
      repo_target: "core-app",
      confidence: 0.9
    },
    {
      status: "pr_opened",
      reason: "opened pull request",
      branchName: "gen-1-open-pr",
      pullRequestUrl: "https://example.invalid/pr/1",
      productTarget: "legacy",
      repoTarget: "core-app"
    }
  );

  assert.equal(insight.phase, "execution");
  assert.match(insight.content, /opened pull request/);
  assert.match(insight.content, /\[redacted:url\]/);
});
