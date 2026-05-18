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
import { AnalysisArtifactStore } from "../agent-runtime/analysis-artifact-store.js";
import { ImplementationArtifactStore } from "../agent-runtime/implementation-artifact-store.js";
import { FileMemoryStore } from "../memory/file-memory-store.js";
import { renderFinalReport } from "../reporting/render-final-report.js";
import { renderTriageReport } from "../triage/render-triage-report.js";
import { TicketWorkflowStore } from "./ticket-workflow-store.js";

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

function isCandidateDecision(decision) {
  return ["feasible", "feasible_low_confidence"].includes(decision.status_decision);
}

function approvalRequired(policy, decision) {
  if (!isCandidateDecision(decision)) {
    return false;
  }

  if (policy === "always") {
    return true;
  }

  return policy === "on_low_confidence" && decision.status_decision === "feasible_low_confidence";
}

function extractApprovalDecision(ticket) {
  const answers = (ticket.humanClarifications ?? [])
    .filter((item) => item.phase === "candidate_approval")
    .map((item) => `${item.text ?? item.summary ?? ""}`.toLowerCase());
  const combined = answers.join(" ");

  if (/\b(reject|rejected|no|stop|blocca|rifiuta|scarta)\b/i.test(combined)) {
    return "rejected";
  }

  if (/\b(approve|approved|yes|ok|go|procedi|approvo|vai)\b/i.test(combined)) {
    return "approved";
  }

  return "";
}

