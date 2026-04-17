import { LlmMemoryAdapter } from "./llm-memory-adapter.js";

export class ResilientLlmMemoryAdapter {
  constructor({ primaryAdapter, fallbackAdapter, logger } = {}) {
    this.primaryAdapter = primaryAdapter;
    this.fallbackAdapter = fallbackAdapter ?? new LlmMemoryAdapter();
    this.logger = logger;
    this.kind = primaryAdapter?.kind ?? "mcp";
  }

  async captureTriageInsight(insight) {
    return this.captureWithFallback("triage", insight, () => this.primaryAdapter.captureTriageInsight(insight));
  }

  async captureExecutionInsight(insight) {
    return this.captureWithFallback("execution", insight, () => this.primaryAdapter.captureExecutionInsight(insight));
  }

  async captureInteractionInsight(insight) {
    return this.captureWithFallback("interaction", insight, () => this.primaryAdapter.captureInteractionInsight(insight));
  }

  async captureWithFallback(phase, insight, runPrimary) {
    try {
      return await runPrimary();
    } catch (error) {
      this.logger?.warn("llm-memory unavailable, skipping semantic capture", {
        phase,
        ticketKey: insight?.ticket_key ?? insight?.ticketKey ?? "",
        error: error.message
      });

      if (phase === "triage") {
        return this.fallbackAdapter.captureTriageInsight(insight);
      }

      if (phase === "execution") {
        return this.fallbackAdapter.captureExecutionInsight(insight);
      }

      return this.fallbackAdapter.captureInteractionInsight(insight);
    }
  }
}