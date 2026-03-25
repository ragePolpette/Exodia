import { normalizeSupportTicket } from "../tickets/normalize-support-ticket.js";

export class JiraAdapter {
  constructor({ tickets = [] } = {}) {
    this.tickets = tickets;
    this.kind = "mock";
  }

  async listOpenTickets() {
    return this.tickets.map((ticket) =>
      normalizeSupportTicket({
        ...ticket,
      productTarget: ticket.productTarget ?? ticket.product_target,
      recheckConditions: ticket.recheckConditions ?? [],
      contextMapping: ticket.contextMapping ?? undefined
      })
    );
  }
}
