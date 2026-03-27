import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { renderScanReport, scanWorkspace } from "../src/security/public-hygiene.js";

test("scanWorkspace reports forbidden literal patterns in tracked files", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "malkuth-public-hygiene-"));
  await mkdir(path.join(workspace, "src"), { recursive: true });
  await writeFile(path.join(workspace, "src", "index.js"), "const leaked = 'tenant.acme.internal';\n");

  const result = await scanWorkspace(workspace, {
    enabled: true,
    includePaths: ["src"],
    forbiddenLiteralPatterns: ["tenant.acme.internal"],
    forbiddenRegexPatterns: [],
    exampleFiles: []
  });

  assert.equal(result.issues.filter((issue) => issue.type === "forbidden_pattern").length, 1);
  assert.equal(result.issues.find((issue) => issue.type === "forbidden_pattern")?.type, "forbidden_pattern");
  assert.match(renderScanReport(result), /tenant\.acme\.internal/);
});

test("scanWorkspace rejects non-placeholder values in example config fields", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "malkuth-example-scan-"));
  await mkdir(path.join(workspace, "config"), { recursive: true });
  await writeFile(
    path.join(workspace, "config", "harness.config.example.json"),
    JSON.stringify(
      {
        adapters: {
          jira: {
            mcp: {
              cloudId: "real-company.atlassian.net"
            }
          }
        }
      },
      null,
      2
    )
  );

  const result = await scanWorkspace(workspace, {
    enabled: true,
    includePaths: ["config"],
    forbiddenLiteralPatterns: [],
    forbiddenRegexPatterns: [],
    exampleFiles: [
      {
        path: "config/harness.config.example.json",
        jsonFieldPolicies: [
          {
            path: "adapters.jira.mcp.cloudId",
            allowedLiterals: [""],
            allowedPrefixes: ["your-"]
          }
        ]
      }
    ]
  });

  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].type, "example_field_policy");
  assert.match(result.issues[0].reason, /placeholder-safe/i);
});
