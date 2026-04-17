import { loadPrompt } from "../prompts/load-prompt.js";
import { createMemoryRecord } from "../contracts/memory-record.js";
import { buildTriageInsight } from "../memory/semantic-insights.js";
import { TriageService } from "../triage/triage-service.js";
import { buildInteractionMarkers } from "../interaction/interaction-contracts.js";

export class TriageAgent {
  constructor({
    contextAdapter,
    ticketMemoryAdapter,
    semanticMemoryAdapter,
    sqlDbAdapter,
    interactionService,
    agentRuntime,
    analysisArtifactStore,
    logger,
    securityConfig
  }) {
    this.contextAdapter = contextAdapter;
    this.ticketMemoryAdapter = ticketMemoryAdapter;
    this.semanticMemoryAdapter = semanticMemoryAdapter;
    this.sqlDbAdapter = sqlDbAdapter;
    this.interactionService = interactionService;
    this.agentRuntime = agentRuntime;
    this.analysisArtifactStore = analysisArtifactStore;
    this.logger = logger;
    this.securityConfig = securityConfig;
    this.service = new TriageService();
  }

  async maybeRunDiagnostics(ticket) {
    const request = ticket.diagnostics?.triage;
    if (!request?.query && !request?.statement) {
      return null;
    }

    return this.sqlDbAdapter.runDiagnosticQuery({
      phase: "triage",
      ticketKey: ticket.key,
      ...request
    });
  }

  applyDiagnostics(mapping, diagnostics) {
    if (!diagnostics?.used) {
      return mapping;
    }

    const hints = [...(mapping.hints ?? [])];
    if (diagnostics.summary) {
      hints.push(`SQL diagnostic: ${diagnostics.summary}`);
    }

    return {
      ...mapping,
      hints,
      blockers: [...(mapping.blockers ?? []), ...(diagnostics.blockers ?? [])],
      implementationHint: [mapping.implementationHint, diagnostics.summary]
        .filter(Boolean)
        .join(" | ")
    };
  }

  applyHumanClarifications(mapping, ticket) {
    const overrides = ticket.humanInteractionOverrides ?? {};
    const clarificationSummary = `${ticket.clarificationSummary ?? ""}`.trim();
    if (!overrides.productTarget && !overrides.repoTarget && !clarificationSummary) {
      return mapping;
    }

    return {
      ...mapping,
      productTarget: overrides.productTarget || mapping.productTarget,
      repoTarget: overrides.repoTarget || mapping.repoTarget,
      feasibility:
        clarificationSummary && mapping.feasibility === "feasible_low_confidence"
          ? "feasible"
          : mapping.feasibility,
      confidence: clarificationSummary
        ? Math.max(mapping.confidence ?? 0, 0.86)
        : mapping.confidence,
      blockers: clarificationSummary ? [] : mapping.blockers,
      implementationHint: [mapping.implementationHint, clarificationSummary]
        .filter(Boolean)
        .join(" | ")
    };
  }

  buildPendingDecision(ticket, interactionState) {
    const markers = buildInteractionMarkers(interactionState.interactionId);
    return {
      ticket_key: ticket.key,
      project_key: ticket.projectKey,
      product_target:
        ticket.productTarget ??
        ticket.product_target ??
        ticket.humanInteractionOverrides?.productTarget ??
        "unknown",
      repo_target:
        ticket.repoTarget ??
        ticket.repo_target ??
        ticket.humanInteractionOverrides?.repoTarget ??
        "UNKNOWN",
      status_decision: "blocked",
      confidence: 0.45,
      short_reason: this.interactionService.buildAwaitingInputReason(
        {
          id: interactionState.interactionId,
          destinations: interactionState.destinations ?? []
        },
        interactionState.reason || "awaiting human clarification"
      ),
      implementation_hint: interactionState.question ?? "",
      branch_name: "",
      pr_url: "",
      last_outcome: "awaiting_input",
      clarification_summary: ticket.clarificationSummary ?? "",
      recheck_conditions: [...(ticket.recheckConditions ?? []), markers.pending],
      execution_eligible: false
    };
  }

