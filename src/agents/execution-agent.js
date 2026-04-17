import { loadPrompt } from "../prompts/load-prompt.js";
import { ExecutionService } from "../execution/execution-service.js";
import { buildExecutionInsight } from "../memory/semantic-insights.js";
import { VerificationService } from "../verification/verification-service.js";

function unique(values) {
  return [...new Set((values ?? []).filter(Boolean))];
}

function normalizeList(values) {
  return Array.isArray(values) ? values.filter(Boolean) : [];
}

function sanitizeSingleLine(value) {
  return `${value ?? ""}`.replace(/\s+/g, " ").trim();
}

export class ExecutionAgent {
  constructor({
    bitbucketAdapter,
    ticketMemoryAdapter,
    semanticMemoryAdapter,
    sqlDbAdapter,
    executionConfig,
    verificationConfig,
    interactionService,
    agentRuntime,
    analysisArtifactStore,
    implementationArtifactStore,
    logger,
    securityConfig
  }) {
    this.bitbucketAdapter = bitbucketAdapter;
    this.ticketMemoryAdapter = ticketMemoryAdapter;
    this.semanticMemoryAdapter = semanticMemoryAdapter;
    this.sqlDbAdapter = sqlDbAdapter;
    this.executionConfig = executionConfig;
    this.interactionService = interactionService;
    this.agentRuntime = agentRuntime;
    this.analysisArtifactStore = analysisArtifactStore;
    this.implementationArtifactStore = implementationArtifactStore;
    this.logger = logger;
    this.securityConfig = securityConfig;
    this.service = new ExecutionService();
    this.verificationService = new VerificationService(verificationConfig);
  }

  resolveWorkspaceRoot() {
    return (
      this.executionConfig.workspaceRoot ||
      this.bitbucketAdapter.workspaceRoot ||
      process.cwd()
    );
  }

  async loadAnalysisArtifacts() {
    const artifacts = await this.analysisArtifactStore?.list?.();
    return new Map((artifacts ?? []).map((artifact) => [artifact.ticketKey, artifact]));
  }

  buildFallbackAnalysis(item) {
    return {
      phase: "analysis",
      provider: "heuristic",
      model: "",
      status:
        item.decision.status_decision === "feasible_low_confidence"
          ? "needs_human"
          : item.decision.status_decision === "blocked" || item.decision.status_decision === "not_feasible"
            ? "blocked"
            : "proposal_ready",
      summary: item.decision.short_reason ?? "",
      feasibility:
        item.decision.status_decision === "feasible"
          ? "feasible"
          : item.decision.status_decision,
      confidence: item.decision.confidence ?? 0,
      productTarget: item.decision.product_target ?? item.ticket.productTarget ?? "unknown",
      repoTarget: item.decision.repo_target ?? item.ticket.repoTarget ?? "UNKNOWN",
      area: item.ticket.area ?? item.decision.product_target ?? "unknown",
      proposedFix: {
        summary: item.decision.implementation_hint ?? item.decision.short_reason ?? "",
        steps: item.decision.implementation_hint ? [item.decision.implementation_hint] : [],
        risks: [],
        assumptions: []
      },
      verificationPlan: {
        summary: "",
        checks: [],
        successCriteria: [],
        maxVerificationLoops: this.agentRuntime?.config?.implementation?.maxVerificationLoops ?? 3
      },
      questions: []
    };
  }

  buildInitialPayload(ticket, analysis) {
    return {
      branchName: this.bitbucketAdapter.planBranch(ticket),
      commitMessage: sanitizeSingleLine(
        analysis?.proposedFix?.summary
          ? `feat(${ticket.key}): ${analysis.proposedFix.summary}`
          : this.service.buildCommitMessage(ticket)
      ),
      pullRequestTitle: sanitizeSingleLine(
        analysis?.proposedFix?.summary
          ? `[${ticket.key}] ${analysis.proposedFix.summary}`
          : `[${ticket.key}] ${ticket.summary}`
      )
    };
  }

