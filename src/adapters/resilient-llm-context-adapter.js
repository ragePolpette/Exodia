import { LlmContextAdapter } from "./llm-context-adapter.js";

export class ResilientLlmContextAdapter {
  constructor({ primaryAdapter, fallbackAdapter, logger } = {}) {
    this.primaryAdapter = primaryAdapter;
    this.fallbackAdapter = fallbackAdapter ?? new LlmContextAdapter();
    this.logger = logger;
    this.kind = primaryAdapter?.kind ?? "mcp";
  }

  async mapTicketToCodebase(ticket) {
    try {
      return await this.primaryAdapter.mapTicketToCodebase(ticket);
    } catch (error) {
      this.logger?.warn("llm-context unavailable, using local fallback mapping", {
        ticketKey: ticket.key,
        error: error.message
      });

      return this.fallbackAdapter.mapTicketToCodebase(ticket);
    }
  }
}