async function applyCandidateApprovalGate({
  candidateItems,
  workflowStore,
  interactionService,
  humanApprovalPolicy,
  logger
}) {
  if (!workflowStore) {
    return {
      approvedItems: candidateItems,
      awaitingApproval: [],
      rejected: []
    };
  }

  const approvedItems = [];
  const awaitingApproval = [];
  const rejected = [];

  for (const item of candidateItems) {
    if (!isCandidateDecision(item.decision)) {
      approvedItems.push(item);
      continue;
    }

    const required = approvalRequired(humanApprovalPolicy, item.decision);
    if (!required) {
      await workflowStore.markApproval({
        ticket: item.ticket,
        required: false,
        status: "approved",
        reason: "human approval not required by workflow policy"
      });
      approvedItems.push(item);
      continue;
    }

    const explicitDecision = extractApprovalDecision(item.ticket);
    if (explicitDecision === "approved") {
      await workflowStore.markApproval({
        ticket: item.ticket,
        required: true,
        status: "approved",
        reason: "human approved candidate"
      });
      approvedItems.push(item);
      continue;
    }

    if (explicitDecision === "rejected") {
      await workflowStore.markApproval({
        ticket: item.ticket,
        required: true,
        status: "rejected",
        reason: "human rejected candidate"
      });
      rejected.push(item);
      continue;
    }

    const interaction = await interactionService?.requestClarification?.({
      phase: "candidate_approval",
      ticket: item.ticket,
      question: [
        `Approve Exodia to analyze ${item.ticket.key}?`,
        `Candidate target: ${item.decision.product_target}/${item.decision.repo_target}.`,
        `Reason: ${item.decision.short_reason}.`,
        "Reply with approve/procedi/vai to continue, or reject/scarta/stop to skip."
      ].join(" "),
      reason: item.decision.short_reason,
      blocking: true,
      context: {
        productTarget: item.decision.product_target,
        repoTarget: item.decision.repo_target,
        confidence: item.decision.confidence
      }
    });

    await workflowStore.markApproval({
      ticket: item.ticket,
      required: true,
      status: "awaiting_response",
      interaction,
      reason: interaction
        ? "candidate waiting for human approval"
        : "candidate requires approval but no interaction channel delivered the question"
    });
    awaitingApproval.push(item);
    logger?.info("Candidate is waiting for human approval", {
      ticketKey: item.ticket.key,
      interactionId: interaction?.id ?? ""
    });
  }

  return {
    approvedItems,
    awaitingApproval,
    rejected
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
  const { adapters, agentRuntime, ticketMemoryAdapter, kinds, mcpClient } = buildAdapters({ config, logger });
  const analysisArtifactStore = new AnalysisArtifactStore(new FileMemoryStore(config.agentRuntime.artifactFile));
  const implementationArtifactStore = new ImplementationArtifactStore(
    new FileMemoryStore(config.agentRuntime.implementationArtifactFile)
  );
  const workflowStore = config.workflow?.enabled
    ? new TicketWorkflowStore(new FileMemoryStore(config.workflow.stateFile))
    : null;
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
    agentRuntime,
    analysisArtifactStore,
    logger,
    securityConfig: config.security,
    runtimePromptConfig: config
  });
  const verificationAgent = new VerificationAgent({
    bitbucketAdapter,
    verificationConfig: config.verification,
    interactionService,
    agentRuntime,
    analysisArtifactStore,
    logger,
    runtimePromptConfig: config
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
    interactionService,
    agentRuntime,
    analysisArtifactStore,
    implementationArtifactStore,
    logger,
    securityConfig: config.security,
    runtimePromptConfig: config
  });

  const promptContexts = await Promise.all([
    triageAgent.preparePromptContext(),
    verificationAgent.preparePromptContext(),
    executionAgent.preparePromptContext()
  ]);
  const promptContext = promptContexts[0];
  auditTrail.push(createAuditEntry("prompt-context", "agent prompt context loaded", {
    workspaceRoot: promptContext.workspaceRoot,
    files: promptContext.files.map((file) => file.filePath),
    missingGeneral: promptContext.missingGeneral,
    missingTarget: promptContext.missingTarget
  }));
  logger.info("Agent prompt context loaded", {
    workspaceRoot: promptContext.workspaceRoot,
    files: promptContext.files.map((file) => file.filePath),
    missingGeneral: promptContext.missingGeneral,
    missingTarget: promptContext.missingTarget
  });

  const memoryBefore = await ticketMemoryAdapter.listRecords();
  const loadedTickets = await jiraAdapter.listOpenTickets();
  const interactionPreparation = interactionService
    ? await interactionService.prepareTickets(loadedTickets)
    : { tickets: loadedTickets, pending: [], resolved: [] };
  const tickets = interactionPreparation.tickets;
  await workflowStore?.ensureTickets(tickets);
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
  for (const decision of triage) {
    await workflowStore?.recordCandidate(decision);
  }
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
  const approvalGate = await applyCandidateApprovalGate({
    candidateItems,
    workflowStore,
    interactionService,
    humanApprovalPolicy: config.workflow?.humanApprovalPolicy ?? "skip",
    logger
  });
  auditTrail.push(
    createAuditEntry("approval", "candidate approval gate completed", {
      approved: approvalGate.approvedItems.length,
      awaiting: approvalGate.awaitingApproval.length,
      rejected: approvalGate.rejected.length
    })
  );
  const verification =
    mode === "triage-and-execution" ? await verificationAgent.run(approvalGate.approvedItems) : [];
  for (const result of verification) {
    await workflowStore?.markPhase(
      result.ticketKey,
      "analysis",
      result.status === "approved"
        ? "analysis_approved"
        : result.status === "needs_review"
          ? "code_analysis_ready"
          : "blocked",
      result.analysisArtifact ? "analysis" : ""
    );
  }
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
  const verificationByTicket = new Map(verification.map((result) => [result.ticketKey, result]));
  const executionCandidates =
    mode === "triage-and-execution" && config.verification.enabled !== false
      ? approvalGate.approvedItems
          .filter((item) => verificationByTicket.get(item.ticket.key)?.status === "approved")
          .map((item) => ({
            ...item,
            decision: verificationByTicket.get(item.ticket.key)?.refinedDecision ?? item.decision,
            verification: verificationByTicket.get(item.ticket.key) ?? null
          }))
      : candidateItems;

  const execution =
    mode === "triage-and-execution" ? await executionAgent.run(executionCandidates) : [];
  for (const result of execution) {
    await workflowStore?.markPhase(
      result.ticketKey,
      result.status === "pr_opened" ? "implementationCheck" : "implementation",
      result.status === "pr_opened"
        ? "pr_opened"
        : result.status === "blocked"
          ? "blocked"
          : result.status === "failed"
            ? "failed"
            : "implementation_ready",
      result.status
    );
  }
  const memoryAfter = await ticketMemoryAdapter.listRecords();
  const workflowSnapshot = workflowStore ? await workflowStore.snapshot() : null;
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
    agentRuntime: {
      provider: agentRuntime.provider,
      enabled: agentRuntime.isEnabled(),
      enabledPhases: agentRuntime.config.enabledPhases,
      artifactFile: config.agentRuntime.artifactFile,
      implementationArtifactFile: config.agentRuntime.implementationArtifactFile
    },
    interactionStats: {
      pending: interactionPreparation.pending.length,
      resolved: interactionPreparation.resolved.length
    },
    workflow: workflowSnapshot,
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
      workflow: workflowSnapshot,
      resumeStats,
      auditTrail
    }
  });

  return {
    ...summary,
    finalReport
  };
}



