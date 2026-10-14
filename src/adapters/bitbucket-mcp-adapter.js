import { buildBranchName } from "./bitbucket-adapter.js";

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = `${value ?? ""}`.trim();
    if (text) {
      return text;
    }
  }

  return "";
}

function normalizePullRequestResponse(response, { fallbackTitle = "", description = "" } = {}) {
  if (!response) {
    return null;
  }

  const pullRequest = response.pullRequest ?? response.pull_request ?? response.data ?? response;

  return {
    ...response,
    ...pullRequest,
    title: firstNonEmpty(pullRequest.title, response.title, fallbackTitle),
    link: firstNonEmpty(
      pullRequest.link,
      pullRequest.url,
      pullRequest.href,
      pullRequest.links?.html?.href,
      response.link,
      response.url,
      response.href,
      response.links?.html?.href
    ),
    sourceBranch: firstNonEmpty(
      pullRequest.sourceBranch,
      pullRequest.source_branch,
      pullRequest.source?.branch?.name,
      response.sourceBranch
    ),
    description: firstNonEmpty(pullRequest.description, response.description, description)
  };
}

export class McpBitbucketAdapter {
  constructor({
    baseBranch = "",
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
        workspaceRoot: this.workspaceRoot,
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

  async createCommit(ticket, branchName, commitMessage, { allowedPaths = [] } = {}) {
    return this.client.request({
      server: this.server,
      action: this.resolveOperation("createCommit", "createCommit"),
      payload: {
        repository: this.repository,
        workspaceRoot: this.workspaceRoot,
        branchName,
        commitMessage,
        allowedPaths,
        ticket
      }
    });
  }

  async resetWorkspace(ticket, branchName) {
    return this.client.request({
      server: this.server,
      action: this.resolveOperation("resetWorkspace", "resetWorkspace"),
      payload: {
        repository: this.repository,
        workspaceRoot: this.workspaceRoot,
        branchName,
        ticket
      }
    });
  }

  async pushBranch(ticket, branchName) {
    return this.client.request({
      server: this.server,
      action: this.resolveOperation("pushBranch", "pushBranch"),
      payload: {
        repository: this.repository,
        workspaceRoot: this.workspaceRoot,
        branchName,
        ticket
      }
    });
  }

  async openPullRequest(ticket, branchName, commitResult, options = {}) {
    const description =
      options.description ??
      `Automated harness pull request for ${ticket.key}`;
    const response = await this.client.request({
      server: this.server,
      action: this.resolveOperation("openPullRequest", "openPullRequest"),
      payload: {
        repository: this.repository,
        project: this.project,
        sourceBranch: branchName,
        targetBranch: this.baseBranch,
        title: `[${ticket.key}] ${ticket.summary}`,
        description,
        commitSha: commitResult.commitSha,
        ticket
      }
    });
    return normalizePullRequestResponse(response, {
      fallbackTitle: `[${ticket.key}] ${ticket.summary}`,
      description
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

    return normalizePullRequestResponse(response, {
      fallbackTitle: `[${ticket.key}] ${ticket.summary}`
    });
  }

  async assertNoMergePolicy() {
    if (this.allowMerge) {
      throw new Error("Merge must remain disabled for the harness");
    }
  }
}
