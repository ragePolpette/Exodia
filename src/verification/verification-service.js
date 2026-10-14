import { assertAuditVerdict, assertVerificationStatus } from "../contracts/harness-contracts.js";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { scanWorkspace } from "../security/public-hygiene.js";

const execFileAsync = promisify(execFile);

const branchNamePattern = /^[A-Za-z0-9]+(?:[/-][A-Za-z0-9]+)*$/;
const defaultPreflightTimeoutMs = 300000;
const defaultPreflightMaxBufferBytes = 10 * 1024 * 1024;
const defaultDiffGate = {
  maxFiles: 25,
  maxChangedLines: 1000
};

function positiveNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function parseNumstat(stdout) {
  return `${stdout ?? ""}`
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [added, deleted, ...rest] = line.split("\t");
      return {
        path: normalizePath(rest.join("\t")),
        added: Number(added) || 0,
        deleted: Number(deleted) || 0,
        binary: added === "-" || deleted === "-"
      };
    });
}

function countLines(content) {
  if (!content) {
    return 0;
  }

  const lines = content.split(/\r?\n/);
  return lines.at(-1) === "" ? lines.length - 1 : lines.length;
}

function normalizePath(value) {
  return `${value ?? ""}`
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+/g, "/");
}

function isAllowedCommand(command, args, allowedPrefixes) {
  if (!Array.isArray(allowedPrefixes) || allowedPrefixes.length === 0) {
    return false;
  }

  const sequence = [command, ...args];
  return allowedPrefixes.some((prefix) =>
    Array.isArray(prefix) &&
    prefix.length > 0 &&
    prefix.every((segment, index) => sequence[index] === segment)
  );
}

function parseGitStatusPaths(stdout) {
  return `${stdout ?? ""}`
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => line.slice(3).trim())
    .map((entry) => {
      if (entry.includes(" -> ")) {
        return entry.split(" -> ").at(-1);
      }

      return entry;
    })
    .map((entry) => normalizePath(entry))
    .filter(Boolean);
}

function normalizeStatus(status) {
  assertVerificationStatus(status);
  return status;
}

function hasConcreteTarget(value) {
  const normalized = `${value ?? ""}`.trim();
  return normalized && normalized !== "unknown" && normalized !== "UNKNOWN";
}

