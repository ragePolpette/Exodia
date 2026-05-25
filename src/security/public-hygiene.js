import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const defaultSensitiveScan = {
  enabled: false,
  workspaceRoot: "",
  includePaths: ["src", "tests", "config", "README.md", "package.json"],
  forbiddenLiteralPatterns: [],
  forbiddenRegexPatterns: [],
  exampleFiles: [
    {
      path: "config/harness.config.example.json",
      jsonFieldPolicies: [
        { path: "adapters.jira.mcp.cloudId", allowedLiterals: [""], allowedPrefixes: ["your-"] },
        { path: "adapters.llmContext.mcp.workspaceRoot", allowedLiterals: [""], allowedPrefixes: ["C:\\path\\to\\your\\workspace"] },
        { path: "adapters.llmMemory.mcp.namespace", allowedLiterals: [""], allowedPrefixes: ["your-"] },
        { path: "adapters.llmSqlDb.mcp.namespace", allowedLiterals: [""], allowedPrefixes: ["your-"] },
        { path: "adapters.bitbucket.mcp.repository", allowedLiterals: [""], allowedPrefixes: ["your-"] },
        { path: "adapters.bitbucket.mcp.project", allowedLiterals: [""], allowedLiteralsCaseSensitive: ["YOUR_PROJECT"] },
        { path: "adapters.bitbucket.mcp.workspaceRoot", allowedLiterals: [""], allowedPrefixes: ["C:\\path\\to\\your\\workspace"] },
        { path: "execution.baseBranch", allowedLiterals: ["main", ""] },
        { path: "execution.workspaceRoot", allowedLiterals: [""], allowedPrefixes: ["C:\\path\\to\\your\\workspace"] }
      ]
    },
    {
      path: "config/harness.config.mcp.example.json",
      jsonFieldPolicies: [
        { path: "adapters.jira.mcp.cloudId", allowedLiterals: [""], allowedPrefixes: ["your-"] },
        { path: "adapters.llmContext.mcp.workspaceRoot", allowedLiterals: [""], allowedPrefixes: ["C:\\path\\to\\your\\workspace"] },
        { path: "adapters.llmMemory.mcp.namespace", allowedLiterals: [""], allowedPrefixes: ["your-"] },
        { path: "adapters.llmSqlDb.mcp.namespace", allowedLiterals: [""], allowedPrefixes: ["your-"] },
        { path: "adapters.bitbucket.mcp.repository", allowedLiterals: [""], allowedPrefixes: ["your-"] },
        { path: "adapters.bitbucket.mcp.project", allowedLiterals: [""], allowedLiteralsCaseSensitive: ["YOUR_PROJECT"] },
        { path: "adapters.bitbucket.mcp.workspaceRoot", allowedLiterals: [""], allowedPrefixes: ["C:\\path\\to\\your\\workspace"] },
        { path: "execution.baseBranch", allowedLiterals: ["main", ""] },
        { path: "execution.workspaceRoot", allowedLiterals: [""], allowedPrefixes: ["C:\\path\\to\\your\\workspace"] }
      ]
    },
    {
      path: "config/harness.config.real.example.json",
      jsonFieldPolicies: [
        { path: "adapters.jira.mcp.cloudId", allowedLiterals: [""], allowedPrefixes: ["your-"] },
        { path: "adapters.llmContext.mcp.workspaceRoot", allowedLiterals: [""], allowedPrefixes: ["C:\\path\\to\\your\\workspace"] },
        { path: "adapters.llmMemory.mcp.namespace", allowedLiterals: [""], allowedPrefixes: ["your-"] },
        { path: "adapters.llmSqlDb.mcp.namespace", allowedLiterals: [""], allowedPrefixes: ["your-"] },
        { path: "adapters.bitbucket.mcp.repository", allowedLiterals: [""], allowedPrefixes: ["your-"] },
        { path: "adapters.bitbucket.mcp.project", allowedLiterals: [""], allowedLiteralsCaseSensitive: ["YOUR_PROJECT"] },
        { path: "adapters.bitbucket.mcp.workspaceRoot", allowedLiterals: [""], allowedPrefixes: ["C:\\path\\to\\your\\workspace"] },
        { path: "execution.baseBranch", allowedLiterals: ["main", ""] },
        { path: "execution.workspaceRoot", allowedLiterals: [""], allowedPrefixes: ["C:\\path\\to\\your\\workspace"] }
      ]
    },
    {
      path: "config/harness.config.triage.codex-local.example.json",
      jsonFieldPolicies: [
        { path: "adapters.jira.mcp.cloudId", allowedLiterals: [""], allowedPrefixes: ["your-"] },
        { path: "adapters.llmContext.mcp.workspaceRoot", allowedLiterals: [""], allowedPrefixes: ["C:\\path\\to\\your\\workspace"] },
        { path: "adapters.llmMemory.mcp.namespace", allowedLiterals: [""], allowedPrefixes: ["your-"] },
        { path: "adapters.llmSqlDb.mcp.namespace", allowedLiterals: [""], allowedPrefixes: ["your-"] },
        { path: "adapters.bitbucket.mcp.repository", allowedLiterals: [""], allowedPrefixes: ["your-"] },
        { path: "adapters.bitbucket.mcp.project", allowedLiterals: [""], allowedLiteralsCaseSensitive: ["YOUR_PROJECT"] },
        { path: "adapters.bitbucket.mcp.workspaceRoot", allowedLiterals: [""], allowedPrefixes: ["C:\\path\\to\\your\\workspace"] },
        { path: "execution.baseBranch", allowedLiterals: ["main", ""] },
        { path: "execution.workspaceRoot", allowedLiterals: [""], allowedPrefixes: ["C:\\path\\to\\your\\workspace"] }
      ]
    }
  ]
};

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function mergeObjects(base, override) {
  if (!isObject(base) || !isObject(override)) {
    return override ?? base;
  }

  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    result[key] =
      key in base ? mergeObjects(base[key], value) : Array.isArray(value) ? [...value] : value;
  }

  return result;
}

