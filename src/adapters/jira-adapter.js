export class JiraAdapter {
  constructor({ tickets = [] } = {}) {
    this.tickets = tickets;
    this.kind = "mock";
  }

  async listOpenTickets() {
    return this.tickets.map((ticket) => ({
      ...ticket,
      recheckConditions: ticket.recheckConditions ?? [],
      contextMapping: ticket.contextMapping ?? undefined
    }));
  }
}
