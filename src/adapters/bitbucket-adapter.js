export function toKebabCase(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function buildBranchName(ticket) {
  return `${ticket.key.toLowerCase()}-${toKebabCase(ticket.summary)}`;
}

export class BitbucketAdapter {
  constructor({ baseBranch = "", allowMerge = false, repository = "", existingPullRequests = [] } = {}) {
    this.baseBranch = baseBranch;
    this.allowMerge = allowMerge;
    this.repository = repository;
    this.existingPullRequests = existingPullRequests;
    this.operations = [];
    this.kind = "mock";
  }

  planBranch(ticket) {
    return buildBranchName(ticket);
  }

  async createBranch(ticket, branchName) {
    const operation = {
      kind: "create_branch",
      ticketKey: ticket.key,
      baseBranch: this.baseBranch,
      branchName
    };
    this.operations.push(operation);
    return operation;
  }

  async checkoutBranch(ticket, branchName) {
    const operation = {
      kind: "checkout_branch",
      ticketKey: ticket.key,
      branchName
    };
    this.operations.push(operation);
    return operation;
  }

  async createCommit(ticket, branchName, commitMessage) {
    const operation = {
      kind: "commit",
      ticketKey: ticket.key,
      branchName,
      commitMessage,
      commitSha: `mock-${ticket.key.toLowerCase()}-${Date.now()}`
    };
    this.operations.push(operation);
    return operation;
  }

  async findOpenPullRequest(ticket, branchName) {
    const pullRequest = this.existingPullRequests.find(
      (item) =>
        item.sourceBranch === branchName &&
        (!item.targetBranch || item.targetBranch === this.baseBranch)
    );

    const operation = {
      kind: "find_open_pr",
      ticketKey: ticket.key,
      sourceBranch: branchName,
      targetBranch: this.baseBranch,
      found: Boolean(pullRequest)
    };
    this.operations.push(operation);

    return pullRequest ?? null;
  }

  async openPullRequest(ticket, branchName, commitResult) {
    return {
      kind: "open_pr",
      title: `[${ticket.key}] ${ticket.summary}`,
      sourceBranch: branchName,
      targetBranch: this.baseBranch,
      commitSha: commitResult.commitSha,
      link: `mock://pull-request/${ticket.key.toLowerCase()}`
    };
  }

  async assertNoMergePolicy() {
    if (this.allowMerge) {
      throw new Error("Merge must remain disabled for the harness");
    }

    const operation = {
      kind: "guardrail_no_merge",
      allowed: false
    };
    this.operations.push(operation);
    return operation;
  }
}
