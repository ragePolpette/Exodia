import { loadPrompt } from "../prompts/load-prompt.js";
import { createMemoryRecord } from "../contracts/memory-record.js";
import { buildTriageInsight } from "../memory/semantic-insights.js";
import { TriageService } from "../triage/triage-service.js";

export class TriageAgent {
  constructor({ contextAdapter, ticketMemoryAdapter, semanticMemoryAdapter, sqlDbAdapter, logger, securityConfig }) {
    this.contextAdapter = contextAdapter;
    this.ticketMemoryAdapter = ticketMemoryAdapter;
    this.semanticMemoryAdapter = semanticMemoryAdapter;
    this.sqlDbAdapter = sqlDbAdapter;
    this.logger = logger;
    this.securityConfig = securityConfig;
    this.service = new TriageService();
  }

  async maybeRunDiagnostics(ticket) {
    const request = ticket.diagnostics?.triage;
    if (!request?.query && !request?.statement) {
      return null;
    }

    return this.sqlDbAdapter.runDiagnosticQuery({
      phase: "triage",
      ticketKey: ticket.key,
      ...request
    });
  }

  applyDiagnostics(mapping, diagnostics) {
    if (!diagnostics?.used) {
      return mapping;
    }

    const hints = [...(mapping.hints ?? [])];
    if (diagnostics.summary) {
      hints.push(`SQL diagnostic: ${diagnostics.summary}`);
    }

    return {
      ...mapping,
      hints,
      blockers: [...(mapping.blockers ?? []), ...(diagnostics.blockers ?? [])],
      implementationHint: [mapping.implementationHint, diagnostics.summary]
        .filter(Boolean)
        .join(" | ")
    };
  }

  async run(tickets) {
    const prompt = await loadPrompt("triage-agent.md");
    const existingMemory = await this.ticketMemoryAdapter.listRecords();
    const memoryByTicket = new Map(existingMemory.map((record) => [record.ticket_key, record]));
    const decisions = [];

    for (const ticket of tickets) {
      const diagnostics = await this.maybeRunDiagnostics(ticket);
      const mapping = this.applyDiagnostics(
        await this.contextAdapter.mapTicketToCodebase(ticket),
        diagnostics
      );
      const decision = this.service.evaluate(ticket, {
        prompt,
        mapping,
        memoryByTicket
      });
      decisions.push(decision);
      memoryByTicket.set(ticket.key, createMemoryRecord(decision));

      try {
        const insight = buildTriageInsight(ticket, mapping, decision, this.securityConfig?.redaction);
        if (insight) {
          await this.semanticMemoryAdapter?.captureTriageInsight?.(insight);
        }
      } catch (error) {
        this.logger?.debug("Semantic memory triage capture skipped", {
          ticketKey: ticket.key,
          error: error.message
        });
      }
    }

    await this.ticketMemoryAdapter.upsertRecords(decisions);

    return decisions;
  }
}