function isPathInside(basePath, candidatePath) {
  const relativePath = path.relative(basePath, candidatePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function decorateResult(base, extras = {}) {
  return {
    ...base,
    auditVerdict: extras.auditVerdict ?? base.auditVerdict ?? "",
    auditSummary: extras.auditSummary ?? base.auditSummary ?? "",
    auditIssues: extras.auditIssues ?? base.auditIssues ?? [],
    refinementRequests: extras.refinementRequests ?? base.refinementRequests ?? [],
    refinementIterations: extras.refinementIterations ?? base.refinementIterations ?? 0,
    refinedDecision: extras.refinedDecision ?? base.refinedDecision ?? null,
    analysisArtifact: extras.analysisArtifact ?? base.analysisArtifact ?? null
  };
}

export class VerificationService {
  constructor(config = {}) {
    this.config = {
      enabled: config.enabled ?? true,
      minConfidence: config.minConfidence ?? 0.75,
      maxCommitMessageLength: config.maxCommitMessageLength ?? 120,
      maxPullRequestTitleLength: config.maxPullRequestTitleLength ?? 120,
      allowedPathPrefixesByRepo: config.allowedPathPrefixesByRepo ?? {},
      preflightCommands: config.preflightCommands ?? [],
      allowedCommandPrefixes: config.allowedCommandPrefixes ?? [],
      preflightTimeoutMs: positiveNumber(config.preflightTimeoutMs, defaultPreflightTimeoutMs),
      preflightMaxBufferBytes: positiveNumber(config.preflightMaxBufferBytes, defaultPreflightMaxBufferBytes),
      diffGate: {
        enabled: config.diffGate?.enabled ?? true,
        maxFiles: positiveNumber(config.diffGate?.maxFiles, defaultDiffGate.maxFiles),
        maxChangedLines: positiveNumber(config.diffGate?.maxChangedLines, defaultDiffGate.maxChangedLines)
      },
      sensitiveScan: config.sensitiveScan ?? { enabled: false }
    };
  }

  buildResult(item, status, reason, payload = {}, extras = {}) {
    const normalizedStatus = normalizeStatus(status);
    return decorateResult(
      {
        ticketKey: item.ticket.key,
        projectKey: item.ticket.projectKey,
        productTarget: item.decision.product_target,
        repoTarget: item.decision.repo_target,
        status: normalizedStatus,
        reason,
        branchName: payload.branchName ?? "",
        commitMessage: payload.commitMessage ?? "",
        pullRequestTitle: payload.pullRequestTitle ?? ""
      },
      extras
    );
  }

  applyAuditVerdict(item, payload, result, audit = null, extras = {}) {
    if (!audit) {
      return decorateResult(result, extras);
    }

    assertAuditVerdict(audit.verdict);
    const auditExtras = {
      ...extras,
      auditVerdict: audit.verdict,
      auditSummary: audit.summary ?? "",
      auditIssues: audit.issues ?? [],
      refinementRequests: audit.refinementRequests ?? []
    };

    if (audit.verdict === "blocked") {
      return this.buildResult(
        item,
        "blocked",
        audit.summary || "audit blocked the proposal",
        payload,
        auditExtras
      );
    }

    if (audit.verdict === "needs_refinement") {
      return this.buildResult(
        item,
        result.status === "blocked" ? "blocked" : "needs_review",
        audit.summary || "audit requires refinement before implementation",
        payload,
        auditExtras
      );
    }

    return decorateResult(result, auditExtras);
  }

  verify(item, payload) {
    const { ticket, decision } = item;
    const branchName = payload.branchName ?? "";
    const commitMessage = payload.commitMessage ?? "";
    const pullRequestTitle = payload.pullRequestTitle ?? "";

    if (decision.status_decision === "blocked" || decision.status_decision === "not_feasible") {
      return this.buildResult(item, "blocked", `triage marked the ticket as ${decision.status_decision}`, payload);
    }

    if (decision.status_decision === "feasible_low_confidence") {
      return this.buildResult(item, "needs_review", "triage confidence is too low for execution", payload);
    }

    if (!decision.product_target || decision.product_target === "unknown") {
      return this.buildResult(item, "blocked", "verification requires a concrete product target", payload);
    }

    if (!decision.repo_target || decision.repo_target === "UNKNOWN") {
      return this.buildResult(item, "blocked", "verification requires a concrete repository target", payload);
    }

    if (
      hasConcreteTarget(ticket.productTarget) &&
      ticket.productTarget !== decision.product_target
    ) {
      return this.buildResult(
        item,
        "needs_review",
        `ticket product target (${ticket.productTarget}) conflicts with triage target (${decision.product_target})`,
        payload
      );
    }

    if (hasConcreteTarget(ticket.repoTarget) && ticket.repoTarget !== decision.repo_target) {
      return this.buildResult(
        item,
        "needs_review",
        `ticket repository target (${ticket.repoTarget}) conflicts with triage target (${decision.repo_target})`,
        payload
      );
    }

    if ((decision.confidence ?? 0) < this.config.minConfidence) {
      return this.buildResult(
        item,
        "needs_review",
        `verification requires confidence >= ${this.config.minConfidence}`,
        payload
      );
    }

    if (!branchName || !branchNamePattern.test(branchName)) {
      return this.buildResult(item, "blocked", "planned branch name is not policy-compliant", payload);
    }

    if (!commitMessage || commitMessage.includes("\n")) {
      return this.buildResult(item, "blocked", "commit message must stay on a single line", payload);
    }

    if (commitMessage.length > this.config.maxCommitMessageLength) {
      return this.buildResult(
        item,
        "blocked",
        `commit message exceeds ${this.config.maxCommitMessageLength} characters`,
        payload
      );
    }

    if (!pullRequestTitle || pullRequestTitle.includes("\n")) {
      return this.buildResult(item, "blocked", "pull request title must stay on a single line", payload);
    }

    if (pullRequestTitle.length > this.config.maxPullRequestTitleLength) {
      return this.buildResult(
        item,
        "blocked",
        `pull request title exceeds ${this.config.maxPullRequestTitleLength} characters`,
        payload
      );
    }

    return this.buildResult(item, "approved", "verification approved execution payload", payload);
  }

  resolveAllowedPathPrefixes(repoTarget) {
    const entries = this.config.allowedPathPrefixesByRepo ?? {};
    const explicit = entries[repoTarget] ?? entries.default ?? [];
    return explicit.map((value) => normalizePath(value)).filter(Boolean);
  }

  async collectChangedPaths(workspaceRoot) {
    try {
      const { stdout } = await execFileAsync(
        "git",
        ["status", "--porcelain", "--untracked-files=all"],
        {
          cwd: workspaceRoot,
          windowsHide: true
        }
      );

      return parseGitStatusPaths(stdout);
    } catch (error) {
      throw new Error(
        `verification path policy requires a readable git workspace at ${workspaceRoot}: ${error.message}`,
        { cause: error }
      );
    }
  }

  async enforcePathPolicy({ item, workspaceRoot, payload, executionMode = "" }) {
    const repoTarget = item.decision.repo_target;
    const allowedPrefixes = this.resolveAllowedPathPrefixes(repoTarget);
    if (allowedPrefixes.length === 0 && executionMode === "real") {
      return this.buildResult(
        item,
        "blocked",
        `path policy denies all changes: no allowedPathPrefixesByRepo entry for ${repoTarget}`,
        payload
      );
    }

    let changedPaths;
    try {
      changedPaths = await this.collectChangedPaths(workspaceRoot);
    } catch (error) {
      // Dry-run workspaces without git have nothing to commit, so an empty allowlist has nothing to deny.
      if (allowedPrefixes.length === 0) {
        return null;
      }
      throw error;
    }

    const disallowedPaths = changedPaths.filter(
      (entry) => !allowedPrefixes.some((prefix) => entry === prefix || entry.startsWith(`${prefix}/`))
    );

    if (disallowedPaths.length === 0) {
      return null;
    }

    return this.buildResult(
      item,
      "blocked",
      allowedPrefixes.length === 0
        ? `changed paths outside allowlist (no allowedPathPrefixesByRepo entry for ${repoTarget}): ${disallowedPaths.join(", ")}`
        : `changed paths outside allowlist: ${disallowedPaths.join(", ")}`,
      payload
    );
  }

  async collectDiffSummary(workspaceRoot) {
    const run = async (args) =>
      (
        await execFileAsync("git", args, {
          cwd: workspaceRoot,
          windowsHide: true,
          maxBuffer: defaultPreflightMaxBufferBytes
        })
      ).stdout;
    const hasHead = await run(["rev-parse", "--verify", "HEAD"]).then(() => true, () => false);
    const tracked = hasHead ? parseNumstat(await run(["diff", "--numstat", "HEAD"])) : [];
    const statText = hasHead ? (await run(["diff", "--stat", "HEAD"])).trimEnd() : "";
    const untrackedPaths = (await run(["ls-files", "--others", "--exclude-standard"]))
      .split(/\r?\n/)
      .map((entry) => normalizePath(entry))
      .filter(Boolean);
    const untracked = [];
    for (const entry of untrackedPaths) {
      const content = await readFile(path.join(workspaceRoot, entry), "utf8").catch(() => "");
      untracked.push({ path: entry, added: countLines(content), deleted: 0, binary: false });
    }

    const files = [...tracked, ...untracked];
    const changedLines = files.reduce((total, file) => total + file.added + file.deleted, 0);
    const stat = [
      statText,
      ...untracked.map((file) => ` ${file.path} | ${file.added} + (new file)`),
      `${files.length} file(s) changed, ${changedLines} line(s) changed`
    ]
      .filter(Boolean)
      .join("\n");

    return { files, changedLines, stat };
  }

  async enforceDiffGate({ item, workspaceRoot, payload, executionMode = "" }) {
    if (this.config.diffGate.enabled === false) {
      return { result: null, diffStat: "" };
    }

    let summary;
    try {
      summary = await this.collectDiffSummary(workspaceRoot);
    } catch (error) {
      if (executionMode === "real") {
        throw new Error(`diff gate requires a readable git workspace at ${workspaceRoot}: ${error.message}`, {
          cause: error
        });
      }
      return { result: null, diffStat: "" };
    }

    const { maxFiles, maxChangedLines } = this.config.diffGate;
    if (summary.files.length > maxFiles) {
      return {
        diffStat: summary.stat,
        result: this.buildResult(
          item,
          "blocked",
          `diff gate: ${summary.files.length} changed files exceed the limit of ${maxFiles}`,
          payload
        )
      };
    }

    if (summary.changedLines > maxChangedLines) {
      return {
        diffStat: summary.stat,
        result: this.buildResult(
          item,
          "blocked",
          `diff gate: ${summary.changedLines} changed lines exceed the limit of ${maxChangedLines}`,
          payload
        )
      };
    }

    return { result: null, diffStat: summary.stat };
  }

  async runPreflightCommands({ item, workspaceRoot, payload, executionMode = "" }) {
    const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
    const activeCommands = this.config.preflightCommands.filter((command) => command?.enabled !== false);
    const hasAllowlist =
      Array.isArray(this.config.allowedCommandPrefixes) && this.config.allowedCommandPrefixes.length > 0;

    if (executionMode === "real" && !hasAllowlist) {
      return this.buildResult(
        item,
        "blocked",
        "real execution requires a non-empty verification.allowedCommandPrefixes allowlist",
        payload
      );
    }

    if (activeCommands.length > 0 && !hasAllowlist) {
      return this.buildResult(
        item,
        "blocked",
        "preflight commands require a non-empty verification.allowedCommandPrefixes allowlist",
        payload
      );
    }

    for (const command of this.config.preflightCommands) {
      if (command?.enabled === false) {
        continue;
      }

      const label = command.label ?? command.command ?? "unnamed preflight command";
      const args = Array.isArray(command.args) ? command.args : [];
      const allowedExitCodes = Array.isArray(command.allowedExitCodes)
        ? command.allowedExitCodes
        : [0];

      if (!isAllowedCommand(command.command, args, this.config.allowedCommandPrefixes)) {
        return this.buildResult(
          item,
          "blocked",
          `preflight command is not allowed by policy (${label})`,
          payload
        );
      }

      try {
        const resolvedCommandCwd = command.cwd
          ? path.resolve(resolvedWorkspaceRoot, command.cwd)
          : resolvedWorkspaceRoot;

        if (!isPathInside(resolvedWorkspaceRoot, resolvedCommandCwd)) {
          return this.buildResult(
            item,
            "blocked",
            `preflight command cwd escapes workspace root (${label})`,
            payload
          );
        }

        await execFileAsync(command.command, args, {
          cwd: resolvedCommandCwd,
          windowsHide: true,
          timeout: positiveNumber(command.timeoutMs, this.config.preflightTimeoutMs),
          maxBuffer: this.config.preflightMaxBufferBytes,
          killSignal: "SIGKILL"
        });
      } catch (error) {
        const exitCode = typeof error.code === "number" ? error.code : null;
        if (exitCode !== null && allowedExitCodes.includes(exitCode)) {
          continue;
        }

        if (error.killed || error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
          return this.buildResult(
            item,
            "blocked",
            error.killed && error.code !== "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
              ? `preflight command timed out (${label})`
              : `preflight command exceeded the output limit (${label})`,
            payload
          );
        }

        const output = [error.stdout, error.stderr]
          .filter(Boolean)
          .join(" ")
          .trim()
          .slice(0, 240);

        return this.buildResult(
          item,
          "blocked",
          output
            ? `preflight command failed (${label}): ${output}`
            : `preflight command failed (${label})`,
          payload
        );
      }
    }

    return null;
  }

  async runPreflight({ item, workspaceRoot, payload, executionMode = "" }) {
    const scanWorkspaceRoot = this.config.sensitiveScan?.workspaceRoot || workspaceRoot;
    const scanResult = await scanWorkspace(scanWorkspaceRoot, this.config.sensitiveScan);
    if (scanResult.issues.length > 0) {
      const topIssues = scanResult.issues
        .slice(0, 3)
        .map((issue) => `${issue.filePath}: ${issue.reason}`)
        .join(", ");

      return this.buildResult(
        item,
        "blocked",
        `public hygiene scan failed: ${topIssues}`,
        payload
      );
    }

    const pathResult = await this.enforcePathPolicy({ item, workspaceRoot, payload, executionMode });
    if (pathResult) {
      return pathResult;
    }

    const diffGate = await this.enforceDiffGate({ item, workspaceRoot, payload, executionMode });
    if (diffGate.result) {
      return { ...diffGate.result, diffStat: diffGate.diffStat };
    }

    const commandResult = await this.runPreflightCommands({ item, workspaceRoot, payload, executionMode });
    if (commandResult) {
      return { ...commandResult, diffStat: diffGate.diffStat };
    }

    return {
      ...this.buildResult(item, "approved", "preflight checks passed", payload),
      diffStat: diffGate.diffStat
    };
  }
}
