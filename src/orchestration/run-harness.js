import { buildAdapters } from "../adapters/bootstrap-adapters.js";
import { ExecutionAgent } from "../agents/execution-agent.js";
import { TriageAgent } from "../agents/triage-agent.js";
import { loadConfig } from "../config/load-config.js";
import { assertMode } from "../contracts/harness-contracts.js";
import { renderExecutionReport } from "../execution/render-execution-report.js";
import { createLogger } from "../logging/logger.js";
import { renderTriageReport } from "../triage/render-triage-report.js";

function countBy(items, field) {
  return items.reduce((accumulator, item) => {
    const key = item[field];
    accumulator[key] = (accumulator[key] ?? 0) + 1;
    return accumulator;
  }, {});
}

export async function runHarness({
  configPath = "./config/harness.config.example.json",
  modeOverride,
  dryRunOverride,
  executionEnabledOverride
} = {}) {
  const config = await loadConfig(configPath);
  const mode = modeOverride ?? config.mode;
  const executionDryRun = dryRunOverride ?? config.execution.dryRun ?? config.dryRun;
  const dryRun = executionDryRun;
  const executionEnabled = executionEnabledOverride ?? config.execution.enabled;
  const logger = createLogger({
    level: config.logging?.level ?? "info",
    includeTimestamp: config.logging?.includeTimestamp ?? false
  });

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
    memoryAdapter,
    sqlDbAdapter
  });
  const executionAgent = new ExecutionAgent({
    bitbucketAdapter,
    memoryAdapter,
    sqlDbAdapter,
    executionConfig: {
      ...config.execution,
      enabled: executionEnabled,
      dryRun: executionDryRun
    },
    logger
  });

  const memoryBefore = await memoryAdapter.listRecords();
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
  const memoryAfter = await memoryAdapter.listRecords();
  logger.info("Execution completed", { count: execution.length });

  const runRecord = await sqlDbAdapter.recordRun({
    mode,
    dryRun,
    ticketCount: tickets.length
  });
  logger.debug("Run recorded in sql-db adapter", runRecord);

  const triageCounts = countBy(triage, "status_decision");
  const executionCounts = countBy(execution, "status");
  const resumeStats = {
    memoryRecordsBefore: memoryBefore.length,
    memoryRecordsAfter: memoryAfter.length,
    skippedAlreadyRejected: triageCounts.skipped_already_rejected ?? 0,
    skippedAlreadyInProgress: triageCounts.skipped_already_in_progress ?? 0,
    blockedFromMemory: triage.filter(
      (item) => item.status_decision === "blocked" && item.last_outcome === "blocked"
    ).length
  };

  if (resumeStats.skippedAlreadyRejected > 0 || resumeStats.skippedAlreadyInProgress > 0) {
    logger.warn("Resume reused existing memory decisions", resumeStats);
  }

  return {
    mode,
    dryRun,
    adapterKinds: kinds,
    executionEnabled,
    executionDryRun,
    runId: runRecord.runId ?? "",
    ticketCount: tickets.length,
    triage,
    execution,
    triageCounts,
    executionCounts,
    resumeStats,
    memoryFile: config.memory.filePath,
    triageReport: renderTriageReport({
      mode,
      dryRun,
      adapterKinds: kinds,
      runId: runRecord.runId ?? "",
      ticketCount: tickets.length,
      triageCounts,
      resumeStats,
      triage,
      memoryFile: config.memory.filePath
    }),
    executionReport: renderExecutionReport({
      mode,
      dryRun,
      adapterKinds: kinds,
      runId: runRecord.runId ?? "",
      executionCounts,
      resumeStats,
      triage,
      execution,
      memoryFile: config.memory.filePath
    })
  };
}
