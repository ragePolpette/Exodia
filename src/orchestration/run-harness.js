import { randomUUID } from "node:crypto";
import { buildAdapters } from "../adapters/bootstrap-adapters.js";
import { ExecutionAgent } from "../agents/execution-agent.js";
import { TriageAgent } from "../agents/triage-agent.js";
import { VerificationAgent } from "../agents/verification-agent.js";
import { loadConfig } from "../config/load-config.js";
import { assertMode } from "../contracts/harness-contracts.js";
import { renderExecutionReport } from "../execution/render-execution-report.js";
import { InteractionService } from "../interaction/interaction-service.js";
import { InteractionStore } from "../interaction/interaction-store.js";
import { createLogger } from "../logging/logger.js";
import { resolveRunLogPaths, RunLogStore } from "../logging/run-log-store.js";
import { renderFinalReport } from "../reporting/render-final-report.js";
import { renderTriageReport } from "../triage/render-triage-report.js";

function countBy(items, field) {
  return items.reduce((accumulator, item) => {
    const key = item[field];
    accumulator[key] = (accumulator[key] ?? 0) + 1;
    return accumulator;
  }, {});
}

function createAuditEntry(phase, message, details = {}) {
  return {
    phase,
    message,
    details,
    at: new Date().toISOString()
  };
}

