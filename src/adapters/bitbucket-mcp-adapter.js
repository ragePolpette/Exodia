import { buildBranchName } from "./bitbucket-adapter.js";

export class McpBitbucketAdapter {
  constructor({
    baseBranch = "BPOFH",
    allowMerge = false,
    client,
    server = "llm_bitbucket_mcp",
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

  resolveOperation(name, fallbackAction, { required = true } = {}) {
    const operation = this.options.operations?.[name];
    if (operation?.enabled === false) {
      if (required) {
        throw new Error(`Bitbucket MCP operation "${name}" is disabled in config`);
      }

      return null;
    }

    const action = operation?.action ?? fallbackAction;
    if (!action && required) {
      throw new Error(`Missing Bitbucket MCP action mapping for "${name}"`);
    }

    return action || null;
  }

  planBranch(ticket) {
    return buildBranchName(ticket);
  }

  async createBranch(ticket, branchName) {
    return this.client.request({
      server: this.server,
      action: this.resolveOperation("createBranch", "createBranch"),
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
      action: this.resolveOperation("checkoutBranch", "checkoutBranch"),
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
      action: this.resolveOperation("createCommit", "createCommit"),
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
      action: this.resolveOperation("openPullRequest", "openPullRequest"),
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

  async findOpenPullRequest(ticket, branchName) {
    const action = this.resolveOperation("findOpenPullRequest", "findOpenPullRequest", {
      required: false
    });

    if (!action) {
      return null;
    }

    const response = await this.client.request({
      server: this.server,
      action,
      payload: {
        repository: this.repository,
        project: this.project,
        sourceBranch: branchName,
        targetBranch: this.baseBranch,
        ticket
      }
    });

    if (!response) {
      return null;
    }

    return response.pullRequest ?? response;
  }

  async assertNoMergePolicy() {
    if (this.allowMerge) {
      throw new Error("Merge must remain disabled for the harness");
    }
  }
}
