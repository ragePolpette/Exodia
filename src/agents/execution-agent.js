import { loadPrompt } from "../prompts/load-prompt.js";
import { ExecutionService } from "../execution/execution-service.js";
import { buildExecutionInsight } from "../memory/semantic-insights.js";
import { VerificationService } from "../verification/verification-service.js";
import { AgentPromptContextBuilder } from "../agent-runtime/agent-prompt-context.js";
import { inferChangeType } from "../adapters/bitbucket-adapter.js";
import { redactText } from "../security/redaction.js";

function unique(values) {
  return [...new Set((values ?? []).filter(Boolean))];
}

function normalizeList(values) {
  return Array.isArray(values) ? values.filter(Boolean) : [];
}

function sanitizeSingleLine(value) {
  return `${value ?? ""}`.replace(/\s+/g, " ").trim();
}

function compactText(value, maxLength = 1200) {
  const text = `${value ?? ""}`.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 3).trim()}...` : text;
}

function markdownList(values, { maxItems = 8 } = {}) {
  const list = normalizeList(values).map((value) => compactText(value, 300)).filter(Boolean);
  if (list.length === 0) {
    return "- None provided";
  }

  const rendered = list.slice(0, maxItems).map((value) => `- ${value}`);
  if (list.length > maxItems) {
    rendered.push(`- ...and ${list.length - maxItems} more`);
  }

  return rendered.join("\n");
}

const PULL_REQUEST_SIGNATURE = "Signed-off-by: Exodia";

export class ExecutionAgent {
  constructor({
    bitbucketAdapter,
    jiraAdapter,
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
    securityConfig,
    runtimePromptConfig
  }) {
    this.bitbucketAdapter = bitbucketAdapter;
    this.jiraAdapter = jiraAdapter;
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
    this.promptContextBuilder = new AgentPromptContextBuilder(runtimePromptConfig ?? {});
    this.service = new ExecutionService();
    this.verificationService = new VerificationService(verificationConfig);
  }

  async preparePromptContext() {
    return this.promptContextBuilder.loadInstructionFiles();
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
          ? `${inferChangeType(ticket)}(${ticket.key}): ${analysis.proposedFix.summary}`
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

  async runImplementationVerification({
    item,
    scopedTicket,
    prompt,
    executionMode,
    payload,
    analysisArtifact,
    diagnostics,
    implementation,
    attemptNumber,
    attempts
  }) {
    if (!this.agentRuntime?.isPhaseEnabled("implementation_verification")) {
      return {
        status: "passed",
        summary: "implementation verification runtime is disabled",
        confidence: 1,
        issues: [],
        verificationResults: implementation?.verificationResults ?? [],
        followUp: [],
        questions: []
      };
    }

    try {
      return await this.agentRuntime.verifyImplementation({
        prompt,
        ticket: scopedTicket,
        decision: item.decision,
        verification: item.verification ?? null,
        analysisProposal: analysisArtifact,
        verificationPlan: analysisArtifact?.verificationPlan ?? implementation?.verificationPlan ?? null,
        diagnostics,
        executionMode,
        workspaceRoot: this.resolveWorkspaceRoot(),
        payload,
        implementation,
        attemptNumber,
        previousAttempts: attempts
      });
    } catch (error) {
      return {
        phase: "implementation_verification",
        provider: this.agentRuntime.provider,
        model: this.agentRuntime.model,
        status: "failed",
        summary: `implementation verification runtime failed: ${error.message}`,
        confidence: 0,
        issues: [error.message],
        verificationResults: implementation?.verificationResults ?? [],
        followUp: ["Review the implementation manually or retry the run."],
        questions: []
      };
    }
  }

  async runImplementationLoop({
    item,
    scopedTicket,
    implementationPrompt,
    implementationVerificationPrompt,
    executionMode,
    payload,
    analysisArtifact,
    diagnostics
  }) {
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
    let finalImplementationVerification = null;
    const maxLoops =
      analysisArtifact?.verificationPlan?.maxVerificationLoops ??
      this.agentRuntime.config.implementation.maxVerificationLoops;

    for (let attemptNumber = 1; attemptNumber <= maxLoops; attemptNumber += 1) {
      const implementation = await this.agentRuntime.implementPlan({
        prompt: implementationPrompt,
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

      const attemptRecord = {
        attemptNumber,
        status: implementation.status,
        summary: implementation.summary,
        verificationResults: implementation.verificationResults,
        followUp: implementation.followUp,
        failureKind: implementation.failureKind,
        runtimeDiagnostics: implementation.runtimeDiagnostics,
        implementationVerification: null
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

      if (implementation.status === "completed") {
        const implementationVerification = await this.runImplementationVerification({
          item,
          scopedTicket,
          prompt: implementationVerificationPrompt,
          executionMode,
          payload: currentPayload,
          analysisArtifact,
          diagnostics,
          implementation,
          attemptNumber,
          attempts
        });
        finalImplementationVerification = implementationVerification;
        attemptRecord.implementationVerification = implementationVerification;

        if (implementationVerification.status === "passed") {
          break;
        }

        if (implementationVerification.status === "needs_changes" && attemptNumber < maxLoops) {
          finalImplementation = {
            ...implementation,
            status: "failed",
            summary: implementationVerification.summary || implementation.summary,
            verificationResults: unique([
              ...normalizeList(implementation.verificationResults),
              ...normalizeList(implementationVerification.verificationResults)
            ]),
            followUp: unique([
              ...normalizeList(implementation.followUp),
              ...normalizeList(implementationVerification.followUp),
              ...normalizeList(implementationVerification.issues)
            ])
          };
          continue;
        }

        finalImplementation = {
          ...implementation,
          status:
            implementationVerification.status === "needs_human"
              ? "needs_human"
              : implementationVerification.status === "blocked"
                ? "blocked"
                : "failed",
          summary: implementationVerification.summary || implementation.summary,
          verificationResults: unique([
            ...normalizeList(implementation.verificationResults),
            ...normalizeList(implementationVerification.verificationResults)
          ]),
          questions: implementationVerification.questions ?? implementation.questions,
          followUp: unique([
            ...normalizeList(implementation.followUp),
            ...normalizeList(implementationVerification.followUp),
            ...normalizeList(implementationVerification.issues)
          ]),
          failureKind:
            implementationVerification.status === "failed"
              ? "implementation_verification_failed"
              : implementation.failureKind
        };
        break;
      }

      if (
        implementation.status === "blocked" ||
        implementation.status === "needs_human" ||
        (implementation.status === "failed" && implementation.failureKind?.startsWith("runtime_"))
      ) {
        break;
      }
    }

    return {
      implementation: finalImplementation,
      implementationVerification: finalImplementationVerification,
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
      implementationVerificationStatus: implementationLoop.implementationVerification?.status ?? "not_run",
      implementationVerificationSummary: implementationLoop.implementationVerification?.summary ?? "",
      followUp: implementation?.followUp ?? [],
      failureKind: implementation?.failureKind ?? "",
      runtimeDiagnostics: implementation?.runtimeDiagnostics ?? null,
      implementationAttempts: implementationLoop.attempts.length
    };
  }

  buildPullRequestDescription({
    scopedTicket,
    analysisArtifact,
    implementationExtras,
    diagnostics
  }) {
    const redactionConfig = this.securityConfig?.redaction;
    const ticketDescription = compactText(
      redactText(scopedTicket.description || scopedTicket.summary || "", redactionConfig)
    );
    const analysisSummary = compactText(redactText(analysisArtifact?.summary ?? "", redactionConfig));
    const proposedFix = analysisArtifact?.proposedFix ?? {};
    const verificationPlan = analysisArtifact?.verificationPlan ?? {};
    const diagnosticsSummary = diagnostics?.used
      ? compactText(redactText(diagnostics.summary ?? "", redactionConfig), 500)
      : "";

    return [
      `# ${scopedTicket.key}: ${sanitizeSingleLine(scopedTicket.summary)}`,
      "",
      "## Bug",
      ticketDescription || "No ticket description provided.",
      "",
      "## Analysis",
      analysisSummary || "No analysis summary provided.",
      "",
      `- Product target: ${scopedTicket.productTarget ?? "unknown"}`,
      `- Repository target: ${scopedTicket.repoTarget ?? "UNKNOWN"}`,
      `- Area: ${analysisArtifact?.area ?? scopedTicket.area ?? "unknown"}`,
      diagnosticsSummary ? `- Diagnostics: ${diagnosticsSummary}` : null,
      "",
      "## Proposed Fix",
      proposedFix.summary ? compactText(redactText(proposedFix.summary, redactionConfig), 700) : "No proposed fix summary provided.",
      "",
      markdownList(proposedFix.steps),
      "",
      "## Implementation",
      implementationExtras.implementationSummary
        ? compactText(redactText(implementationExtras.implementationSummary, redactionConfig), 700)
        : "Implementation runtime did not provide a summary.",
      "",
      "Changed files:",
      markdownList(implementationExtras.changedFiles),
      "",
      "## Verification",
      verificationPlan.summary
        ? compactText(redactText(verificationPlan.summary, redactionConfig), 700)
        : "No verification plan summary provided.",
      "",
      "Planned checks:",
      markdownList(verificationPlan.checks),
      "",
      "Runtime evidence:",
      markdownList(implementationExtras.verificationResults),
      "",
      `Implementation verifier: ${implementationExtras.implementationVerificationStatus}`,
      implementationExtras.implementationVerificationSummary
        ? compactText(redactText(implementationExtras.implementationVerificationSummary, redactionConfig), 700)
        : null,
      "",
      "Verifier success criteria:",
      markdownList(verificationPlan.successCriteria),
      "",
      "---",
      PULL_REQUEST_SIGNATURE
    ]
      .filter((line) => line !== null)
      .join("\n");
  }

  async postPullRequestTicketComment(scopedTicket, pullRequest, { branchName, commitResult } = {}) {
    if (!pullRequest?.link || !this.jiraAdapter?.postPullRequestComment) {
      return {};
    }

    try {
      const ticketComment = await this.jiraAdapter.postPullRequestComment(scopedTicket, pullRequest, {
        branchName,
        commitSha: commitResult?.commitSha ?? ""
      });

      return {
        ticketCommentId: ticketComment.commentId ?? "",
        ticketCommentStatus: ticketComment.commentId ? "posted" : "posted_without_id"
      };
    } catch (error) {
      this.logger?.warn?.("Pull request ticket comment failed", {
        ticketKey: scopedTicket.key,
        pullRequestUrl: pullRequest.link,
        error: error.message
      });

      return {
        ticketCommentStatus: "failed"
      };
    }
  }

  async run(items) {
    const basePrompt = await loadPrompt("execution-agent.md");
    const implementationPrompt = await this.promptContextBuilder.buildPrompt(basePrompt, {
      phase: "implementation",
      agentRole: "implementation-agent"
    });
    const implementationVerificationPrompt = await this.promptContextBuilder.buildPrompt(basePrompt, {
      phase: "implementation_verification",
      agentRole: "implementation-verifier"
    });
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
      const result = await this.executeItem(
        item,
        {
          implementationPrompt,
          implementationVerificationPrompt
        },
        executionMode,
        analysisByTicket
      );
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

  async executeItem(item, prompts, executionMode, analysisByTicket) {
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

    const shouldReuseOpenPullRequests = this.executionConfig.reuseOpenPullRequests !== false;
    const existingPullRequest = shouldReuseOpenPullRequests
      ? await this.bitbucketAdapter.findOpenPullRequest?.(
          scopedTicket,
          payload.branchName
        )
      : null;

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
      implementationPrompt: prompts.implementationPrompt,
      implementationVerificationPrompt: prompts.implementationVerificationPrompt,
      executionMode,
      payload,
      analysisArtifact,
      diagnostics
    });
    payload = implementationLoop.payload;
    const implementation = implementationLoop.implementation;
    const implementationExtras = this.buildImplementationExtras(implementationLoop);
    payload = {
      ...payload,
      pullRequestDescription: this.buildPullRequestDescription({
        scopedTicket,
        analysisArtifact,
        implementationExtras,
        diagnostics
      })
    };

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
        pullRequestDescription: payload.pullRequestDescription,
        pullRequestUrl: ""
      };
    }

    const commitResult = await this.bitbucketAdapter.createCommit(
      scopedTicket,
      payload.branchName,
      payload.commitMessage
    );

    await this.bitbucketAdapter.pushBranch?.(scopedTicket, payload.branchName);

    const pullRequest = await this.bitbucketAdapter.openPullRequest(
      {
        ...scopedTicket,
        summary: payload.pullRequestTitle.replace(/^\[[^\]]+\]\s*/, "") || scopedTicket.summary
      },
      payload.branchName,
      commitResult,
      {
        description: payload.pullRequestDescription
      }
    );

    if (executionMode === "real" && !pullRequest?.link) {
      return this.service.buildPlannedResult(
        scopedTicket,
        "failed",
        "pull request creation did not return a URL",
        implementationExtras
      );
    }

    const ticketCommentExtras = await this.postPullRequestTicketComment(scopedTicket, pullRequest, {
      branchName: payload.branchName,
      commitResult
    });

    return this.service.buildExecutionResult(
      scopedTicket,
      payload.branchName,
      payload.commitMessage,
      {
        ...pullRequest,
        title: payload.pullRequestTitle || pullRequest.title
      },
      {
        ...implementationExtras,
        ...ticketCommentExtras
      }
    );
  }
}
