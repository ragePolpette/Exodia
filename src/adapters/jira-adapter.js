import { normalizeSupportTicket } from "../tickets/normalize-support-ticket.js";

export class JiraAdapter {
  constructor({ tickets = [], targeting } = {}) {
    this.tickets = tickets;
    this.targeting = targeting;
    this.kind = "mock";
  }

  async listOpenTickets() {
    return this.tickets.map((ticket) =>
      normalizeSupportTicket(
        {
          ...ticket,
          productTarget: ticket.productTarget ?? ticket.product_target,
          recheckConditions: ticket.recheckConditions ?? [],
          contextMapping: ticket.contextMapping ?? undefined
        },
        { targeting: this.targeting }
      )
    );
  }

  async postInteractionQuestion(ticket, interaction, body) {
    return {
      commentId: `mock-comment-${interaction.id}`,
      body,
      sentAt: new Date().toISOString(),
      ticketKey: ticket.key
    };
  }

  async listInteractionResponses(ticket, interaction) {
    return (ticket.interactionResponses ?? [])
      .filter((response) => !response.interactionId || response.interactionId === interaction.id)
      .map((response, index) => ({
        source: "ticket",
        text: response.text ?? response.body ?? "",
        author: response.author ?? "mock-user",
        respondedAt:
          response.respondedAt ?? response.createdAt ?? response.created ?? new Date().toISOString(),
        externalId: response.externalId ?? response.id ?? `mock-ticket-response-${interaction.id}-${index + 1}`
      }));
  }
}
