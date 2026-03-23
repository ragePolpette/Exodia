export class McpLlmSqlDbAdapter {
  constructor(options = {}) {
    this.options = options;
    this.kind = "mcp";
  }

  async recordRun() {
    throw new Error("llm-sql-db MCP adapter is registered but not connected in STEP 1");
  }
}
