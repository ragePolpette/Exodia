import { assertVerificationStatus } from "../contracts/harness-contracts.js";

const branchNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

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
      maxPullRequestTitleLength: config.maxPullRequestTitleLength ?? 120
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
}
