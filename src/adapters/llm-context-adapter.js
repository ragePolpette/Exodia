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

function inferProductTarget(ticket, mapping = {}) {
  const explicit = mapping.productTarget ?? mapping.product_target ?? ticket.productTarget ?? ticket.product_target;
  if (explicit) {
    return explicit;
  }

  const scope = `${mapping.scope ?? ticket.scope ?? ""}`.toLowerCase();
  if (scope === "bpopilot") {
    return "legacy";
  }
  if (scope === "fatturhello" || scope === "yeti") {
    return "fatturhello";
  }
  if (scope === "fiscobot") {
    return "fiscobot";
  }

  const text = [ticket.summary, ticket.description, mapping.area, mapping.hint, ...(ticket.labels ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/\bfiscobot\b/.test(text)) {
    return "fiscobot";
  }
  if (/\bbpopilot\b|\bbpo\b/.test(text)) {
    return "legacy";
  }
  if (/\bfatturhello\b|\byeti\b/.test(text)) {
    return "fatturhello";
  }

  return "unknown";
}

export class LlmContextAdapter {
  constructor(options = {}) {
    this.options = options;
    this.kind = "mock";
  }

  async mapTicketToCodebase(ticket) {
    const mapping = ticket.contextMapping ?? {};
    const scope = mapping.scope ?? ticket.scope ?? "unknown";
    const productTarget = inferProductTarget(ticket, mapping);
    const inScope = mapping.inScope ?? productTarget !== "unknown";

    return {
      productTarget,
      repoTarget: mapping.repoTarget ?? ticket.repoTarget ?? defaultRepoTarget(productTarget),
      area: mapping.area ?? scope,
      inScope,
      feasibility: mapping.feasibility ?? ticket.feasibility ?? "feasible",
      confidence: mapping.confidence ?? ticket.confidence ?? (inScope ? 0.82 : 0.12),
      hints: mapping.hints ?? [`Mock mapping for ${ticket.key}`],
      implementationHint:
        mapping.implementationHint ?? ticket.implementationHint ?? `Inspect mapped ${productTarget} area`,
      blockers: mapping.blockers ?? ticket.blockers ?? [],
      recheckConditions: mapping.recheckConditions ?? ticket.recheckConditions ?? []
    };
  }
}