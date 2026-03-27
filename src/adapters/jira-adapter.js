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
}
