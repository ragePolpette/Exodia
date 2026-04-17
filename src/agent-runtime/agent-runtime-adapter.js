import {
  assertAgentRuntimePhase,
  normalizeAgentRuntimeConfig,
  normalizeAnalysisResult,
  normalizeAuditResult,
  normalizeImplementationResult
} from "./agent-runtime-contracts.js";

export class AgentRuntimeAdapter {
  constructor(config = {}, { logger } = {}) {
    this.config = normalizeAgentRuntimeConfig(config);
    this.logger = logger;
    this.kind = this.config.provider;
    this.provider = this.config.provider;
    this.model = this.resolveModel();
    this.capabilities = this.config.capabilities;
  }

  resolveModel() {
    return this.getProviderConfig().model ?? this.config.model ?? "";
  }

  getProviderConfig() {
    return this.config.providers?.[this.provider] ?? {};
  }

  isEnabled() {
    return this.config.enabled !== false;
  }

  isPhaseEnabled(phase) {
    assertAgentRuntimePhase(phase);
    return this.isEnabled() && this.config.enabledPhases.includes(phase);
  }

  getMetadata(phase) {
    return {
      phase,
      provider: this.provider,
      model: this.model
    };
  }

  async analyzeTicket(input) {
    return this.execute("analysis", input, normalizeAnalysisResult);
  }

  async auditProposal(input) {
    return this.execute("audit", input, normalizeAuditResult);
  }

  async implementPlan(input) {
    return this.execute("implementation", input, normalizeImplementationResult);
  }

  async execute(phase, input, normalizer) {
    if (!this.isPhaseEnabled(phase)) {
      throw new Error(`Agent runtime phase is disabled: ${phase}`);
    }

    const rawResult = await this.invoke(phase, input);
    return normalizer(rawResult, this.getMetadata(phase), this.config);
  }

  async invoke(_phase, _input) {
    throw new Error(`Agent runtime provider ${this.provider} must implement invoke()`);
  }
}
