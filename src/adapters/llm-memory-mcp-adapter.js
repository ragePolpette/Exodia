export class McpLlmMemoryAdapter {
  constructor(options = {}) {
    this.options = options;
    this.client = options.client;
    this.kind = "mcp";
  }

  async captureTriageInsight(insight) {
    return this.client.request({
      server: this.options.server,
      action: "captureInferenceMemory",
      payload: {
        namespace: this.options.namespace,
        phase: "triage",
        insight
      }
    });
  }

  async captureExecutionInsight(insight) {
    return this.client.request({
      server: this.options.server,
      action: "captureInferenceMemory",
      payload: {
        namespace: this.options.namespace,
        phase: "execution",
        insight
      }
    });
  }

  async captureInteractionInsight(insight) {
    return this.client.request({
      server: this.options.server,
      action: "captureInferenceMemory",
      payload: {
        namespace: this.options.namespace,
        phase: "interaction",
        insight
      }
    });
  }
}
