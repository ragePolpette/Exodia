export class ExecutionService {
  buildCommitMessage(ticket) {
    return `feat(${ticket.key}): ${ticket.summary}`;
  }

  buildPlannedResult(ticket, status, reason) {
    return {
      ticketKey: ticket.key,
      projectKey: ticket.projectKey,
      repoTarget: ticket.repoTarget ?? "BPOFH",
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
      repoTarget: ticket.repoTarget ?? "BPOFH",
      branchName,
      pullRequestTitle: pullRequest.title,
      pullRequestUrl: pullRequest.link,
      commitMessage,
      status: "pr_opened",
      reason: "mock execution completed and pull request opened"
    };
  }
}
