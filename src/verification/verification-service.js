import { assertVerificationStatus } from "../contracts/harness-contracts.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { scanWorkspace } from "../security/public-hygiene.js";

const execFileAsync = promisify(execFile);

const branchNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function normalizePath(value) {
  return `${value ?? ""}`
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+/g, "/");
}

function isAllowedCommand(command, args, allowedPrefixes) {
  if (!Array.isArray(allowedPrefixes) || allowedPrefixes.length === 0) {
    return true;
  }

  const sequence = [command, ...args];
  return allowedPrefixes.some((prefix) =>
    Array.isArray(prefix) && prefix.every((segment, index) => sequence[index] === segment)
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
      sensitiveScan: config.sensitiveScan ?? { enabled: false }
    };
  }

  buildResult(item, status, reason, payload = {}) {
    const normalizedStatus = normalizeStatus(status);
    return {
      ticketKey: item.ticket.key,
      projectKey: item.ticket.projectKey,
      productTarget: item.decision.product_target,
      repoTarget: item.decision.repo_target,
      status: normalizedStatus,
      reason,
      branchName: payload.branchName ?? "",
      commitMessage: payload.commitMessage ?? "",
      pullRequestTitle: payload.pullRequestTitle ?? ""
    };
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
      ticket.productTarget &&
      ticket.productTarget !== "unknown" &&
      ticket.productTarget !== decision.product_target
    ) {
      return this.buildResult(
        item,
        "needs_review",
        `ticket product target (${ticket.productTarget}) conflicts with triage target (${decision.product_target})`,
        payload
      );
    }

    if (ticket.repoTarget && ticket.repoTarget !== decision.repo_target) {
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
        `verification path policy requires a readable git workspace at ${workspaceRoot}: ${error.message}`
      );
    }
  }

  async enforcePathPolicy({ item, workspaceRoot, payload }) {
    const allowedPrefixes = this.resolveAllowedPathPrefixes(item.decision.repo_target);
    if (allowedPrefixes.length === 0) {
      return null;
    }

    const changedPaths = await this.collectChangedPaths(workspaceRoot);
    const disallowedPaths = changedPaths.filter(
      (entry) => !allowedPrefixes.some((prefix) => entry === prefix || entry.startsWith(`${prefix}/`))
    );

    if (disallowedPaths.length === 0) {
      return null;
    }

    return this.buildResult(
      item,
      "blocked",
      `changed paths outside allowlist: ${disallowedPaths.join(", ")}`,
      payload
    );
  }

  async runPreflightCommands({ item, workspaceRoot, payload }) {
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
        await execFileAsync(command.command, args, {
          cwd: command.cwd ? workspaceRoot : workspaceRoot,
          windowsHide: true
        });
      } catch (error) {
        const exitCode = typeof error.code === "number" ? error.code : null;
        if (exitCode !== null && allowedExitCodes.includes(exitCode)) {
          continue;
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

  async runPreflight({ item, workspaceRoot, payload }) {
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

    const pathResult = await this.enforcePathPolicy({ item, workspaceRoot, payload });
    if (pathResult) {
      return pathResult;
    }

    const commandResult = await this.runPreflightCommands({ item, workspaceRoot, payload });
    if (commandResult) {
      return commandResult;
    }

    return this.buildResult(item, "approved", "preflight checks passed", payload);
  }
}
