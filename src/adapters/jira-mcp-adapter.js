import { normalizeSupportTicket } from "../tickets/normalize-support-ticket.js";

export class McpJiraAdapter {
  constructor(options = {}) {
    this.options = options;
    this.client = options.client;
    this.kind = "mcp";
  }

  normalizeTicket(ticket) {
    return normalizeSupportTicket({
      key: ticket.key,
      projectKey: ticket.projectKey ?? ticket.project_key ?? ticket.project?.key ?? "UNKNOWN",
      summary: ticket.summary,
      description: ticket.description,
      productTarget: ticket.productTarget ?? ticket.product_target,
      scope: ticket.scope ?? "Unspecified",
      repoTarget: ticket.repoTarget ?? ticket.repo_target ?? "UNKNOWN",
      contextMapping: ticket.contextMapping ?? ticket.context_mapping,
      recheckConditions: ticket.recheckConditions ?? ticket.recheck_conditions ?? []
    });
  }

  async listOpenTickets() {
    const action = this.options.filterId ? "searchTicketsByFilter" : "searchTicketsByJql";
    const payload = this.options.filterId
      ? { filterId: this.options.filterId, cloudId: this.options.cloudId }
      : {
          jql: this.options.jql,
          cloudId: this.options.cloudId,
          maxResults: this.options.maxResults,
          responseContentFormat: this.options.responseContentFormat
        };
    const response = await this.client.request({
      server: this.options.server,
      action,
      payload
    });

    const tickets = Array.isArray(response?.tickets) ? response.tickets : response;
    return tickets.map((ticket) => this.normalizeTicket(ticket));
  }
}
