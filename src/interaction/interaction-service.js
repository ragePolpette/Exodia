import {
  appendInteractionContext,
  buildInteractionMarkers,
  createInteractionRecord,
  deriveInteractionOverrides,
  mergeInteractionOverrides,
  normalizeInteractionDestinations,
  sortInteractionResponses,
  summarizeFunctionalInteractionResponse
} from "./interaction-contracts.js";
import { buildClarificationInsight } from "../memory/semantic-insights.js";
import { SlackMcpTransport } from "./slack-mcp-transport.js";

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function responseContainsQuestionMarker(interaction, response) {
  return `${response?.text ?? ""}`.includes(`[Interaction ${interaction.id}]`);
}

function isResponseAfter(sentAt, respondedAt) {
  const sentTimestamp = Date.parse(`${sentAt ?? ""}`);
  const responseTimestamp = Date.parse(`${respondedAt ?? ""}`);
  if (Number.isNaN(sentTimestamp) || Number.isNaN(responseTimestamp)) {
    return true;
  }

  return responseTimestamp >= sentTimestamp;
}

export class InteractionService {
  constructor({
    config = {},
    store,
    jiraAdapter,
    semanticMemoryAdapter,
    ticketMemoryAdapter,
    mcpClient,
    logger,
    securityConfig,
    targeting
  }) {
    this.config = config;
    this.store = store;
    this.jiraAdapter = jiraAdapter;
    this.semanticMemoryAdapter = semanticMemoryAdapter;
    this.ticketMemoryAdapter = ticketMemoryAdapter;
    this.logger = logger;
    this.securityConfig = securityConfig;
    this.targeting = targeting;
    this.slackTransport = new SlackMcpTransport({
      client: mcpClient,
      config: config.transports?.slack,
      logger
    });
  }

  isEnabledForPhase(phase) {
    if (!this.config.enabled) {
      return false;
    }

    const allowedPhases = Array.isArray(this.config.allowedPhases)
      ? this.config.allowedPhases
      : [];
    return allowedPhases.length === 0 || allowedPhases.includes(phase);
  }

  resolveDestinations() {
    return normalizeInteractionDestinations(this.config.destinations);
  }

  formatQuestionMessage(interaction, ticket) {
    const prefix = this.config.messagePrefix ?? "[Exodia]";
    return [
      `${prefix}[Interaction ${interaction.id}] Clarification required for ${ticket.key}`,
      `Phase: ${interaction.phase}`,
      `Question: ${interaction.question}`,
      interaction.reason ? `Why: ${interaction.reason}` : "",
      "Reply here or on the configured Slack thread. The first valid answer wins."
    ]
      .filter(Boolean)
      .join("\n");
  }

  async listPendingInteractions() {
    const records = await this.store.list();
    return records.filter((record) => record.status === "awaiting_response");
  }

  async requestClarification({ phase, ticket, question, reason, context = {} }) {
    if (!this.isEnabledForPhase(phase)) {
      return null;
    }

    const records = await this.store.list();
    const pendingForTicket = records.find(
      (record) => record.ticketKey === ticket.key && record.status === "awaiting_response"
    );
    if (pendingForTicket) {
      return pendingForTicket;
    }

    const questionCount = records.filter((record) => record.ticketKey === ticket.key).length;
    if (questionCount >= (this.config.maxQuestionsPerTicket ?? 1)) {
      this.logger?.warn("Interaction skipped because max questions per ticket was reached", {
        ticketKey: ticket.key,
        phase
      });
      return null;
    }

    const destinations = this.resolveDestinations();
    if (destinations.length === 0) {
      return null;
    }

    const interaction = createInteractionRecord({
      ticket,
      phase,
      question,
      reason,
      destinations,
      context
    });
    const message = this.formatQuestionMessage(interaction, ticket);
    const transportState = {};
    let delivered = 0;

    if (destinations.includes("ticket") && this.jiraAdapter?.postInteractionQuestion) {
      try {
        const ticketState = await this.jiraAdapter.postInteractionQuestion(ticket, interaction, message);
        if (ticketState) {
          transportState.ticket = ticketState;
          delivered += 1;
        }
      } catch (error) {
        this.logger?.warn("Ticket interaction delivery failed", {
          ticketKey: ticket.key,
          phase,
          error: error.message
        });
      }
    }

    if (destinations.includes("slack")) {
      try {
        const slackState = await this.slackTransport.sendQuestion({
          interaction,
          ticket,
          text: message
        });
        if (slackState) {
          transportState.slack = slackState;
          delivered += 1;
        }
      } catch (error) {
        this.logger?.warn("Slack interaction delivery failed", {
          ticketKey: ticket.key,
          phase,
          error: error.message
        });
      }
    }

    if (delivered === 0) {
      return null;
    }

    const stored = {
      ...interaction,
      transportState,
      updatedAt: new Date().toISOString()
    };
    await this.store.upsert([stored]);
    return stored;
  }

