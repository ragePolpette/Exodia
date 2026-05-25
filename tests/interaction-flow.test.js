import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { runHarness } from "../src/orchestration/run-harness.js";

async function writeConfig(configPath, config) {
  await writeFile(configPath, JSON.stringify(config, null, 2));
}

function createBaseConfig(workspace) {
  return {
    mode: "triage-only",
    dryRun: true,
    memory: {
      backend: "file",
      filePath: "./memory.json"
    },
    interaction: {
      enabled: true,
      mode: "deferred",
      storeFile: "./interactions.json",
      destinations: "both",
      allowedPhases: ["triage", "verification"],
      maxQuestionsPerTicket: 1,
      captureToSemanticMemory: true,
      captureToTicketMemory: true,
      transports: {
        slack: {
          enabled: true,
          server: "slack-mcp",
          postAction: "postMessage",
          collectRepliesAction: "listThreadReplies",
          channel: "#exodia-triage"
        },
        ticket: {
          enabled: true,
          commentPrefix: "[Exodia]"
        }
      }
    },
    execution: {
      enabled: false,
      dryRun: true,
      baseBranch: "main",
      allowRealPrs: false,
      allowMerge: false,
      workspaceRoot: workspace
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
          projectKeys: ["GEN"]
        }
      ]
    },
    mcpBridge: {
      mode: "fixture",
      fixtures: {
        "slack-mcp.postMessage": {
          channel: "#exodia-triage",
          threadTs: "thread-1",
          messageTs: "message-1"
        }
      }
    },
    mockTickets: [
      {
        key: "GEN-701",
        projectKey: "GEN",
        summary: "Legacy issue requires clarification",
        description: "The failing area is not entirely clear.",
        contextMapping: {
          inScope: true,
          productTarget: "legacy",
          repoTarget: "core-app",
          feasibility: "feasible_low_confidence",
          confidence: 0.61,
          implementationHint: "Inspect the mapped area"
        }
      }
    ]
  };
}

test("triage stores a pending interaction and blocks the ticket while awaiting response", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "exodia-interaction-pending-"));
  const configPath = path.join(workspace, "harness.config.json");
  const interactionStorePath = path.join(workspace, "interactions.json");
  const config = createBaseConfig(workspace);

  await writeConfig(configPath, config);

  const summary = await runHarness({
    configPath,
    modeOverride: "triage-only",
    dryRunOverride: true
  });

  assert.equal(summary.triage[0].status_decision, "blocked");
  assert.equal(summary.triage[0].last_outcome, "awaiting_input");
  assert.match(summary.triage[0].short_reason, /awaiting human clarification/i);

  const storedInteractions = JSON.parse(await readFile(interactionStorePath, "utf8"));
  assert.equal(storedInteractions.length, 1);
  assert.equal(storedInteractions[0].status, "awaiting_response");
  assert.deepEqual(storedInteractions[0].destinations, ["slack", "ticket"]);
});

test("the next run resolves the first response and prefers Slack over later ticket replies", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "exodia-interaction-resume-"));
  const configPath = path.join(workspace, "harness.config.json");
  const interactionStorePath = path.join(workspace, "interactions.json");
  const firstConfig = createBaseConfig(workspace);

  await writeConfig(configPath, firstConfig);
  await runHarness({
    configPath,
    modeOverride: "triage-only",
    dryRunOverride: true
  });

  const secondConfig = createBaseConfig(workspace);
  secondConfig.mcpBridge.fixtures["slack-mcp.listThreadReplies"] = {
    responses: [
      {
        id: "slack-reply-1",
        text: "Confirm product legacy and repo: core-app. The issue is in the shared validation flow.",
        author: "ops-user",
        respondedAt: "2099-03-27T10:00:00.000Z"
      }
    ]
  };
  secondConfig.mockTickets[0].interactionResponses = [
    {
      id: "jira-reply-1",
      text: "Maybe check repo: another-repo later.",
      author: "jira-user",
      respondedAt: "2099-03-27T11:00:00.000Z"
    }
  ];

  await writeConfig(configPath, secondConfig);

  const summary = await runHarness({
    configPath,
    modeOverride: "triage-only",
    dryRunOverride: true
  });

  assert.equal(summary.interactionStats.pending, 0);
  assert.equal(summary.interactionStats.resolved, 1);
  assert.equal(summary.triage[0].status_decision, "feasible");
  assert.match(summary.triage[0].clarification_summary, /shared validation flow/i);

  const storedInteractions = JSON.parse(await readFile(interactionStorePath, "utf8"));
  assert.equal(storedInteractions[0].status, "resolved");
  assert.equal(storedInteractions[0].response.source, "slack");
});

test("a non-blocking interaction response is integrated on the next run without pausing the first run", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "exodia-interaction-advisory-"));
  const configPath = path.join(workspace, "harness.config.json");
  const interactionStorePath = path.join(workspace, "interactions.json");
  const config = createBaseConfig(workspace);

  config.mcpBridge.fixtures = {};
  await writeConfig(configPath, config);
  await writeFile(
    interactionStorePath,
    JSON.stringify([
      {
        id: "advisory-1",
        ticketKey: "GEN-701",
        projectKey: "GEN",
        phase: "triage",
        status: "awaiting_response",
        blocking: false,
        question: "Can you share one mismatching example?",
        reason: "advisory clarification",
        destinations: ["ticket"],
        createdAt: "2099-03-27T09:00:00.000Z",
        updatedAt: "2099-03-27T09:00:00.000Z",
        transportState: {}
      }
    ], null, 2)
  );

  config.mockTickets[0].interactionResponses = [
    {
      id: "jira-reply-advisory",
      text: "For March 2026 the dashboard shows 1200 while the export shows 980.",
      author: "jira-user",
      respondedAt: "2099-03-27T10:00:00.000Z"
    }
  ];
  await writeConfig(configPath, config);

  const summary = await runHarness({
    configPath,
    modeOverride: "triage-only",
    dryRunOverride: true
  });

  assert.equal(summary.interactionStats.pending, 0);
  assert.equal(summary.interactionStats.resolved, 1);
  assert.match(summary.triage[0].clarification_summary, /dashboard shows 1200 while the export shows 980/i);

  const storedInteractions = JSON.parse(await readFile(interactionStorePath, "utf8"));
  assert.equal(storedInteractions[0].status, "resolved");
  assert.equal(storedInteractions[0].blocking, false);
});