  collectMissingInformation(ticket, mapping) {
    const missing = [];

    if (!mapping.productTarget || mapping.productTarget === "unknown") {
      missing.push("Confirm the correct product target for this ticket.");
    }

    if (!mapping.repoTarget || mapping.repoTarget === "UNKNOWN") {
      missing.push("Confirm the correct repository target for this ticket.");
    }

    if (Array.isArray(ticket.missingInformation)) {
      missing.push(...ticket.missingInformation.filter(Boolean));
    }

    return [...new Set(missing)];
  }

  buildAnalysisInput(ticket, mapping, existingRecord, prompt) {
    return {
      prompt,
      ticket,
      mapping,
      memory: {
        existingRecord: existingRecord ?? null
      },
      humanClarifications: ticket.humanClarifications ?? [],
      missingInformation: this.collectMissingInformation(ticket, mapping)
    };
  }

  async analyzeTicket(ticket, mapping, existingRecord, prompt) {
    if (!this.agentRuntime?.isPhaseEnabled("analysis")) {
      return null;
    }

    try {
      const analysis = await this.agentRuntime.analyzeTicket(
        this.buildAnalysisInput(ticket, mapping, existingRecord, prompt)
      );

      await this.analysisArtifactStore?.upsertArtifacts([
        {
          ticket,
          analysis
        }
      ]);

      this.logger?.debug("Agent runtime analysis completed", {
        ticketKey: ticket.key,
        provider: analysis.provider,
        status: analysis.status
      });

      return analysis;
    } catch (error) {
      this.logger?.warn("Agent runtime analysis failed", {
        ticketKey: ticket.key,
        provider: this.agentRuntime.provider,
        error: error.message
      });

      if (this.agentRuntime.config.fallbackToHeuristics !== false) {
        return null;
      }

      throw error;
    }
  }

  applyAgentAnalysis(mapping, analysis) {
    if (!analysis) {
      return mapping;
    }

    const hints = [...(mapping.hints ?? [])];
    if (analysis.summary) {
      hints.push(`Agent analysis: ${analysis.summary}`);
    }
    if (analysis.proposedFix?.summary) {
      hints.push(`Fix plan: ${analysis.proposedFix.summary}`);
    }

    const blockers = [...(mapping.blockers ?? [])];
    let feasibility = analysis.feasibility || mapping.feasibility;

    if (analysis.status === "blocked") {
      feasibility = "blocked";
      if (analysis.summary) {
        blockers.push(analysis.summary);
      }
    }

    if (analysis.status === "needs_human" && feasibility === "feasible") {
      feasibility = "feasible_low_confidence";
    }

    return {
      ...mapping,
      productTarget: analysis.productTarget || mapping.productTarget,
      repoTarget: analysis.repoTarget || mapping.repoTarget,
      area: analysis.area || mapping.area,
      feasibility,
      confidence: analysis.confidence ?? mapping.confidence,
      implementationHint: [
        analysis.proposedFix?.summary,
        analysis.proposedFix?.steps?.[0],
        mapping.implementationHint
      ]
        .filter(Boolean)
        .join(" | "),
      hints,
      blockers,
      verificationPlan: analysis.verificationPlan
    };
  }

  shouldRequestClarification(ticket, decision, analysis) {
    if (!this.interactionService?.isEnabledForPhase("triage")) {
      return false;
    }

    if (ticket.interactionState?.status === "awaiting_response") {
      return false;
    }

    if (analysis?.status === "needs_human" || (analysis?.questions?.length ?? 0) > 0) {
      return true;
    }

    if (decision.status_decision === "feasible_low_confidence") {
      return true;
    }

    return (
      decision.status_decision === "blocked" &&
      (decision.product_target === "unknown" || decision.repo_target === "UNKNOWN")
    );
  }

