export class ExecutionService {
  buildCommitMessage(ticket) {
    return `feat(${ticket.key}): ${ticket.summary}`;
  }

  resolveMode({ executionConfig, bitbucketKind }) {
    if (!executionConfig.enabled) {
      return "disabled";
    }

    if (executionConfig.dryRun) {
      return bitbucketKind === "mcp" ? "dry-run-mcp" : "dry-run-mock";
    }

    if (bitbucketKind !== "mcp") {
      throw new Error('Real execution requires adapters.bitbucket.kind = "mcp"');
    }

    if (!executionConfig.allowRealPrs) {
      throw new Error("Real execution requires execution.allowRealPrs = true");
    }

    return "real";
  }

  buildPlannedResult(ticket, status, reason) {
    return {
      ticketKey: ticket.key,
      projectKey: ticket.projectKey,
      productTarget: ticket.productTarget ?? ticket.product_target ?? "unknown",
      repoTarget: ticket.repoTarget ?? ticket.repo_target ?? "UNKNOWN",
      branchName: "",
      pullRequestTitle: "",
      pullRequestUrl: "",
      commitMessage: "",
      status,
      reason
    };
  }

  buildExecutionResult(ticket, branchName, commitMessage, pullRequest) {
    return {
      ticketKey: ticket.key,
      projectKey: ticket.projectKey,
      productTarget: ticket.productTarget ?? ticket.product_target ?? "unknown",
      repoTarget: ticket.repoTarget ?? ticket.repo_target ?? "UNKNOWN",
      branchName,
      pullRequestTitle: pullRequest.title,
      pullRequestUrl: pullRequest.link,
      commitMessage,
      status: "pr_opened",
      reason: "execution completed and pull request opened"
    };
  }

  buildExistingPullRequestResult(ticket, branchName, pullRequest) {
    return {
      ticketKey: ticket.key,
      projectKey: ticket.projectKey,
      productTarget: ticket.productTarget ?? ticket.product_target ?? "unknown",
      repoTarget: ticket.repoTarget ?? ticket.repo_target ?? "UNKNOWN",
      branchName: branchName || pullRequest.sourceBranch || "",
      pullRequestTitle: pullRequest.title ?? `[${ticket.key}] ${ticket.summary}`,
      pullRequestUrl: pullRequest.link ?? pullRequest.url ?? "",
      commitMessage: "",
      status: "pr_opened",
      reason: "execution reused an already open pull request"
    };
  }
}
