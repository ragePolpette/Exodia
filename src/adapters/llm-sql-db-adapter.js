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

  async runDiagnosticQuery(request) {
    if (!request.query && !request.statement) {
      return {
        used: false,
        source: "mock",
        database: request.database ?? "prod",
        rows: [],
        summary: ""
      };
    }

    return {
      used: true,
      source: "mock",
      database: request.database ?? "prod",
      rows: request.mockRows ?? [],
      summary: request.mockSummary ?? "mock sql diagnostic executed"
    };
  }
}
