export class ExecutionService {
  buildCommitMessage(ticket) {
    return `feat(${ticket.key}): ${ticket.summary}`;
  }

  resolveTrustLevel({ executionConfig, bitbucketKind }) {
    const trustLevel =
      executionConfig.trustLevel ||
      (bitbucketKind === "mock"
        ? "mock"
        : executionConfig.dryRun
          ? "mcp-readonly"
          : "mcp-write");

    if (!["mock", "mcp-readonly", "mcp-write"].includes(trustLevel)) {
      throw new Error(`Unsupported execution trust level: ${trustLevel}`);
    }

    if (bitbucketKind === "mock" && trustLevel !== "mock") {
      throw new Error('Mock execution requires execution.trustLevel = "mock"');
    }

    if (bitbucketKind === "mcp" && executionConfig.dryRun && trustLevel === "mock") {
      throw new Error('MCP dry-run requires execution.trustLevel = "mcp-readonly" or "mcp-write"');
    }

    if (!executionConfig.dryRun && trustLevel !== "mcp-write") {
      throw new Error('Real execution requires execution.trustLevel = "mcp-write"');
    }

    return trustLevel;
  }

  assertRepositoryPolicy({ executionConfig, bitbucketAdapter }) {
    const allowedRepositories = executionConfig.allowedRepositories ?? [];
    if (!Array.isArray(allowedRepositories) || allowedRepositories.length === 0) {
      return;
    }

    const repository = bitbucketAdapter.repository ?? "";
    if (!repository || !allowedRepositories.includes(repository)) {
      throw new Error("Bitbucket repository is not allowed by execution policy");
    }
  }

  assertBaseBranchPolicy({ executionConfig, bitbucketAdapter }) {
    const allowedBaseBranches = executionConfig.allowedBaseBranches ?? [];
    if (!Array.isArray(allowedBaseBranches) || allowedBaseBranches.length === 0) {
      return;
    }

    const baseBranch = bitbucketAdapter.baseBranch ?? executionConfig.baseBranch ?? "";
    if (!baseBranch || !allowedBaseBranches.includes(baseBranch)) {
      throw new Error("Base branch is not allowed by execution policy");
    }
  }

  resolveMode({ executionConfig, bitbucketKind, bitbucketAdapter }) {
    if (!executionConfig.enabled) {
      return {
        mode: "disabled",
        trustLevel:
          executionConfig.trustLevel ||
          (bitbucketKind === "mcp" ? "mcp-readonly" : "mock")
      };
    }

    if (!executionConfig.dryRun && bitbucketKind !== "mcp") {
      throw new Error('Real execution requires adapters.bitbucket.kind = "mcp"');
    }

    const trustLevel = this.resolveTrustLevel({ executionConfig, bitbucketKind });
    this.assertRepositoryPolicy({ executionConfig, bitbucketAdapter });
    this.assertBaseBranchPolicy({ executionConfig, bitbucketAdapter });

    if (executionConfig.dryRun) {
      return {
        mode: bitbucketKind === "mcp" ? "dry-run-mcp" : "dry-run-mock",
        trustLevel
      };
    }

    if (!executionConfig.allowRealPrs) {
      throw new Error("Real execution requires execution.allowRealPrs = true");
    }

    return {
      mode: "real",
      trustLevel
    };
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
