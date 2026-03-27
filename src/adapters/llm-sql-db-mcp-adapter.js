export class McpLlmSqlDbAdapter {
  constructor(options = {}) {
    this.options = options;
    this.client = options.client;
    this.kind = "mcp";
  }

  async recordRun(summary) {
    if (!this.options.enabled) {
      return {
        runId: `disabled-${Date.now()}`,
        mode: summary.mode,
        stored: false
      };
    }

    const operation = this.options.operations?.recordRun ?? {};
    if (operation.enabled === false || !operation.sql) {
      return {
        runId: `disabled-${Date.now()}`,
        mode: summary.mode,
        stored: false,
        note: "record run persistence is disabled by local config"
      };
    }

    const runId = `malkuth-run-${Date.now()}`;

    return this.client.request({
      server: this.resolveRecordRunServer(),
      action: operation.action ?? "recordHarnessRun",
      payload: {
        namespace: this.options.namespace ?? "malkuth",
        database: operation.database ?? "dev",
        sql: operation.sql,
        runId,
        mode: summary.mode,
        dryRun: summary.dryRun,
        ticketCount: summary.ticketCount,
        parameters: {
          runId,
          mode: summary.mode,
          dryRun: summary.dryRun,
          ticketCount: summary.ticketCount,
          namespace: this.options.namespace ?? "malkuth",
          recordedAt: new Date().toISOString()
        }
      }
    });
  }

  async runDiagnosticQuery(request) {
    const database = request.database ?? this.options.defaultDatabase ?? "prod";
    const target = this.resolveDatabaseTarget(database);

    if (!this.options.enabled) {
      return {
        used: false,
        source: "mcp",
        database: target.database,
        rows: [],
        summary: ""
      };
    }

    return this.client.request({
      server: target.server,
      action: target.action ?? "runDiagnosticQuery",
      payload: {
        namespace: this.options.namespace ?? "malkuth",
        database: target.database,
        phase: request.phase,
        ticketKey: request.ticketKey,
        query: request.query ?? request.statement,
        parameters: request.parameters ?? {},
        maxRows: request.maxRows ?? target.maxRows
      }
    });
  }

  resolveRecordRunServer() {
    return (
      this.options.operations?.recordRun?.server ??
      this.options.server ??
      this.options.targets?.prod?.server ??
      this.options.targets?.dev?.server
    );
  }

  resolveDatabaseTarget(database) {
    const configuredTarget = this.options.targets?.[database];
    if (configuredTarget?.server) {
      return {
        server: configuredTarget.server,
        database: configuredTarget.database ?? database,
        action: configuredTarget.action,
        maxRows: configuredTarget.maxRows
      };
    }

    return {
      server:
        database === "dev"
          ? this.options.devServer ?? this.options.server
          : this.options.prodServer ?? this.options.server,
      database
    };
  }
}
