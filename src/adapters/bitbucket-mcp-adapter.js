import { buildBranchName } from "./bitbucket-adapter.js";

export class McpBitbucketAdapter {
  constructor({
    baseBranch = "BPOFH",
    allowMerge = false,
    client,
    server = "llm-bitbucket-mcp",
    repository = "",
    project = "",
    workspaceRoot = "",
    ...options
  } = {}) {
    this.baseBranch = baseBranch;
    this.allowMerge = allowMerge;
    this.client = client;
    this.server = server;
    this.repository = repository;
    this.project = project;
    this.workspaceRoot = workspaceRoot;
    this.options = options;
    this.kind = "mcp";
  }

  planBranch(ticket) {
    return buildBranchName(ticket);
  }

  async createBranch(ticket, branchName) {
    return this.client.request({
      server: this.server,
      action: "createBranch",
      payload: {
        repository: this.repository,
        project: this.project,
        baseBranch: this.baseBranch,
        branchName,
        ticket
      }
    });
  }

  async checkoutBranch(ticket, branchName) {
    return this.client.request({
      server: this.server,
      action: "checkoutBranch",
      payload: {
        repository: this.repository,
        workspaceRoot: this.workspaceRoot,
        branchName,
        ticket
      }
    });
  }

  async createCommit(ticket, branchName, commitMessage) {
    return this.client.request({
      server: this.server,
      action: "createCommit",
      payload: {
        repository: this.repository,
        workspaceRoot: this.workspaceRoot,
        branchName,
        commitMessage,
        ticket
      }
    });
  }

  async openPullRequest(ticket, branchName, commitResult) {
    return this.client.request({
      server: this.server,
      action: "openPullRequest",
      payload: {
        repository: this.repository,
        project: this.project,
        sourceBranch: branchName,
        targetBranch: this.baseBranch,
        title: `[${ticket.key}] ${ticket.summary}`,
        commitSha: commitResult.commitSha,
        ticket
      }
    });
  }

  async assertNoMergePolicy() {
    if (this.allowMerge) {
      throw new Error("Merge must remain disabled for the harness");
    }
  }
}
