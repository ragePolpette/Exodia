import { buildAdapters } from "../adapters/bootstrap-adapters.js";
import { ExecutionAgent } from "../agents/execution-agent.js";
import { TriageAgent } from "../agents/triage-agent.js";
import { loadConfig } from "../config/load-config.js";
import { assertMode } from "../contracts/harness-contracts.js";
import { renderExecutionReport } from "../execution/render-execution-report.js";
import { createLogger } from "../logging/logger.js";
import { renderTriageReport } from "../triage/render-triage-report.js";

export async function runHarness({
  configPath = "./config/harness.config.example.json",
  modeOverride,
  dryRunOverride
} = {}) {
  const config = await loadConfig(configPath);
  const mode = modeOverride ?? config.mode;
  const executionDryRun = dryRunOverride ?? config.execution.dryRun ?? config.dryRun;
  const dryRun = executionDryRun;
  const logger = createLogger({ level: config.logging?.level ?? "info" });

  assertMode(mode);
  logger.info("Harness run started", { mode, dryRun, configPath: config.configPath });
  const { adapters, kinds } = buildAdapters({ config, logger });
  const {
    jira: jiraAdapter,
    llmContext: contextAdapter,
    llmMemory: memoryAdapter,
    llmSqlDb: sqlDbAdapter,
    bitbucket: bitbucketAdapter
  } = adapters;
  logger.info("Adapter modes selected", kinds);

  const triageAgent = new TriageAgent({
    contextAdapter,
    memoryAdapter
  });
  const executionAgent = new ExecutionAgent({
    bitbucketAdapter,
    memoryAdapter,
    executionConfig: {
      ...config.execution,
      dryRun: executionDryRun
    },
    logger
  });

  const tickets = await jiraAdapter.listOpenTickets();
  logger.debug("Tickets loaded", { count: tickets.length });
  const triage = await triageAgent.run(tickets);
  logger.info("Triage completed", {
    count: triage.length,
    feasible: triage.filter((item) => item.status_decision === "feasible").length
  });
  const executionCandidates = triage
    .filter((decision) =>
      ["feasible", "feasible_low_confidence", "blocked", "not_feasible"].includes(
        decision.status_decision
      )
    )
    .map((decision) => ({
      decision,
      ticket: tickets.find((ticket) => ticket.key === decision.ticket_key)
    }))
    .filter((item) => item.ticket);

  const execution =
    mode === "triage-and-execution" ? await executionAgent.run(executionCandidates) : [];
  logger.info("Execution completed", { count: execution.length });

  await sqlDbAdapter.recordRun({
    mode,
    dryRun,
    ticketCount: tickets.length
  });
  logger.debug("Run recorded in sql-db adapter", { ticketCount: tickets.length });

  return {
    mode,
    dryRun,
    adapterKinds: kinds,
    executionEnabled: config.execution.enabled,
    executionDryRun,
    ticketCount: tickets.length,
    triage,
    execution,
    memoryFile: config.memory.filePath,
    triageReport: renderTriageReport({
      mode,
      dryRun,
      ticketCount: tickets.length,
      triage,
      memoryFile: config.memory.filePath
    }),
    executionReport: renderExecutionReport({
      mode,
      dryRun,
      triage,
      execution,
      memoryFile: config.memory.filePath
    })
  };
}
