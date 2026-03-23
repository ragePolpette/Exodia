export class McpLlmMemoryAdapter {
  constructor(options = {}) {
    this.options = options;
    this.kind = "mcp";
  }

  async listRecords() {
    throw new Error("llm-memory MCP adapter is registered but not connected in STEP 1");
  }

  async upsertRecords() {
    throw new Error("llm-memory MCP adapter is registered but not connected in STEP 1");
  }
}
