import { LlmSqlDbAdapter } from "./llm-sql-db-adapter.js";

export class ResilientLlmSqlDbAdapter {
  constructor({ primaryAdapter, fallbackAdapter, logger } = {}) {
    this.primaryAdapter = primaryAdapter;
    this.fallbackAdapter = fallbackAdapter ?? new LlmSqlDbAdapter();
    this.logger = logger;
    this.kind = primaryAdapter?.kind ?? "mcp";
  }

  async recordRun(summary) {
    try {
      return await this.primaryAdapter.recordRun(summary);
    } catch (error) {
      this.logger?.warn("llm-sql-db unavailable, skipping run persistence", {
        mode: summary?.mode ?? "",
        error: error.message
      });

      return this.fallbackAdapter.recordRun(summary);
    }
  }

  async runDiagnosticQuery(request) {
    try {
      return await this.primaryAdapter.runDiagnosticQuery(request);
    } catch (error) {
      this.logger?.warn("llm-sql-db unavailable, skipping diagnostics", {
        phase: request?.phase ?? "",
        ticketKey: request?.ticketKey ?? "",
        error: error.message
      });

      return this.fallbackAdapter.runDiagnosticQuery(request);
    }
  }
}