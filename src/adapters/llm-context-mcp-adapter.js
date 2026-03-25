function defaultRepoTarget(productTarget) {
  switch (productTarget) {
    case "legacy":
      return "api+asp";
    case "fatturhello":
      return "pubblico";
    case "fiscobot":
      return "pubblico+bpofh+fiscobot";
    default:
      return "UNKNOWN";
  }
}

export class McpLlmContextAdapter {
  constructor(options = {}) {
    this.options = options;
    this.client = options.client;
    this.kind = "mcp";
  }

  async mapTicketToCodebase(ticket) {
    const response = await this.client.request({
      server: this.options.server,
      action: "mapTicketToCodebase",
      payload: {
        workspaceRoot: this.options.workspaceRoot,
        projectId: this.options.projectId,
        topK: this.options.topK,
        ticket
      }
    });

    const productTarget =
      response.productTarget ?? response.product_target ?? ticket.productTarget ?? ticket.product_target ?? "unknown";

    return {
      productTarget,
      repoTarget: response.repoTarget ?? response.repo_target ?? ticket.repoTarget ?? defaultRepoTarget(productTarget),
      area: response.area ?? response.scope ?? "unknown",
      inScope: response.inScope ?? response.in_scope ?? productTarget !== "unknown",
      feasibility: response.feasibility ?? "feasible",
      confidence: response.confidence ?? 0.5,
      hints: response.hints ?? [],
      implementationHint: response.implementationHint ?? response.implementation_hint ?? "",
      blockers: response.blockers ?? [],
      recheckConditions: response.recheckConditions ?? response.recheck_conditions ?? []
    };
  }
}