  buildExecutionClarificationQuestion(ticket, implementation) {
    const implementationQuestions = normalizeList(implementation?.questions)
      .map((question) => question.question)
      .filter(Boolean)
      .join(" ");

    return [
      `Please clarify ${ticket.key}: execution is waiting for missing implementation details.`,
      implementation?.summary ? `Implementation summary: ${implementation.summary}.` : "",
      implementationQuestions ? `Open questions: ${implementationQuestions}` : "",
      "Reply with the missing functional or technical detail needed to continue the fix."
    ]
      .filter(Boolean)
      .join(" ");
  }

  async runPreflightChecks(item, scopedTicket, payload) {
    return this.verificationService.runPreflight({
      item: {
        ...item,
        ticket: scopedTicket
      },
      workspaceRoot: this.resolveWorkspaceRoot(),
      payload
    });
  }

  async maybeRunDiagnostics(ticket) {
    const request = ticket.diagnostics?.execution;
    if (!request?.query && !request?.statement) {
      return null;
    }

    return this.sqlDbAdapter.runDiagnosticQuery({
      phase: "execution",
      ticketKey: ticket.key,
      ...request
    });
  }

  async runImplementationLoop({ item, scopedTicket, prompt, executionMode, payload, analysisArtifact, diagnostics }) {
    if (!this.agentRuntime?.isPhaseEnabled("implementation")) {
      return {
        implementation: null,
        payload,
        attempts: []
      };
    }

    const attempts = [];
    let currentPayload = { ...payload };
    let finalImplementation = null;
    const maxLoops =
      analysisArtifact?.verificationPlan?.maxVerificationLoops ??
      this.agentRuntime.config.implementation.maxVerificationLoops;

    for (let attemptNumber = 1; attemptNumber <= maxLoops; attemptNumber += 1) {
      const implementation = await this.agentRuntime.implementPlan({
        prompt,
        ticket: scopedTicket,
        decision: item.decision,
        verification: item.verification ?? null,
        analysisProposal: analysisArtifact,
        verificationPlan: analysisArtifact?.verificationPlan ?? null,
        diagnostics,
        executionMode,
        workspaceRoot: this.resolveWorkspaceRoot(),
        payload: currentPayload,
        attemptNumber,
        maxVerificationLoops: maxLoops,
        previousAttempts: attempts
      });

      finalImplementation = implementation;
      if (implementation.branchName) {
        currentPayload.branchName = implementation.branchName;
      }
      if (implementation.commitMessage) {
        currentPayload.commitMessage = sanitizeSingleLine(implementation.commitMessage);
      }
      if (implementation.pullRequestTitle) {
        currentPayload.pullRequestTitle = sanitizeSingleLine(implementation.pullRequestTitle);
      }

      const attemptRecord = {
        attemptNumber,
        status: implementation.status,
        summary: implementation.summary,
        verificationResults: implementation.verificationResults,
        followUp: implementation.followUp
      };
      attempts.push(attemptRecord);

      await this.implementationArtifactStore?.upsertArtifacts?.([
        {
          ticket: scopedTicket,
          implementation: {
            ...implementation,
            branchName: currentPayload.branchName,
            commitMessage: currentPayload.commitMessage,
            pullRequestTitle: currentPayload.pullRequestTitle,
            verificationPlan: analysisArtifact?.verificationPlan ?? implementation.verificationPlan
          },
          attemptNumber
        }
      ]);

      if (
        implementation.status === "completed" ||
        implementation.status === "blocked" ||
        implementation.status === "needs_human"
      ) {
        break;
      }
    }

    return {
      implementation: finalImplementation,
      payload: currentPayload,
      attempts
    };
  }

