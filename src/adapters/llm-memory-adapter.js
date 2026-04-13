export class LlmMemoryAdapter {
  constructor(options = {}) {
    this.options = options;
    this.kind = "mock";
  }

  async captureTriageInsight(_insight) {
    return {
      stored: false,
      source: "mock",
      reason: "semantic memory disabled in mock mode"
    };
  }

  async captureExecutionInsight(_insight) {
    return {
      stored: false,
      source: "mock",
      reason: "semantic memory disabled in mock mode"
    };
  }

  async captureInteractionInsight(_insight) {
    return {
      stored: false,
      source: "mock",
      reason: "semantic memory disabled in mock mode"
    };
  }
}