export async function runHarness({
  configPath = "./config/harness.config.example.json",
  modeOverride,
  dryRunOverride,
  executionEnabledOverride
} = {}) {
  const config = await loadConfig(configPath);
  const localRunId = `exodia-${randomUUID()}`;
  const runStartedAt = new Date().toISOString();
  const logPaths = resolveRunLogPaths(config.logging, localRunId, runStartedAt);
  const runLogStore = new RunLogStore(logPaths);
  const mode = modeOverride ?? config.mode;
  const executionDryRun = dryRunOverride ?? config.execution.dryRun ?? config.dryRun;
  const dryRun = executionDryRun;
  const executionEnabled = executionEnabledOverride ?? config.execution.enabled;
  const logger = createLogger({
    level: config.logging?.level ?? "info",
    includeTimestamp: config.logging?.includeTimestamp ?? false,
    redaction: config.security?.redaction,
    runId: localRunId,
    sink: runLogStore
  });
  const auditTrail = [];
  auditTrail.push(createAuditEntry("run", "harness run started", { mode, dryRun }));

  assertMode(mode);
  logger.info("Harness run started", { mode, dryRun, configPath: config.configPath });
  const { adapters, ticketMemoryAdapter, kinds, mcpClient } = buildAdapters({ config, logger });
  const {
    jira: jiraAdapter,
    llmContext: contextAdapter,
    llmMemory: semanticMemoryAdapter,
    llmSqlDb: sqlDbAdapter,
    bitbucket: bitbucketAdapter
  } = adapters;
  const interactionService = config.interaction?.enabled
    ? new InteractionService({
        config: config.interaction,
        store: new InteractionStore(config.interaction.storeFile),
        jiraAdapter,
        semanticMemoryAdapter,
        ticketMemoryAdapter,
        mcpClient,
        logger,
        securityConfig: config.security,
        targeting: config.targeting
      })
    : null;
  auditTrail.push(createAuditEntry("bootstrap", "adapters bootstrapped", kinds));
  logger.info("Adapter modes selected", kinds);

  const triageAgent = new TriageAgent({
    contextAdapter,
    ticketMemoryAdapter,
    semanticMemoryAdapter,
    sqlDbAdapter,
    interactionService,
    logger,
    securityConfig: config.security
  });
  const verificationAgent = new VerificationAgent({
    bitbucketAdapter,
    verificationConfig: config.verification,
    interactionService,
    logger
  });
  const executionAgent = new ExecutionAgent({
    bitbucketAdapter,
    ticketMemoryAdapter,
    semanticMemoryAdapter,
    sqlDbAdapter,
    executionConfig: {
      ...config.execution,
      enabled: executionEnabled,
      dryRun: executionDryRun
    },
    verificationConfig: config.verification,
    logger,
    securityConfig: config.security
  });

  const memoryBefore = await ticketMemoryAdapter.listRecords();
  const loadedTickets = await jiraAdapter.listOpenTickets();
  const interactionPreparation = interactionService
    ? await interactionService.prepareTickets(loadedTickets)
    : { tickets: loadedTickets, pending: [], resolved: [] };
  const tickets = interactionPreparation.tickets;
  auditTrail.push(createAuditEntry("input", "tickets loaded", { count: tickets.length }));
  if (interactionPreparation.pending.length > 0 || interactionPreparation.resolved.length > 0) {
    auditTrail.push(
      createAuditEntry("interaction", "interaction state synchronized", {
        pending: interactionPreparation.pending.length,
        resolved: interactionPreparation.resolved.length
      })
    );
  }
  logger.debug("Tickets loaded", { count: tickets.length });
  const triage = await triageAgent.run(tickets);
  auditTrail.push(
    createAuditEntry("triage", "triage completed", {
      count: triage.length,
      feasible: triage.filter((item) => item.status_decision === "feasible").length
    })
  );
  logger.info("Triage completed", {
    count: triage.length,
    feasible: triage.filter((item) => item.status_decision === "feasible").length
  });
  const candidateItems = triage
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
  const verification =
    mode === "triage-and-execution" ? await verificationAgent.run(candidateItems) : [];
  auditTrail.push(
    createAuditEntry("verification", "verification completed", {
      count: verification.length,
      approved: verification.filter((item) => item.status === "approved").length
    })
  );
  logger.info("Verification completed", {
    count: verification.length,
    approved: verification.filter((item) => item.status === "approved").length
  });
  const executionCandidates =
    mode === "triage-and-execution" && config.verification.enabled !== false
      ? candidateItems
          .filter((item) =>
            verification.some(
              (result) => result.ticketKey === item.ticket.key && result.status === "approved"
            )
          )
          .map((item) => ({
            ...item,
            verification: verification.find((result) => result.ticketKey === item.ticket.key) ?? null
          }))
      : candidateItems;

  const execution =
    mode === "triage-and-execution" ? await executionAgent.run(executionCandidates) : [];
  const memoryAfter = await ticketMemoryAdapter.listRecords();
  auditTrail.push(
    createAuditEntry("execution", "execution completed", {
      count: execution.length
    })
  );
  logger.info("Execution completed", { count: execution.length });

  const runRecord = await sqlDbAdapter.recordRun({
    mode,
    dryRun,
    ticketCount: tickets.length,
    runId: localRunId
  });
  auditTrail.push(
    createAuditEntry("run-record", "run record handled", {
      runId: runRecord.runId ?? "",
      stored: runRecord.stored ?? false
    })
  );
  logger.debug("Run recorded in sql-db adapter", runRecord);

  const triageCounts = countBy(triage, "status_decision");
  const verificationCounts = countBy(verification, "status");
  const executionCounts = countBy(execution, "status");
  const executionTrustLevel =
    config.execution.trustLevel ||
    (kinds.bitbucket === "mcp"
      ? executionEnabled && !executionDryRun
        ? "mcp-write"
        : "mcp-readonly"
      : "mock");
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

  const summary = {
    mode,
    dryRun,
    adapterKinds: kinds,
    executionEnabled,
    executionDryRun,
    executionTrustLevel,
    interactionStats: {
      pending: interactionPreparation.pending.length,
      resolved: interactionPreparation.resolved.length
    },
    runId: localRunId,
    recordedRunId: runRecord.runId ?? "",
    runStartedAt,
    logFiles: logPaths
      ? {
          jsonl: logPaths.jsonlFile,
          summaryText: logPaths.summaryTextFile,
          summaryJson: logPaths.summaryJsonFile
        }
      : null,
    ticketCount: tickets.length,
    triage,
    execution,
    triageCounts,
    verification,
    verificationCounts,
    executionCounts,
    auditTrail,
    resumeStats,
    memoryFile: config.memory.filePath,
    triageReport: renderTriageReport({
      mode,
      dryRun,
      executionTrustLevel,
      adapterKinds: kinds,
      runId: localRunId,
      ticketCount: tickets.length,
      interactionStats: {
        pending: interactionPreparation.pending.length,
        resolved: interactionPreparation.resolved.length
      },
      logFiles: logPaths
        ? {
            jsonl: logPaths.jsonlFile,
            summaryText: logPaths.summaryTextFile,
            summaryJson: logPaths.summaryJsonFile
          }
        : null,
      triageCounts,
      auditTrail,
      resumeStats,
      triage,
      memoryFile: config.memory.filePath,
      redaction: config.security?.redaction
    }),
    executionReport: renderExecutionReport({
      mode,
      dryRun,
      executionTrustLevel,
      adapterKinds: kinds,
      runId: localRunId,
      verification,
      verificationCounts,
      executionCounts,
      interactionStats: {
        pending: interactionPreparation.pending.length,
        resolved: interactionPreparation.resolved.length
      },
      logFiles: logPaths
        ? {
            jsonl: logPaths.jsonlFile,
            summaryText: logPaths.summaryTextFile,
            summaryJson: logPaths.summaryJsonFile
          }
        : null,
      auditTrail,
      resumeStats,
      triage,
      execution,
      memoryFile: config.memory.filePath,
      redaction: config.security?.redaction
    })
  };

  const finalReport = renderFinalReport(summary);
  runLogStore.writeSummary({
    text: finalReport,
    json: {
      runId: localRunId,
      recordedRunId: runRecord.runId ?? "",
      startedAt: runStartedAt,
      mode,
      dryRun,
      adapterKinds: kinds,
      ticketCount: tickets.length,
      triageCounts,
      verificationCounts,
      executionCounts,
      interactionStats: summary.interactionStats,
      resumeStats,
      auditTrail
    }
  });

  return {
    ...summary,
    finalReport
  };
}
