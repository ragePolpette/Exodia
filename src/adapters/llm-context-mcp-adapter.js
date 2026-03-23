export class McpLlmContextAdapter {
  constructor(options = {}) {
    this.options = options;
    this.kind = "mcp";
  }

  async mapTicketToCodebase() {
    throw new Error("llm-context MCP adapter is registered but not connected in STEP 1");
  }
}