  buildClarificationQuestion(ticket, mapping, decision, analysis) {
    const candidateTarget = [mapping.productTarget, mapping.repoTarget]
      .filter(Boolean)
      .join(" / ");
    const statusReason =
      analysis?.status === "needs_human"
        ? "the analysis agent needs more information"
        : decision.status_decision === "feasible_low_confidence"
          ? "the current mapping confidence is too low"
          : "the current mapping is blocked";
    const explicitQuestions = (analysis?.questions ?? [])
      .map((question) => question.question)
      .filter(Boolean);

    return [
      `Please clarify ${ticket.key}: ${statusReason}.`,
      candidateTarget ? `Current best guess: ${candidateTarget}.` : "",
      explicitQuestions.length > 0 ? `Questions: ${explicitQuestions.join(" ")}` : "",
      "Confirm the correct product target, repository target, and any missing functional detail needed to continue."
    ]
      .filter(Boolean)
      .join(" ");
  }

  async run(tickets) {
    const prompt = await loadPrompt("triage-agent.md");
    const existingMemory = await this.ticketMemoryAdapter.listRecords();
    const memoryByTicket = new Map(existingMemory.map((record) => [record.ticket_key, record]));
    const decisions = [];

    for (const ticket of tickets) {
      if (ticket.interactionState?.status === "awaiting_response") {
        const decision = this.buildPendingDecision(ticket, ticket.interactionState);
        decisions.push(decision);
        memoryByTicket.set(ticket.key, createMemoryRecord(decision));
        continue;
      }

      const diagnostics = await this.maybeRunDiagnostics(ticket);
      const baselineMapping = this.applyHumanClarifications(
        this.applyDiagnostics(
          await this.contextAdapter.mapTicketToCodebase(ticket),
          diagnostics
        ),
        ticket
      );
      const analysis = await this.analyzeTicket(
        ticket,
        baselineMapping,
        memoryByTicket.get(ticket.key),
        prompt
      );
      const mapping = this.applyAgentAnalysis(baselineMapping, analysis);
      let decision = this.service.evaluate(ticket, {
        prompt,
        mapping,
        memoryByTicket
      });

      if (this.shouldRequestClarification(ticket, decision, analysis)) {
        const interaction = await this.interactionService.requestClarification({
          phase: "triage",
          ticket,
          question: this.buildClarificationQuestion(ticket, mapping, decision, analysis),
          reason: decision.short_reason,
          context: {
            productTarget: decision.product_target,
            repoTarget: decision.repo_target,
            confidence: decision.confidence,
            proposedFixSummary: analysis?.proposedFix?.summary ?? ""
          }
        });

        if (interaction) {
          const markers = buildInteractionMarkers(interaction.id);
          decision = {
            ...decision,
            status_decision: "blocked",
            short_reason: this.interactionService.buildAwaitingInputReason(
              interaction,
              decision.short_reason
            ),
            implementation_hint: interaction.question,
            last_outcome: "awaiting_input",
            recheck_conditions: [...(decision.recheck_conditions ?? []), markers.pending],
            execution_eligible: false
          };
        }
      }

      decision = this.interactionService?.enrichDecisionWithClarification(decision, ticket) ?? decision;
      decisions.push(decision);
      memoryByTicket.set(ticket.key, createMemoryRecord(decision));

      try {
        const insight = buildTriageInsight(ticket, mapping, decision, this.securityConfig?.redaction);
        if (insight) {
          await this.semanticMemoryAdapter?.captureTriageInsight?.(insight);
        }
      } catch (error) {
        this.logger?.debug("Semantic memory triage capture skipped", {
          ticketKey: ticket.key,
          error: error.message
        });
      }
    }

    await this.ticketMemoryAdapter.upsertRecords(decisions);

    return decisions;
  }
}
