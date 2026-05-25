import { normalizeInteractionResponse } from "./interaction-contracts.js";

function extractItems(response) {
  if (Array.isArray(response)) {
    return response;
  }

  return response?.responses ?? response?.messages ?? response?.items ?? response?.comments ?? [];
}

function parseSlackPostResult(response = {}, fallbackChannel = "") {
  return {
    channel: `${response.channel ?? response.channelId ?? fallbackChannel ?? ""}`.trim(),
    messageTs: `${response.messageTs ?? response.ts ?? response.id ?? ""}`.trim(),
    threadTs: `${response.threadTs ?? response.thread_id ?? response.messageTs ?? response.ts ?? ""}`.trim(),
    sentAt: new Date().toISOString()
  };
}

export class SlackMcpTransport {
  constructor({ client, config = {}, logger }) {
    this.client = client;
    this.config = config;
    this.logger = logger;
  }

  isConfigured() {
    return Boolean(
      this.client &&
        this.config.enabled !== false &&
        this.config.server &&
        this.config.postAction
    );
  }

  resolveChannel(phase) {
    return this.config.channelsByPhase?.[phase] ?? this.config.channel ?? "";
  }

  async sendQuestion({ interaction, ticket, text }) {
    if (!this.isConfigured()) {
      return null;
    }

    const channel = this.resolveChannel(interaction.phase);
    if (!channel) {
      return null;
    }

    const response = await this.client.request({
      server: this.config.server,
      action: this.config.postAction,
      payload: {
        channel,
        text,
        ticketKey: ticket.key,
        interactionId: interaction.id,
        phase: interaction.phase,
        metadata: {
          ticketKey: ticket.key,
          projectKey: ticket.projectKey,
          interactionId: interaction.id,
          phase: interaction.phase
        }
      }
    });

    return parseSlackPostResult(response, channel);
  }

  async collectResponses(interaction) {
    if (!this.isConfigured() || !this.config.collectRepliesAction) {
      return [];
    }

    const slackState = interaction.transportState?.slack;
    if (!slackState?.channel) {
      return [];
    }

    const response = await this.client.request({
      server: this.config.server,
      action: this.config.collectRepliesAction,
      payload: {
        channel: slackState.channel,
        threadTs: slackState.threadTs,
        messageTs: slackState.messageTs,
        interactionId: interaction.id,
        ticketKey: interaction.ticketKey,
        since: slackState.sentAt ?? interaction.createdAt
      }
    });

    return extractItems(response)
      .map((item) => normalizeInteractionResponse(item, "slack"))
      .filter((item) => item.text);
  }
}
