import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import {
  renderPublishReadinessReport,
  runPublishReadinessReview
} from "../src/review/publish-readiness.js";
import { resolveWorkspaceRootForChecks } from "../src/review/resolve-check-workspace.js";

async function createWorkspace() {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "exodia-publish-review-"));
  await mkdir(path.join(workspace, "config"), { recursive: true });
  await mkdir(path.join(workspace, "src"), { recursive: true });
  await mkdir(path.join(workspace, "tests"), { recursive: true });

  await writeFile(
    path.join(workspace, "README.md"),
    [
      "# Exodia",
      "It is not intended for deployment as a publicly exposed service.",
      "Human-in-the-loop questions can be routed to Slack.",
      "The next run can resume from the first valid answer.",
      "Authentication: do not use file `.env`."
    ].join("\n")
  );
  await writeFile(
    path.join(workspace, "config", "LOCAL_CONFIGURATION.md"),
    [
      "# Local",
      "non usare file `.env`",
      "non creare `.env.local`",
      "usa mcp-dashboard"
    ].join("\n")
  );
  await writeFile(path.join(workspace, ".gitignore"), "config/local/\n");

  for (const fileName of [
    "harness.config.example.json",
    "harness.config.mcp.example.json",
    "harness.config.real.example.json",
    "harness.config.triage.codex-local.example.json"
  ]) {
    await writeFile(
      path.join(workspace, "config", fileName),
      JSON.stringify(
        {
          adapters: {
            jira: { mcp: { cloudId: "your-site.atlassian.net" } },
            llmContext: { mcp: { workspaceRoot: "C:\\path\\to\\your\\workspace" } },
            llmMemory: { mcp: { namespace: "your-harness-namespace" } },
            llmSqlDb: { mcp: { namespace: "your-harness-namespace" } },
            bitbucket: {
              mcp: {
                repository: "your-repository",
                project: "YOUR_PROJECT",
                workspaceRoot: "C:\\path\\to\\your\\workspace"
              }
            }
          },
          execution: {
            baseBranch: "main",
            workspaceRoot: "C:\\path\\to\\your\\workspace"
          }
        },
        null,
        2
      )
    );
  }

  return workspace;
}

test("publish readiness review passes for a portfolio-safe workspace", async () => {
  const workspace = await createWorkspace();
  const result = await runPublishReadinessReview(workspace, {
    enabled: true,
    includePaths: ["src", "tests", "config", "README.md", "package.json"],
    forbiddenLiteralPatterns: ["secret-value"],
    forbiddenRegexPatterns: []
  });

  assert.equal(result.status, "passed");
  assert.match(renderPublishReadinessReport(result), /Publish Readiness Review/);
});

test("publish readiness review fails when docs still mention env workflow", async () => {
  const workspace = await createWorkspace();
  await writeFile(path.join(workspace, ".gitignore"), ".env.local\n");

  const result = await runPublishReadinessReview(workspace, {
    enabled: true,
    includePaths: ["config", "README.md", ".gitignore"],
    forbiddenLiteralPatterns: [],
    forbiddenRegexPatterns: []
  });

  assert.equal(result.status, "failed");
  assert.ok(
    result.checks.some(
      (check) =>
        check.status === "failed" &&
        check.name === "forbidden_regex:.gitignore" &&
        /forbidden pattern present/i.test(check.details)
    )
  );
});

test("check workspace resolution prefers configured workspace roots before cwd", async () => {
  const workspace = await createWorkspace();
  const alternateWorkspace = await mkdtemp(path.join(os.tmpdir(), "exodia-check-workspace-"));

  const resolved = await resolveWorkspaceRootForChecks(
    {
      verification: {
        sensitiveScan: {
          workspaceRoot: path.join(alternateWorkspace, "missing")
        }
      },
      execution: {
        workspaceRoot: workspace
      }
    },
    alternateWorkspace
  );

  assert.equal(resolved, workspace);
});