  buildImplementationExtras(implementationLoop) {
    const implementation = implementationLoop.implementation;
    return {
      implementationStatus: implementation?.status ?? "not_run",
      implementationSummary: implementation?.summary ?? "",
      changedFiles: implementation?.changedFiles ?? [],
      verificationResults: implementation?.verificationResults ?? [],
      followUp: implementation?.followUp ?? [],
      implementationAttempts: implementationLoop.attempts.length
    };
  }

  async run(items) {
    const prompt = await loadPrompt("execution-agent.md");
    await this.bitbucketAdapter.assertNoMergePolicy();
    const policy = this.service.resolveMode({
      executionConfig: this.executionConfig,
      bitbucketKind: this.bitbucketAdapter.kind,
      bitbucketAdapter: this.bitbucketAdapter
    });
    const executionMode = policy.mode;
    const analysisByTicket = await this.loadAnalysisArtifacts();

    this.logger?.info("Execution mode resolved", {
      mode: executionMode,
      trustLevel: policy.trustLevel,
      adapter: this.bitbucketAdapter.kind
    });

    if (executionMode === "disabled") {
      return [];
    }

    const results = [];

    for (const item of items) {
      const result = await this.executeItem(item, prompt, executionMode, analysisByTicket);
      results.push(result);

      await this.ticketMemoryAdapter.upsertRecords([
        {
          ticket_key: result.ticketKey,
          project_key: result.projectKey,
          product_target: result.productTarget,
          repo_target: result.repoTarget,
          status_decision: item.decision.status_decision,
          confidence: item.decision.confidence,
          short_reason: result.reason,
          implementation_hint: item.decision.implementation_hint ?? "",
          branch_name: result.branchName,
          pr_url: result.pullRequestUrl,
          last_outcome: result.status,
          recheck_conditions: item.decision.recheck_conditions ?? []
        }
      ]);

      try {
        const insight = buildExecutionInsight(
          item.ticket,
          item.decision,
          result,
          this.securityConfig?.redaction
        );
        if (insight) {
          await this.semanticMemoryAdapter?.captureExecutionInsight?.(insight);
        }
      } catch (error) {
        this.logger?.debug("Semantic memory execution capture skipped", {
          ticketKey: item.ticket?.key ?? result.ticketKey,
          error: error.message
        });
      }

      if (result.status === "blocked" || result.status === "not_feasible" || result.status === "failed") {
        break;
      }
    }

    return results;
  }