export function resolveSensitiveScanConfig(config = {}) {
  const resolved = mergeObjects(defaultSensitiveScan, config);

  if (!Array.isArray(resolved.includePaths) || resolved.includePaths.length === 0) {
    resolved.includePaths = [...defaultSensitiveScan.includePaths];
  }

  if (!Array.isArray(resolved.exampleFiles) || resolved.exampleFiles.length === 0) {
    resolved.exampleFiles = [...defaultSensitiveScan.exampleFiles];
  }

  return resolved;
}

async function listFiles(rootPath, relativePath) {
  const absolutePath = path.join(rootPath, relativePath);
  const entries = await readdir(absolutePath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const childRelativePath = path.posix.join(relativePath.replace(/\\/g, "/"), entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(rootPath, childRelativePath)));
      continue;
    }

    if (entry.isFile()) {
      files.push(childRelativePath);
    }
  }

  return files;
}

async function resolveCandidateFiles(workspaceRoot, includePaths) {
  const files = [];

  for (const includePath of includePaths) {
    const normalizedPath = includePath.replace(/\\/g, "/");
    const absolutePath = path.join(workspaceRoot, normalizedPath);

    try {
      const stats = await readdir(absolutePath, { withFileTypes: true });
      const isDirectory = Array.isArray(stats);
      if (isDirectory) {
        files.push(...(await listFiles(workspaceRoot, normalizedPath)));
        continue;
      }
    } catch {
      try {
        await readFile(absolutePath, "utf8");
        files.push(normalizedPath);
      } catch {
        // ignore missing include paths
      }
    }
  }

  return [...new Set(files)];
}

function buildForbiddenMatchers(config) {
  return [
    ...config.forbiddenLiteralPatterns.map((pattern) => ({
      type: "literal",
      pattern,
      matches(text) {
        return typeof pattern === "string" && pattern.length > 0 && text.includes(pattern);
      }
    })),
    ...config.forbiddenRegexPatterns.map((pattern) => {
      const expression = pattern instanceof RegExp ? pattern : new RegExp(pattern, "i");
      return {
        type: "regex",
        pattern: expression.toString(),
        matches(text) {
          return expression.test(text);
        }
      };
    })
  ];
}

function getByPath(object, dottedPath) {
  return dottedPath.split(".").reduce((value, key) => value?.[key], object);
}

function isAllowedExampleValue(value, policy) {
  if (typeof value !== "string") {
    return value === undefined || value === null;
  }

  if ((policy.allowedLiterals ?? []).includes(value)) {
    return true;
  }

  if ((policy.allowedLiteralsCaseSensitive ?? []).includes(value)) {
    return true;
  }

  return (policy.allowedPrefixes ?? []).some((prefix) => value.startsWith(prefix));
}

function formatIssue(type, filePath, reason, match = "") {
  return {
    type,
    filePath,
    reason,
    match
  };
}

export async function scanWorkspace(workspaceRoot, config = {}) {
  const resolvedConfig = resolveSensitiveScanConfig(config);
  if (!resolvedConfig.enabled) {
    return { issues: [], scannedFiles: [] };
  }

  const files = await resolveCandidateFiles(workspaceRoot, resolvedConfig.includePaths);
  const issues = [];
  const matchers = buildForbiddenMatchers(resolvedConfig);

  for (const filePath of files) {
    const absolutePath = path.join(workspaceRoot, filePath);
    let content = "";

    try {
      content = await readFile(absolutePath, "utf8");
    } catch {
      continue;
    }

    for (const matcher of matchers) {
      if (!matcher.matches(content)) {
        continue;
      }

      issues.push(
        formatIssue(
          "forbidden_pattern",
          filePath,
          `matched ${matcher.type} forbidden pattern`,
          matcher.pattern
        )
      );
    }
  }

  for (const exampleFile of resolvedConfig.exampleFiles ?? []) {
    const absolutePath = path.join(workspaceRoot, exampleFile.path);

    try {
      const raw = await readFile(absolutePath, "utf8");
      const parsed = JSON.parse(raw);

      for (const policy of exampleFile.jsonFieldPolicies ?? []) {
        const value = getByPath(parsed, policy.path);
        if (isAllowedExampleValue(value, policy)) {
          continue;
        }

        issues.push(
          formatIssue(
            "example_field_policy",
            exampleFile.path,
            `example field ${policy.path} is not placeholder-safe`,
            `${value ?? ""}`
          )
        );
      }
    } catch (error) {
      issues.push(
        formatIssue(
          "example_file_error",
          exampleFile.path,
          `failed to inspect example file: ${error.message}`
        )
      );
    }
  }

  return {
    issues,
    scannedFiles: files
  };
}

export function renderScanReport(result) {
  const issues = result?.issues ?? [];
  const scannedFiles = result?.scannedFiles ?? [];
  const lines = [
    "Exodia Public Hygiene Audit",
    `Scanned files: ${scannedFiles.length}`,
    `Issues: ${issues.length}`
  ];

  for (const issue of issues) {
    lines.push(`- ${issue.filePath}: ${issue.reason}${issue.match ? ` | ${issue.match}` : ""}`);
  }

  return lines.join("\n");
}
