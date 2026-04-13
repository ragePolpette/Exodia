import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveSensitiveScanConfig, scanWorkspace } from "../security/public-hygiene.js";

const publishReadinessDefaults = {
  requiredDocs: [
    {
      path: "README.md",
      requiredRegexPatterns: [
        "not intended for deployment as a publicly exposed service",
        "do not use file `\\.env`",
        "human-in-the-loop",
        "slack",
        "resume"
      ]
    },
    {
      path: "config/LOCAL_CONFIGURATION.md",
      requiredRegexPatterns: [
        "non usare file `\\.env`",
        "non creare `\\.env\\.local`",
        "mcp-dashboard"
      ]
    }
  ],
  forbiddenContentRules: [
    {
      path: "README.md",
      forbiddenSnippets: ["- `.env.local`", "- `.env`"]
    },
    {
      path: "config/LOCAL_CONFIGURATION.md",
      forbiddenSnippets: ["- `.env.local`", "- `.env`"]
    },
    {
      path: ".gitignore",
      forbiddenRegexPatterns: ["^\\.env$", "^\\.env\\.local$"]
    }
  ],
  trackedExamples: [
    "config/harness.config.example.json",
    "config/harness.config.mcp.example.json",
    "config/harness.config.real.example.json",
    "config/harness.config.triage.codex-local.example.json"
  ]
};

function formatCheck(status, name, details = "") {
  return { status, name, details };
}

export async function runPublishReadinessReview(workspaceRoot, config = {}) {
  const resolvedSensitiveScan = resolveSensitiveScanConfig({
    ...config,
    enabled: true
  });
  const hygieneResult = await scanWorkspace(workspaceRoot, resolvedSensitiveScan);
  const checks = [];

  checks.push(
    hygieneResult.issues.length === 0
      ? formatCheck("passed", "public_hygiene", "no sensitive scan issues")
      : formatCheck(
          "failed",
          "public_hygiene",
          hygieneResult.issues.slice(0, 5).map((issue) => `${issue.filePath}: ${issue.reason}`).join(", ")
        )
  );

  for (const examplePath of publishReadinessDefaults.trackedExamples) {
    const absolutePath = path.join(workspaceRoot, examplePath);
    try {
      await readFile(absolutePath, "utf8");
      checks.push(formatCheck("passed", `tracked_example:${examplePath}`, "file exists"));
    } catch (error) {
      checks.push(formatCheck("failed", `tracked_example:${examplePath}`, error.message));
    }
  }

  for (const docRule of publishReadinessDefaults.requiredDocs) {
    const absolutePath = path.join(workspaceRoot, docRule.path);
    try {
      const content = await readFile(absolutePath, "utf8");
      for (const snippet of docRule.requiredSnippets ?? []) {
        checks.push(
          content.includes(snippet)
            ? formatCheck("passed", `doc_required:${docRule.path}`, snippet)
            : formatCheck("failed", `doc_required:${docRule.path}`, `missing snippet: ${snippet}`)
        );
      }

      for (const pattern of docRule.requiredRegexPatterns ?? []) {
        const expression = new RegExp(pattern, "i");
        checks.push(
          expression.test(content)
            ? formatCheck("passed", `doc_required:${docRule.path}`, pattern)
            : formatCheck("failed", `doc_required:${docRule.path}`, `missing pattern: ${pattern}`)
        );
      }
    } catch (error) {
      checks.push(formatCheck("failed", `doc_required:${docRule.path}`, error.message));
    }
  }

  for (const rule of publishReadinessDefaults.forbiddenContentRules) {
    const absolutePath = path.join(workspaceRoot, rule.path);
    try {
      const content = await readFile(absolutePath, "utf8");
      for (const snippet of rule.forbiddenSnippets ?? []) {
        checks.push(
          content.includes(snippet)
            ? formatCheck("failed", `forbidden_snippet:${rule.path}`, `forbidden snippet present: ${snippet}`)
            : formatCheck("passed", `forbidden_snippet:${rule.path}`, `snippet not present: ${snippet}`)
        );
      }

      for (const pattern of rule.forbiddenRegexPatterns ?? []) {
        const expression = new RegExp(pattern, "m");
        checks.push(
          expression.test(content)
            ? formatCheck("failed", `forbidden_regex:${rule.path}`, `forbidden pattern present: ${pattern}`)
            : formatCheck("passed", `forbidden_regex:${rule.path}`, `pattern not present: ${pattern}`)
        );
      }
    } catch (error) {
      checks.push(formatCheck("failed", `forbidden_content:${rule.path}`, error.message));
    }
  }

  return {
    status: checks.every((check) => check.status === "passed") ? "passed" : "failed",
    checks,
    hygiene: hygieneResult
  };
}

export function renderPublishReadinessReport(result) {
  const lines = [
    "Malkuth Publish Readiness Review",
    `Status: ${result.status}`,
    `Checks: ${result.checks.length}`,
    `Hygiene issues: ${result.hygiene?.issues?.length ?? 0}`
  ];

  for (const check of result.checks) {
    lines.push(`- ${check.status}: ${check.name}${check.details ? ` | ${check.details}` : ""}`);
  }

  return lines.join("\n");
}
