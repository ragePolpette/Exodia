export class LlmContextAdapter {
  constructor(options = {}) {
    this.options = options;
    this.kind = "mock";
  }

  async mapTicketToCodebase(ticket) {
    const mapping = ticket.contextMapping ?? {};
    const scope = mapping.scope ?? ticket.scope ?? "unknown";
    const inScope = mapping.inScope ?? scope === "BpoPilot";

    return {
      repoTarget: mapping.repoTarget ?? ticket.repoTarget ?? "BPOFH",
      area: mapping.area ?? scope,
      inScope,
      feasibility: mapping.feasibility ?? ticket.feasibility ?? "feasible",
      confidence: mapping.confidence ?? ticket.confidence ?? (inScope ? 0.82 : 0.12),
      hints: mapping.hints ?? [`Mock mapping for ${ticket.key}`],
      implementationHint:
        mapping.implementationHint ?? ticket.implementationHint ?? "Inspect mapped BpoPilot area",
      blockers: mapping.blockers ?? ticket.blockers ?? [],
      recheckConditions: mapping.recheckConditions ?? ticket.recheckConditions ?? []
    };
  }
}
