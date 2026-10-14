import { resolveTargetingConfig } from "./target-rules.js";

const unknownRepoTarget = "UNKNOWN";
const feasibilityRank = {
  blocked: 0,
  not_feasible: 0,
  feasible_low_confidence: 1,
  feasible: 2
};

function normalizeValues(values = []) {
  return (Array.isArray(values) ? values : [])
    .map((value) => `${value ?? ""}`.trim())
    .filter(Boolean);
}

export function buildTargetPolicy(config = {}) {
  const targeting = resolveTargetingConfig(config.targeting ?? {});
  const repoPrefixes = config.verification?.allowedPathPrefixesByRepo ?? {};
  return {
    unknownProductTarget: targeting.unknownTarget,
    products: new Set(targeting.rules.map((rule) => rule.target).filter(Boolean)),
    repos: new Set([
      ...targeting.rules.map((rule) => rule.repoTarget).filter((value) => value && value !== unknownRepoTarget),
      ...Object.keys(repoPrefixes).filter((key) => key !== "default"),
      ...normalizeValues(config.execution?.allowedRepositories)
    ])
  };
}

export function isAllowedProductTarget(policy, value) {
  const normalized = `${value ?? ""}`.trim();
  return !normalized || normalized === policy.unknownProductTarget || policy.products.has(normalized);
}

export function isAllowedRepoTarget(policy, value) {
  const normalized = `${value ?? ""}`.trim();
  return !normalized || normalized === unknownRepoTarget || policy.repos.has(normalized);
}

export function collectTargetViolations(policy, { productTarget, repoTarget } = {}, source = "input") {
  const violations = [];
  if (!isAllowedProductTarget(policy, productTarget)) {
    violations.push(`product target "${productTarget}" from ${source} is not a configured targeting rule`);
  }

  if (!isAllowedRepoTarget(policy, repoTarget)) {
    violations.push(`repository target "${repoTarget}" from ${source} is not a configured repository`);
  }

  return violations;
}

export function capAgentConfidence(agentConfidence, heuristicConfidence) {
  const agent = Number(agentConfidence);
  const heuristic = Number(heuristicConfidence);
  if (!Number.isFinite(heuristic)) {
    return Number.isFinite(agent) ? agent : heuristicConfidence;
  }

  return Number.isFinite(agent) ? Math.min(agent, heuristic) : heuristic;
}

export function mostConservativeFeasibility(heuristicFeasibility, agentFeasibility) {
  if (!agentFeasibility) {
    return heuristicFeasibility;
  }

  if (!heuristicFeasibility) {
    return agentFeasibility;
  }

  const heuristicRank = feasibilityRank[heuristicFeasibility] ?? 2;
  const agentRank = feasibilityRank[agentFeasibility] ?? 2;
  return agentRank < heuristicRank ? agentFeasibility : heuristicFeasibility;
}
