import {
  defaultUnknownTarget,
  resolveMappingDefaults
} from "../targeting/target-rules.js";

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
        targeting: this.options.targeting,
        ticket
      }
    });

    const productTarget =
      response.productTarget ??
      response.product_target ??
      ticket.productTarget ??
      ticket.product_target ??
      defaultUnknownTarget(this.options.targeting);
    const defaults = resolveMappingDefaults(productTarget, this.options.targeting);

    return {
      productTarget,
      repoTarget: response.repoTarget ?? response.repo_target ?? ticket.repoTarget ?? defaults.repoTarget,
      area: response.area ?? response.scope ?? defaults.area,
      inScope:
        response.inScope ??
        response.in_scope ??
        defaults.inScope,
      feasibility: response.feasibility ?? defaults.feasibility,
      confidence: response.confidence ?? 0.5,
      hints: response.hints ?? [],
      implementationHint:
        response.implementationHint ??
        response.implementation_hint ??
        defaults.implementationHint,
      blockers: response.blockers ?? [],
      recheckConditions: response.recheckConditions ?? response.recheck_conditions ?? []
    };
  }
}