  async executeItem(item, prompt, executionMode, analysisByTicket) {
    const { ticket, decision } = item;
    const scopedTicket = {
      ...ticket,
      productTarget: decision.product_target ?? ticket.productTarget ?? ticket.product_target ?? "unknown",
      repoTarget: decision.repo_target ?? ticket.repoTarget ?? ticket.repo_target ?? "UNKNOWN"
    };
    const analysisArtifact =
      item.verification?.analysisArtifact ??
      analysisByTicket.get(ticket.key) ??
      this.buildFallbackAnalysis(item);

    if (decision.status_decision === "feasible_low_confidence") {
      return this.service.buildPlannedResult(
        scopedTicket,
        "skipped_low_confidence",
        "execution skipped because triage confidence is too low"
      );
    }

    if (decision.status_decision === "blocked") {
      return this.service.buildPlannedResult(
        scopedTicket,
        "blocked",
        "execution stopped because the ticket is blocked"
      );
    }

    if (decision.status_decision === "not_feasible") {
      return this.service.buildPlannedResult(
        scopedTicket,
        "not_feasible",
        "execution stopped because the ticket is not feasible"
      );
    }

    const diagnostics = await this.maybeRunDiagnostics(scopedTicket);
    let payload = this.buildInitialPayload(scopedTicket, analysisArtifact);

    if (diagnostics?.used && (diagnostics.shouldBlock || (diagnostics.blockers ?? []).length > 0)) {
      return this.service.buildPlannedResult(
        scopedTicket,
        "blocked",
        diagnostics.summary || "execution blocked by SQL diagnostics"
      );
    }

    const existingPullRequest = await this.bitbucketAdapter.findOpenPullRequest?.(
      scopedTicket,
      payload.branchName
    );

    if (existingPullRequest) {
      return this.service.buildExistingPullRequestResult(
        scopedTicket,
        payload.branchName,
        existingPullRequest,
        {
          implementationStatus: "reused_existing_pr",
          implementationSummary: "execution skipped because an open pull request already exists",
          changedFiles: [],
          verificationResults: [],
          followUp: [],
          implementationAttempts: 0
        }
      );
    }

    if (executionMode !== "dry-run-mcp") {
      await this.bitbucketAdapter.createBranch(scopedTicket, payload.branchName);
      await this.bitbucketAdapter.checkoutBranch(scopedTicket, payload.branchName);
    }

    const implementationLoop = await this.runImplementationLoop({
      item,
      scopedTicket,
      prompt,
      executionMode,
      payload,
      analysisArtifact,
      diagnostics
    });
    payload = implementationLoop.payload;
    const implementation = implementationLoop.implementation;
    const implementationExtras = this.buildImplementationExtras(implementationLoop);

    if (implementation?.status === "needs_human") {
      let reason = implementation.summary || "execution paused for human clarification";
      if (this.interactionService?.isEnabledForPhase("execution")) {
        const interaction = await this.interactionService.requestClarification({
          phase: "execution",
          ticket: scopedTicket,
          question: this.buildExecutionClarificationQuestion(scopedTicket, implementation),
          reason,
          context: {
            productTarget: scopedTicket.productTarget,
            repoTarget: scopedTicket.repoTarget,
            branchName: payload.branchName,
            verificationResults: implementation.verificationResults ?? []
          }
        });
        if (interaction) {
          reason = `awaiting human clarification (${interaction.id}) on ${interaction.destinations?.join("+") || "configured channels"}: ${reason}`;
        }
      }

      return this.service.buildPlannedResult(scopedTicket, "blocked", reason, implementationExtras);
    }

    if (implementation?.status === "blocked") {
      return this.service.buildPlannedResult(
        scopedTicket,
        "blocked",
        implementation.summary || "execution blocked by implementation runtime",
        implementationExtras
      );
    }

    if (implementation?.status === "failed") {
      return this.service.buildPlannedResult(
        scopedTicket,
        "failed",
        implementation.summary || "implementation verify loop exhausted before completion",
        implementationExtras
      );
    }

    const preflightResult = await this.runPreflightChecks(item, scopedTicket, payload);
    if (preflightResult.status !== "approved") {
      return this.service.buildPlannedResult(
        scopedTicket,
        "blocked",
        preflightResult.reason,
        implementationExtras
      );
    }

    if (executionMode === "dry-run-mcp") {
      return {
        ...this.service.buildPlannedResult(
          scopedTicket,
          "dry_run_planned",
          diagnostics?.summary
            ? `execution dry-run planned with diagnostics: ${diagnostics.summary}`
            : "execution dry-run planned with MCP adapter; no real PR opened",
          implementationExtras
        ),
        branchName: payload.branchName,
        commitMessage: payload.commitMessage,
        pullRequestTitle: payload.pullRequestTitle,
        pullRequestUrl: ""
      };
    }

    const commitResult = await this.bitbucketAdapter.createCommit(
      scopedTicket,
      payload.branchName,
      payload.commitMessage
    );
    const pullRequest = await this.bitbucketAdapter.openPullRequest(
      {
        ...scopedTicket,
        summary: payload.pullRequestTitle.replace(/^\[[^\]]+\]\s*/, "") || scopedTicket.summary
      },
      payload.branchName,
      commitResult
    );

    return this.service.buildExecutionResult(
      scopedTicket,
      payload.branchName,
      payload.commitMessage,
      {
        ...pullRequest,
        title: payload.pullRequestTitle || pullRequest.title
      },
      implementationExtras
    );
  }
}