  async collectResponses(ticket, interaction) {
    const responses = [];

    if (interaction.destinations.includes("ticket") && this.jiraAdapter?.listInteractionResponses) {
      try {
        const ticketResponses = await this.jiraAdapter.listInteractionResponses(ticket, interaction);
        responses.push(...asArray(ticketResponses));
      } catch (error) {
        this.logger?.warn("Ticket interaction fetch failed", {
          ticketKey: ticket.key,
          interactionId: interaction.id,
          error: error.message
        });
      }
    }

    if (interaction.destinations.includes("slack")) {
      try {
        const slackResponses = await this.slackTransport.collectResponses(interaction);
        responses.push(...asArray(slackResponses));
      } catch (error) {
        this.logger?.warn("Slack interaction fetch failed", {
          ticketKey: ticket.key,
          interactionId: interaction.id,
          error: error.message
        });
      }
    }

    return responses
      .filter((response) => response.text)
      .filter((response) => !responseContainsQuestionMarker(interaction, response))
      .filter((response) => {
        const sentAt =
          interaction.transportState?.[response.source]?.sentAt ?? interaction.createdAt;
        return isResponseAfter(sentAt, response.respondedAt);
      });
  }

  async captureResolvedInteraction(ticket, interaction) {
    const summary = summarizeFunctionalInteractionResponse(interaction.response?.text);
    if (!summary) {
      return;
    }

    if (this.config.captureToSemanticMemory !== false) {
      try {
        const insight = buildClarificationInsight(
          ticket,
          interaction,
          summary,
          this.securityConfig?.redaction
        );
        if (insight) {
          await this.semanticMemoryAdapter?.captureInteractionInsight?.(insight);
        }
      } catch (error) {
        this.logger?.debug("Semantic memory interaction capture skipped", {
          ticketKey: ticket.key,
          interactionId: interaction.id,
          error: error.message
        });
      }
    }
  }

  applyResolvedInteraction(ticket, interaction) {
    const summary = summarizeFunctionalInteractionResponse(interaction.response?.text);
    const overrides = deriveInteractionOverrides(interaction.response?.text, this.targeting);
    const markers = buildInteractionMarkers(interaction.id);

    return {
      ...ticket,
      description: appendInteractionContext(ticket.description, interaction.phase, interaction.response),
      recheckConditions: unique([
        ...(ticket.recheckConditions ?? []),
        markers.answered
      ]),
      clarificationSummary: summary || ticket.clarificationSummary || "",
      humanClarifications: [
        ...(ticket.humanClarifications ?? []),
        {
          interactionId: interaction.id,
          phase: interaction.phase,
          source: interaction.response?.source ?? "human",
          summary,
          text: interaction.response?.text ?? "",
          respondedAt: interaction.response?.respondedAt ?? ""
        }
      ],
      humanInteractionOverrides: mergeInteractionOverrides(
        ticket.humanInteractionOverrides,
        overrides
      ),
      interactionState: {
        status: "resolved",
        interactionId: interaction.id,
        source: interaction.response?.source ?? "human"
      }
    };
  }

  buildPendingInteractionState(interaction) {
    return {
      status: "awaiting_response",
      interactionId: interaction.id,
      question: interaction.question,
      reason: interaction.reason,
      destinations: interaction.destinations
    };
  }

  async prepareTickets(tickets) {
    if (!this.config.enabled) {
      return {
        tickets,
        pending: [],
        resolved: []
      };
    }

    const records = await this.store.list();
    const byTicket = new Map(
      records
        .filter((record) => record.status === "awaiting_response")
        .map((record) => [record.ticketKey, record])
    );
    const updatedRecords = [];
    const pending = [];
    const resolved = [];
    const preparedTickets = [];

    for (const ticket of tickets) {
      const interaction = byTicket.get(ticket.key);
      if (!interaction) {
        preparedTickets.push(ticket);
        continue;
      }

      const responses = sortInteractionResponses(await this.collectResponses(ticket, interaction));
      if (responses.length === 0) {
        pending.push(interaction);
        preparedTickets.push({
          ...ticket,
          interactionState: this.buildPendingInteractionState(interaction)
        });
        continue;
      }

      const winner = responses[0];
      const answerSummary = summarizeFunctionalInteractionResponse(winner.text);
      const resolvedInteraction = {
        ...interaction,
        status: "resolved",
        updatedAt: new Date().toISOString(),
        resolvedAt: winner.respondedAt,
        response: winner,
        answerSummary
      };
      updatedRecords.push(resolvedInteraction);
      resolved.push(resolvedInteraction);
      await this.captureResolvedInteraction(ticket, resolvedInteraction);
      preparedTickets.push(this.applyResolvedInteraction(ticket, resolvedInteraction));
    }

    if (updatedRecords.length > 0) {
      await this.store.upsert(updatedRecords);
    }

    return {
      tickets: preparedTickets,
      pending,
      resolved
    };
  }

  buildAwaitingInputReason(interaction, fallbackReason) {
    const destinations = interaction.destinations?.join("+") || "configured channels";
    return [
      `awaiting human clarification (${interaction.id}) on ${destinations}`,
      fallbackReason
    ]
      .filter(Boolean)
      .join(": ");
  }

  shouldAskForVerification(result) {
    return result?.status === "needs_review";
  }

  enrichDecisionWithClarification(decision, ticket) {
    const summary = ticket.clarificationSummary;
    if (!summary || this.config.captureToTicketMemory === false) {
      return decision;
    }

    return {
      ...decision,
      clarification_summary: summary
    };
  }

  enrichVerificationResult(result, interaction) {
    return {
      ...result,
      reason: this.buildAwaitingInputReason(interaction, result.reason)
    };
  }
}
