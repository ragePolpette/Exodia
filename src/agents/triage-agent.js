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
    logger,
    securityConfig
  }) {
    this.contextAdapter = contextAdapter;
    this.ticketMemoryAdapter = ticketMemoryAdapter;
    this.semanticMemoryAdapter = semanticMemoryAdapter;
    this.sqlDbAdapter = sqlDbAdapter;
    this.interactionService = interactionService;
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

  shouldRequestClarification(ticket, decision) {
    if (!this.interactionService?.isEnabledForPhase("triage")) {
      return false;
    }

    if (ticket.interactionState?.status === "awaiting_response") {
      return false;
    }

    if (decision.status_decision === "feasible_low_confidence") {
      return true;
    }

    return (
      decision.status_decision === "blocked" &&
      (decision.product_target === "unknown" || decision.repo_target === "UNKNOWN")
    );
  }

  buildClarificationQuestion(ticket, mapping, decision) {
    const candidateTarget = [mapping.productTarget, mapping.repoTarget]
      .filter(Boolean)
      .join(" / ");
    const statusReason =
      decision.status_decision === "feasible_low_confidence"
        ? "the current mapping confidence is too low"
        : "the current mapping is blocked";

    return [
      `Please clarify ${ticket.key}: ${statusReason}.`,
      candidateTarget ? `Current best guess: ${candidateTarget}.` : "",
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
      const mapping = this.applyHumanClarifications(
        this.applyDiagnostics(
          await this.contextAdapter.mapTicketToCodebase(ticket),
          diagnostics
        ),
        ticket
      );
      let decision = this.service.evaluate(ticket, {
        prompt,
        mapping,
        memoryByTicket
      });

      if (this.shouldRequestClarification(ticket, decision)) {
        const interaction = await this.interactionService.requestClarification({
          phase: "triage",
          ticket,
          question: this.buildClarificationQuestion(ticket, mapping, decision),
          reason: decision.short_reason,
          context: {
            productTarget: decision.product_target,
            repoTarget: decision.repo_target,
            confidence: decision.confidence
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
