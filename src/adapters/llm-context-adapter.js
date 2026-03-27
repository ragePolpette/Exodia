import {
  defaultUnknownTarget,
  inferTargetFromProjectKey,
  inferTargetFromScope,
  inferTargetFromTextFragments,
  resolveMappingDefaults
} from "../targeting/target-rules.js";

function inferProductTarget(ticket, mapping = {}, targeting) {
  const explicit = mapping.productTarget ?? mapping.product_target ?? ticket.productTarget ?? ticket.product_target;
  if (explicit) {
    return explicit;
  }

  const scopeTarget = inferTargetFromScope(mapping.scope ?? ticket.scope, targeting);
  if (scopeTarget) {
    return scopeTarget;
  }

  const textTarget = inferTargetFromTextFragments(
    [ticket.summary, ticket.description, mapping.area, mapping.hint, ...(ticket.labels ?? [])],
    targeting
  );
  if (textTarget) {
    return textTarget;
  }

  return (
    inferTargetFromProjectKey(ticket.projectKey ?? ticket.key?.split("-")?.[0], targeting) ||
    defaultUnknownTarget(targeting)
  );
}

export class LlmContextAdapter {
  constructor(options = {}) {
    this.options = options;
    this.kind = "mock";
  }

  async mapTicketToCodebase(ticket) {
    const mapping = ticket.contextMapping ?? {};
    const scope = mapping.scope ?? ticket.scope ?? "unknown";
    const productTarget = inferProductTarget(ticket, mapping, this.options.targeting);
    const unknownTarget = defaultUnknownTarget(this.options.targeting);
    const defaults = resolveMappingDefaults(productTarget, this.options.targeting);
    const inferredScope = scope !== "unknown" ? scope : defaults.area;
    const inScope = mapping.inScope ?? defaults.inScope ?? productTarget !== unknownTarget;

    return {
      productTarget,
      repoTarget: mapping.repoTarget ?? ticket.repoTarget ?? defaults.repoTarget,
      area: mapping.area ?? inferredScope,
      inScope,
      feasibility: mapping.feasibility ?? ticket.feasibility ?? defaults.feasibility,
      confidence: mapping.confidence ?? ticket.confidence ?? (inScope ? 0.82 : 0.12),
      hints: mapping.hints ?? [`Mock mapping for ${ticket.key}`],
      implementationHint:
        mapping.implementationHint ??
        ticket.implementationHint ??
        defaults.implementationHint,
      blockers: mapping.blockers ?? ticket.blockers ?? [],
      recheckConditions: mapping.recheckConditions ?? ticket.recheckConditions ?? []
    };
  }
}
