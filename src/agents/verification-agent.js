import { loadPrompt } from "../prompts/load-prompt.js";
import { VerificationService } from "../verification/verification-service.js";

function unique(values) {
  return [...new Set((values ?? []).filter(Boolean))];
}

function normalizeList(values) {
  return Array.isArray(values) ? values.filter(Boolean) : [];
}

export class VerificationAgent {
  constructor({
    bitbucketAdapter,
    verificationConfig,
    interactionService,
    agentRuntime,
    analysisArtifactStore,
    logger
  }) {
    this.bitbucketAdapter = bitbucketAdapter;
    this.interactionService = interactionService;
    this.agentRuntime = agentRuntime;
    this.analysisArtifactStore = analysisArtifactStore;
    this.logger = logger;
    this.service = new VerificationService(verificationConfig);
  }

  buildScopedTicket(ticket, decision) {
    return {
      ...ticket,
      productTarget: decision.product_target ?? ticket.productTarget ?? ticket.product_target ?? "unknown",
      repoTarget: decision.repo_target ?? ticket.repoTarget ?? ticket.repo_target ?? "UNKNOWN"
    };
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

  async loadAnalysisArtifacts() {
    const artifacts = await this.analysisArtifactStore?.list?.();
    return new Map((artifacts ?? []).map((artifact) => [artifact.ticketKey, artifact]));
  }

  buildClarificationQuestion(item, result, audit) {
    const triageTarget = [item.decision.product_target, item.decision.repo_target]
      .filter(Boolean)
      .join(" / ");
    const ticketTarget = [item.ticket.productTarget, item.ticket.repoTarget]
      .filter(Boolean)
      .join(" / ");
    const auditQuestions = normalizeList(audit?.questions)
      .map((question) => question.question)
      .filter(Boolean)
      .join(" ");

    return [
      `Please clarify ${item.ticket.key}: verification stopped with "${result.reason}".`,
      triageTarget ? `Triage target: ${triageTarget}.` : "",
      ticketTarget ? `Ticket target: ${ticketTarget}.` : "",
      auditQuestions ? `Audit questions: ${auditQuestions}` : "",
      "Confirm the correct target or provide the missing functional context needed to continue."
    ]
      .filter(Boolean)
      .join(" ");
  }

  buildBranchName(ticket) {
    return this.bitbucketAdapter.planBranch(ticket);
  }

  buildCommitMessage(ticket, analysis) {
    const summary = analysis?.proposedFix?.summary?.trim() || ticket.summary;
    const singleLineSummary = `${summary}`.replace(/\s+/g, " ").trim();
    return `feat(${ticket.key}): ${singleLineSummary}`;
  }

  buildPullRequestTitle(ticket, analysis) {
    const summary = analysis?.proposedFix?.summary?.trim() || ticket.summary;
    return `[${ticket.key}] ${`${summary}`.replace(/\s+/g, " ").trim()}`;
  }

  applyAnalysisToDecision(decision, analysis) {
    const nextStatus =
      analysis.status === "blocked"
        ? "blocked"
        : analysis.status === "needs_human" || analysis.feasibility === "feasible_low_confidence"
          ? "feasible_low_confidence"
          : analysis.feasibility === "not_feasible"
            ? "not_feasible"
            : "feasible";

    return {
      ...decision,
      product_target: analysis.productTarget || decision.product_target,
      repo_target: analysis.repoTarget || decision.repo_target,
      confidence: analysis.confidence ?? decision.confidence,
      status_decision: nextStatus,
      short_reason: analysis.summary || decision.short_reason,
      implementation_hint: [
        analysis.proposedFix?.summary,
        ...(analysis.proposedFix?.steps ?? []),
        decision.implementation_hint
      ]
        .filter(Boolean)
        .join(" | "),
      recheck_conditions: unique([
        ...(decision.recheck_conditions ?? []),
        ...normalizeList(analysis.questions).map((question) => `analysis:${question.reason || "question"}`)
      ])
    };
  }

  async refineAnalysis(item, analysis, audit, analysisPrompt) {
    if (!this.agentRuntime?.isPhaseEnabled("analysis")) {
      return null;
    }

    const refined = await this.agentRuntime.analyzeTicket({
      prompt: analysisPrompt,
      ticket: item.ticket,
      mapping: {
        productTarget: analysis.productTarget,
        repoTarget: analysis.repoTarget,
        area: analysis.area,
        feasibility: analysis.feasibility,
        confidence: analysis.confidence,
        implementationHint: analysis.proposedFix?.summary
      },
      previousAnalysis: analysis,
      auditFeedback: {
        summary: audit.summary,
        issues: audit.issues ?? [],
        refinementRequests: audit.refinementRequests ?? []
      },
      humanClarifications: item.ticket.humanClarifications ?? [],
      missingInformation: []
    });

    await this.analysisArtifactStore?.upsertArtifacts?.([
      {
        ticket: item.ticket,
        analysis: refined
      }
    ]);

    return refined;
  }

  async runAuditLoop(item, analysis, payload, prompts) {
    if (!this.agentRuntime?.isPhaseEnabled("audit")) {
      return {
        audit: null,
        analysis,
        decision: item.decision,
        refinementIterations: 0
      };
    }

    let currentAnalysis = analysis;
    let currentDecision = item.decision;
    let currentAudit = null;
    let refinementIterations = 0;
    const maxIterations = this.agentRuntime.config.audit.maxRefinementIterations;

    while (true) {
      currentAudit = await this.agentRuntime.auditProposal({
        prompt: prompts.audit,
        ticket: item.ticket,
        decision: currentDecision,
        proposal: currentAnalysis,
        executionPayload: payload,
        refinementIteration: refinementIterations
      });

      if (currentAudit.verdict !== "needs_refinement") {
        break;
      }

      if (refinementIterations >= maxIterations) {
        break;
      }

      const refinedAnalysis = await this.refineAnalysis(item, currentAnalysis, currentAudit, prompts.analysis);
      if (!refinedAnalysis) {
        break;
      }

      refinementIterations += 1;
      currentAnalysis = refinedAnalysis;
      currentDecision = this.applyAnalysisToDecision(currentDecision, refinedAnalysis);
    }

    return {
      audit: currentAudit,
      analysis: currentAnalysis,
      decision: currentDecision,
      refinementIterations
    };
  }

  async run(items) {
    if (!this.service.config.enabled) {
      return items.map((item) =>
        this.service.buildResult(item, "approved", "verification disabled by configuration")
      );
    }

    const prompts = {
      analysis: await loadPrompt("triage-agent.md"),
      audit: await loadPrompt("audit-agent.md")
    };
    const analysisByTicket = await this.loadAnalysisArtifacts();
    const results = [];

    for (const item of items) {
      const baseAnalysis = analysisByTicket.get(item.ticket.key) ?? this.buildFallbackAnalysis(item);
      const scopedTicket = this.buildScopedTicket(item.ticket, item.decision);
      const branchName = this.buildBranchName(scopedTicket);
      const commitMessage = this.buildCommitMessage(scopedTicket, baseAnalysis);
      const pullRequestTitle = this.buildPullRequestTitle(scopedTicket, baseAnalysis);
      const payload = {
        branchName,
        commitMessage,
        pullRequestTitle
      };

      const auditLoop = await this.runAuditLoop(item, baseAnalysis, payload, prompts);
      const refinedDecision = auditLoop.decision;
      const refinedAnalysis = auditLoop.analysis;
      let result = this.service.verify(
        {
          ...item,
          decision: refinedDecision,
          ticket: item.ticket
        },
        payload
      );
      result = this.service.applyAuditVerdict(
        {
          ...item,
          decision: refinedDecision,
          ticket: item.ticket
        },
        payload,
        result,
        auditLoop.audit,
        {
          refinementIterations: auditLoop.refinementIterations,
          refinedDecision,
          analysisArtifact: refinedAnalysis
        }
      );

      this.logger?.debug("Verification evaluated ticket", {
        ticketKey: result.ticketKey,
        status: result.status,
        auditVerdict: result.auditVerdict || "none"
      });

      if (
        this.interactionService?.shouldAskForVerification(result) &&
        this.interactionService.isEnabledForPhase("verification")
      ) {
        const interaction = await this.interactionService.requestClarification({
          phase: "verification",
          ticket: {
            ...scopedTicket,
            productTarget: refinedDecision.product_target,
            repoTarget: refinedDecision.repo_target
          },
          question: this.buildClarificationQuestion(item, result, auditLoop.audit),
          reason: result.reason,
          context: {
            productTarget: refinedDecision.product_target,
            repoTarget: refinedDecision.repo_target,
            confidence: refinedDecision.confidence,
            auditVerdict: result.auditVerdict,
            proposedFixSummary: refinedAnalysis?.proposedFix?.summary ?? ""
          }
        });

        if (interaction) {
          result = this.interactionService.enrichVerificationResult(result, interaction);
        }
      }

      results.push(result);
    }

    return results;
  }
}
