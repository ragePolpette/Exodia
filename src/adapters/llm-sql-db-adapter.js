export class LlmSqlDbAdapter {
  constructor(options = {}) {
    this.options = options;
    this.kind = "mock";
  }

  async recordRun(summary) {
    return {
      runId: `run-${Date.now()}`,
      mode: summary.mode,
      stored: false
    };
  }
}
