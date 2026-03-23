export class McpJiraAdapter {
  constructor(options = {}) {
    this.options = options;
    this.kind = "mcp";
  }

  async listOpenTickets() {
    throw new Error("Jira MCP adapter is registered but not connected in STEP 1");
  }
}
