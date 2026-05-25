const defaultTargetingConfig = {
  unknownTarget: "unknown",
  rules: [
    {
      target: "legacy",
      repoTarget: "core-app",
      aliases: ["legacy-suite", "legacy suite", "core-backoffice", "core backoffice"],
      scopeAliases: ["coreapp"],
      projectKeys: ["GEN"]
    },
    {
      target: "public-app",
      repoTarget: "public-web",
      aliases: [
        "public-app",
        "public app",
        "public portal",
        "portal-web",
        "portal web",
        "customer-portal",
        "customer portal",
        "public-web",
        "web-app"
      ],
      scopeAliases: ["publicapp", "portalweb"],
      projectKeys: ["WEB"]
    },
    {
      target: "automation-bot",
      repoTarget: "automation-suite",
      aliases: ["automation-bot", "workflow-bot", "workflow bot", "rule-engine", "rule engine"],
      scopeAliases: ["automation", "automationbot"],
      projectKeys: ["BOT"]
    }
  ]
};

function normalizeList(values, mapper = (value) => `${value ?? ""}`.trim()) {
  return [...new Set((values ?? []).map(mapper).filter(Boolean))];
}

function normalizeRule(rule = {}) {
  return {
    target: `${rule.target ?? ""}`.trim(),
    repoTarget: `${rule.repoTarget ?? "UNKNOWN"}`.trim() || "UNKNOWN",
    area: `${rule.area ?? rule.target ?? "unknown"}`.trim() || "unknown",
    inScope: rule.inScope ?? true,
    feasibility: `${rule.feasibility ?? "feasible"}`.trim() || "feasible",
    implementationHint: `${rule.implementationHint ?? ""}`.trim(),
    aliases: normalizeList(rule.aliases, (value) => `${value ?? ""}`.trim().toLowerCase()),
    scopeAliases: normalizeList(rule.scopeAliases, (value) => `${value ?? ""}`.trim().toLowerCase()),
    projectKeys: normalizeList(rule.projectKeys, (value) => `${value ?? ""}`.trim().toUpperCase())
  };
}

export function resolveTargetingConfig(targeting = {}) {
  const rules = normalizeList(
    targeting.rules?.length > 0 ? targeting.rules : defaultTargetingConfig.rules,
    normalizeRule
  );

  return {
    unknownTarget: `${targeting.unknownTarget ?? defaultTargetingConfig.unknownTarget}`.trim() || "unknown",
    rules
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesAlias(text, alias) {
  if (!text || !alias) {
    return false;
  }

  if (/[^a-z0-9]/i.test(alias)) {
    return text.includes(alias);
  }

  return new RegExp(`\\b${escapeRegExp(alias)}\\b`, "i").test(text);
}

export function inferTargetFromTextFragments(fragments = [], targeting = {}) {
  const config = resolveTargetingConfig(targeting);
  const text = fragments.filter(Boolean).join(" ").toLowerCase();

  for (const rule of config.rules) {
    if (rule.aliases.some((alias) => matchesAlias(text, alias))) {
      return rule.target;
    }
  }

  return "";
}

export function inferTargetFromScope(scope, targeting = {}) {
  const config = resolveTargetingConfig(targeting);
  const normalizedScope = `${scope ?? ""}`.trim().toLowerCase();

  if (!normalizedScope) {
    return "";
  }

  for (const rule of config.rules) {
    const acceptedScopes = rule.scopeAliases.length > 0 ? rule.scopeAliases : rule.aliases;
    if (acceptedScopes.includes(normalizedScope)) {
      return rule.target;
    }
  }

  return "";
}

export function inferTargetFromProjectKey(projectKey, targeting = {}) {
  const config = resolveTargetingConfig(targeting);
  const normalizedProjectKey = `${projectKey ?? ""}`.trim().toUpperCase();

  if (!normalizedProjectKey) {
    return "";
  }

  for (const rule of config.rules) {
    if (rule.projectKeys.includes(normalizedProjectKey)) {
      return rule.target;
    }
  }

  return "";
}

export function defaultRepoTarget(productTarget, targeting = {}) {
  const config = resolveTargetingConfig(targeting);
  return config.rules.find((rule) => rule.target === productTarget)?.repoTarget ?? "UNKNOWN";
}

export function resolveTargetRule(productTarget, targeting = {}) {
  const config = resolveTargetingConfig(targeting);
  return config.rules.find((rule) => rule.target === productTarget) ?? null;
}

export function resolveMappingDefaults(productTarget, targeting = {}) {
  const rule = resolveTargetRule(productTarget, targeting);
  return {
    repoTarget: rule?.repoTarget ?? "UNKNOWN",
    area: rule?.area ?? productTarget ?? defaultUnknownTarget(targeting),
    inScope: rule?.inScope ?? productTarget !== defaultUnknownTarget(targeting),
    feasibility: rule?.feasibility ?? "feasible",
    implementationHint:
      rule?.implementationHint ?? (productTarget ? `Inspect mapped ${productTarget} area` : "")
  };
}

export function defaultUnknownTarget(targeting = {}) {
  return resolveTargetingConfig(targeting).unknownTarget;
}
