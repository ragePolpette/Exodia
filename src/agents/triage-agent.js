import { loadPrompt } from "../prompts/load-prompt.js";
import { createMemoryRecord } from "../contracts/memory-record.js";
import { TriageService } from "../triage/triage-service.js";

export class TriageAgent {
  constructor({ contextAdapter, memoryAdapter }) {
    this.contextAdapter = contextAdapter;
    this.memoryAdapter = memoryAdapter;
    this.service = new TriageService();
  }

  async run(tickets) {
    const prompt = await loadPrompt("triage-agent.md");
    const existingMemory = await this.memoryAdapter.listRecords();
    const memoryByTicket = new Map(existingMemory.map((record) => [record.ticket_key, record]));
    const decisions = [];

    for (const ticket of tickets) {
      const mapping = await this.contextAdapter.mapTicketToCodebase(ticket);
      const decision = this.service.evaluate(ticket, {
        prompt,
        mapping,
        memoryByTicket
      });
      decisions.push(decision);
      memoryByTicket.set(ticket.key, createMemoryRecord(decision));
    }

    await this.memoryAdapter.upsertRecords(decisions);

    return decisions;
  }
}
