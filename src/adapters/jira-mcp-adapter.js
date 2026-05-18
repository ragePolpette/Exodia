import { normalizeSupportTicket } from "../tickets/normalize-support-ticket.js";
import { buildPullRequestTicketComment } from "../tickets/pull-request-comment.js";

export class McpJiraAdapter {
  constructor(options = {}) {
    this.options = options;
    this.client = options.client;
    this.kind = "mcp";
  }

  normalizeTicket(ticket) {
    return normalizeSupportTicket(
      {
        key: ticket.key,
        projectKey: ticket.projectKey ?? ticket.project_key ?? ticket.project?.key ?? "UNKNOWN",
        summary: ticket.summary,
        description: ticket.description,
        issueType: ticket.issueType ?? ticket.issue_type ?? ticket.issuetype ?? ticket.type,
        productTarget: ticket.productTarget ?? ticket.product_target,
        scope: ticket.scope ?? "Unspecified",
        repoTarget: ticket.repoTarget ?? ticket.repo_target ?? "UNKNOWN",
        contextMapping: ticket.contextMapping ?? ticket.context_mapping,
        recheckConditions: ticket.recheckConditions ?? ticket.recheck_conditions ?? []
      },
      { targeting: this.options.targeting }
    );
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

  async postInteractionQuestion(ticket, interaction, body) {
    const response = await this.client.request({
      server: this.options.server,
      action: "addTicketComment",
      payload: {
        cloudId: this.options.cloudId,
        ticketKey: ticket.key,
        body,
        interactionId: interaction.id
      }
    });

    return {
      commentId: `${response?.commentId ?? response?.id ?? ""}`.trim(),
      sentAt: `${response?.createdAt ?? new Date().toISOString()}`.trim(),
      ticketKey: ticket.key
    };
  }

  async listInteractionResponses(ticket, interaction) {
    const response = await this.client.request({
      server: this.options.server,
      action: "listTicketComments",
      payload: {
        cloudId: this.options.cloudId,
        ticketKey: ticket.key,
        interactionId: interaction.id
      }
    });

    return (response?.comments ?? []).map((comment) => ({
      source: "ticket",
      text: comment.text ?? comment.body ?? "",
      author: comment.author ?? "",
      respondedAt: comment.respondedAt ?? comment.createdAt ?? comment.created ?? "",
      externalId: comment.externalId ?? comment.id ?? comment.commentId ?? ""
    }));
  }

  async postPullRequestComment(ticket, pullRequest, context = {}) {
    const body = buildPullRequestTicketComment(ticket, pullRequest, context);
    const response = await this.client.request({
      server: this.options.server,
      action: "addTicketComment",
      payload: {
        cloudId: this.options.cloudId,
        ticketKey: ticket.key,
        body,
        pullRequestUrl: pullRequest?.link ?? pullRequest?.url ?? "",
        pullRequestId: pullRequest?.id ?? pullRequest?.number ?? ""
      }
    });

    return {
      commentId: `${response?.commentId ?? response?.id ?? ""}`.trim(),
      body,
      sentAt: `${response?.createdAt ?? new Date().toISOString()}`.trim(),
      ticketKey: ticket.key
    };
  }
}
