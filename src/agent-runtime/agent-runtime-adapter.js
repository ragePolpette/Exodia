import {
  assertAgentRuntimePhase,
  normalizeAgentRuntimeConfig,
  normalizeAnalysisResult,
  normalizeAuditResult,
  normalizeImplementationVerificationResult,
  normalizeImplementationResult
} from "./agent-runtime-contracts.js";
import { buildImplementationFailureFromError } from "./runtime-diagnostics.js";

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

  async verifyImplementation(input) {
    return this.execute("implementation_verification", input, normalizeImplementationVerificationResult);
  }

  async execute(phase, input, normalizer) {
    if (!this.isPhaseEnabled(phase)) {
      throw new Error(`Agent runtime phase is disabled: ${phase}`);
    }

    let rawResult;
    try {
      rawResult = await this.invoke(phase, input);
    } catch (error) {
      if (phase !== "implementation") {
        throw error;
      }

      rawResult = buildImplementationFailureFromError(error, this.getMetadata(phase));
      this.logger?.warn("Agent runtime implementation failed with structured diagnostics", {
        provider: this.provider,
        model: this.model,
        failureKind: rawResult.failureKind,
        code: rawResult.runtimeDiagnostics?.code,
        message: rawResult.summary
      });
    }
    return normalizer(rawResult, this.getMetadata(phase), this.config);
  }

  async invoke(_phase, _input) {
    throw new Error(`Agent runtime provider ${this.provider} must implement invoke()`);
  }
}
