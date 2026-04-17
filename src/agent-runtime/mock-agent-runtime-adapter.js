import { AgentRuntimeAdapter } from "./agent-runtime-adapter.js";

function stringifyTicket(ticket = {}) {
  return `${ticket.key ?? "UNKNOWN"}: ${ticket.summary ?? "No summary"}`.trim();
}

export class MockAgentRuntimeAdapter extends AgentRuntimeAdapter {
  async invoke(phase, input = {}) {
    switch (phase) {
      case "analysis":
        return this.buildAnalysisResult(input);
      case "audit":
        return this.buildAuditResult(input);
      case "implementation":
        return this.buildImplementationResult(input);
      default:
        throw new Error(`Unsupported mock agent runtime phase: ${phase}`);
    }
  }

  buildAnalysisResult(input = {}) {
    const ticket = input.ticket ?? {};
    const mapping = input.mapping ?? {};
    const productTarget = mapping.productTarget ?? ticket.productTarget ?? "unknown";
    const repoTarget = mapping.repoTarget ?? ticket.repoTarget ?? "UNKNOWN";
    const area = mapping.area ?? productTarget;
    const confidence = mapping.confidence ?? ticket.confidence ?? 0.78;
    const needsHuman = Array.isArray(input.missingInformation) && input.missingInformation.length > 0;

    return {
      status: needsHuman ? "needs_human" : "proposal_ready",
      summary: `Mock analysis prepared for ${stringifyTicket(ticket)}`,
      feasibility: mapping.feasibility ?? ticket.feasibility ?? "feasible",
      confidence,
      productTarget,
      repoTarget,
      area,
      proposedFix: {
        summary: `Inspect ${repoTarget} for the failing scenario reported in ${ticket.key ?? "UNKNOWN"}.`,
        steps: [
          `Reproduce ${ticket.key ?? "UNKNOWN"} in the mapped area ${area}.`,
          `Implement the minimal change in ${repoTarget}.`
        ],
        risks: ["Mock runtime proposal only; no provider-specific reasoning yet."],
        assumptions: ["Ticket context is sufficient for an initial plan."]
      },
      verificationPlan: {
        summary: `Run focused verification for ${ticket.key ?? "UNKNOWN"}.`,
        checks: ["Run targeted build/test commands for the mapped area."],
        successCriteria: ["The reported scenario no longer reproduces."],
        maxVerificationLoops: this.config.implementation.maxVerificationLoops
      },
      questions: needsHuman
        ? input.missingInformation.map((item) => ({
            reason: "missing_information",
            question: `${item}`,
            blocking: true
          }))
        : []
    };
  }

  buildAuditResult(input = {}) {
    const proposal = input.proposal ?? input.analysisProposal ?? {};
    const needsRefinement =
      proposal.status === "needs_human" ||
      proposal.feasibility === "feasible_low_confidence" ||
      (proposal.questions?.length ?? 0) > 0;

    return {
      verdict: needsRefinement ? "needs_refinement" : "approved",
      summary: needsRefinement
        ? "Mock audit requires refinement before implementation."
        : "Mock audit approves the proposed fix plan.",
      confidence: needsRefinement ? 0.64 : 0.82,
      issues: needsRefinement ? ["Clarify missing information or reduce plan ambiguity."] : [],
      refinementRequests: needsRefinement ? ["Tighten the proposal and verification plan."] : [],
      questions: []
    };
  }

  buildImplementationResult(input = {}) {
    return {
      status: "blocked",
      summary: "Mock implementation runtime does not edit code. Switch to a live provider before enabling implementation.",
      branchName: `${input.branchName ?? ""}`.trim(),
      changedFiles: [],
      verificationResults: [],
      questions: [],
      followUp: ["Use codex-cli or openai provider for implementation."]
    };
  }
}
