export class McpBitbucketAdapter {
  constructor({ baseBranch = "BPOFH", allowMerge = false, ...options } = {}) {
    this.baseBranch = baseBranch;
    this.allowMerge = allowMerge;
    this.options = options;
    this.kind = "mcp";
  }

  planBranch(ticket) {
    return `${ticket.key.toLowerCase()}-mcp-bridge`;
  }

  async createBranch() {
    throw new Error("Bitbucket MCP adapter is registered but not connected in STEP 1");
  }

  async checkoutBranch() {
    throw new Error("Bitbucket MCP adapter is registered but not connected in STEP 1");
  }

  async createCommit() {
    throw new Error("Bitbucket MCP adapter is registered but not connected in STEP 1");
  }

  async openPullRequest() {
    throw new Error("Bitbucket MCP adapter is registered but not connected in STEP 1");
  }

  async assertNoMergePolicy() {
    if (this.allowMerge) {
      throw new Error("Merge must remain disabled for the harness");
    }
  }
}
