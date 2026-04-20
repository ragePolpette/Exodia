const analysisStatuses = ["proposal_ready", "needs_human", "blocked"];
const auditVerdicts = ["approved", "needs_refinement", "blocked"];
const implementationStatuses = ["completed", "needs_human", "blocked", "failed"];

export const agentRuntimePhases = ["analysis", "audit", "implementation"];
export const agentRuntimeProviders = ["mock", "codex-cli", "openai", "claude", "openrouter", "ollama", "lmstudio"];

const defaultCapabilities = {
  supportsStructuredOutput: true,
  supportsToolUse: false,
  supportsLongContext: false,
  supportsCodeEdits: false,
  supportsVerificationLoop: false,
  supportsStreaming: false,
  supportsScreenshots: false
};

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clampConfidence(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.max(0, Math.min(1, numeric));
}

function normalizeList(values, fallback = []) {
  return Array.isArray(values) ? [...new Set(values.filter(Boolean))] : [...fallback];
}

function normalizeQuestions(questions = []) {
  return normalizeList(questions)
    .map((question) => ({
      reason: `${question?.reason ?? ""}`.trim(),
      question: `${question?.question ?? question?.text ?? ""}`.trim(),
      blocking: question?.blocking ?? true
    }))
    .filter((item) => item.question);
}

function normalizeStringList(values = []) {
  return normalizeList(values).map((value) => `${value ?? ""}`.trim()).filter(Boolean);
}

function normalizeProposedFix(proposedFix = {}) {
  return {
    summary: `${proposedFix?.summary ?? ""}`.trim(),
    steps: normalizeStringList(proposedFix?.steps),
    risks: normalizeStringList(proposedFix?.risks),
    assumptions: normalizeStringList(proposedFix?.assumptions)
  };
}

function normalizeVerificationPlan(plan = {}, runtimeConfig = {}) {
  return {
    summary: `${plan?.summary ?? ""}`.trim(),
    checks: normalizeStringList(plan?.checks),
    successCriteria: normalizeStringList(plan?.successCriteria),
    maxVerificationLoops:
      Math.max(
        1,
        Number(plan?.maxVerificationLoops ?? runtimeConfig.implementation?.maxVerificationLoops ?? 3)
      ) || 3
  };
}

export function assertAgentRuntimePhase(phase) {
  if (!agentRuntimePhases.includes(phase)) {
    throw new Error(`Unsupported agent runtime phase: ${phase}`);
  }
}

export function assertAgentRuntimeProvider(provider) {
  if (!agentRuntimeProviders.includes(provider)) {
    throw new Error(`Unsupported agent runtime provider: ${provider}`);
  }
}

export function normalizeAgentRuntimeCapabilities(capabilities = {}) {
  return {
    ...defaultCapabilities,
    ...capabilities,
    supportsStructuredOutput: capabilities.supportsStructuredOutput ?? true
  };
}

export function normalizeAgentRuntimeConfig(config = {}) {
  const provider = `${config.provider ?? "mock"}`.trim() || "mock";
  assertAgentRuntimeProvider(provider);

  return {
    enabled: config.enabled ?? false,
    provider,
    model: `${config.model ?? ""}`.trim(),
    artifactFile: `${config.artifactFile ?? "./data/agent-artifacts.json"}`.trim() || "./data/agent-artifacts.json",
    implementationArtifactFile:
      `${config.implementationArtifactFile ?? "./data/implementation-artifacts.json"}`.trim() ||
      "./data/implementation-artifacts.json",
    enabledPhases: normalizeList(config.enabledPhases, agentRuntimePhases),
    fallbackToHeuristics: config.fallbackToHeuristics ?? true,
    requireStructuredOutput: config.requireStructuredOutput ?? true,
    humanConfirmationPolicy: `${config.humanConfirmationPolicy ?? "on_low_confidence"}`.trim() || "on_low_confidence",
    capabilities: normalizeAgentRuntimeCapabilities(config.capabilities),
    audit: {
      maxRefinementIterations: Math.max(1, Number(config.audit?.maxRefinementIterations ?? 2) || 2)
    },
    implementation: {
      maxVerificationLoops: Math.max(1, Number(config.implementation?.maxVerificationLoops ?? 3) || 3)
    },
    providers: {
      mock: {
        ...(config.providers?.mock ?? {})
      },
      "codex-cli": {
        command: `${config.providers?.["codex-cli"]?.command ?? "codex"}`.trim() || "codex",
        args: Array.isArray(config.providers?.["codex-cli"]?.args)
          ? [...config.providers["codex-cli"].args]
          : [],
        workingDirectory: `${config.providers?.["codex-cli"]?.workingDirectory ?? ""}`.trim(),
        timeoutMs: Math.max(1000, Number(config.providers?.["codex-cli"]?.timeoutMs ?? 120000) || 120000),
        env: isObject(config.providers?.["codex-cli"]?.env)
          ? { ...config.providers["codex-cli"].env }
          : {}
      },
      openai: {
        endpoint: `${config.providers?.openai?.endpoint ?? "/chat/completions"}`.trim() || "/chat/completions",
        model: `${config.providers?.openai?.model ?? config.model ?? ""}`.trim(),
        responseFormat: `${config.providers?.openai?.responseFormat ?? "json"}`.trim() || "json",
        baseUrl: `${config.providers?.openai?.baseUrl ?? "https://api.openai.com/v1"}`.trim(),
        apiKeyEnvVar: `${config.providers?.openai?.apiKeyEnvVar ?? "OPENAI_API_KEY"}`.trim() || "OPENAI_API_KEY",
        timeoutMs: Math.max(1000, Number(config.providers?.openai?.timeoutMs ?? 120000) || 120000),
        temperature: Number(config.providers?.openai?.temperature ?? 0)
      },
      claude: {
        endpoint: `${config.providers?.claude?.endpoint ?? "/messages"}`.trim() || "/messages",
        model: `${config.providers?.claude?.model ?? config.model ?? ""}`.trim(),
        baseUrl: `${config.providers?.claude?.baseUrl ?? "https://api.anthropic.com/v1"}`.trim(),
        apiKeyEnvVar: `${config.providers?.claude?.apiKeyEnvVar ?? "ANTHROPIC_API_KEY"}`.trim() || "ANTHROPIC_API_KEY",
        anthropicVersion: `${config.providers?.claude?.anthropicVersion ?? "2023-06-01"}`.trim() || "2023-06-01",
        timeoutMs: Math.max(1000, Number(config.providers?.claude?.timeoutMs ?? 120000) || 120000),
        maxTokens: Math.max(1, Number(config.providers?.claude?.maxTokens ?? 2000) || 2000),
        temperature: Number(config.providers?.claude?.temperature ?? 0)
      },
      openrouter: {
        endpoint: `${config.providers?.openrouter?.endpoint ?? "/chat/completions"}`.trim() || "/chat/completions",
        model: `${config.providers?.openrouter?.model ?? config.model ?? ""}`.trim(),
        responseFormat: `${config.providers?.openrouter?.responseFormat ?? "json"}`.trim() || "json",
        baseUrl: `${config.providers?.openrouter?.baseUrl ?? "https://openrouter.ai/api/v1"}`.trim(),
        apiKeyEnvVar:
          `${config.providers?.openrouter?.apiKeyEnvVar ?? "OPENROUTER_API_KEY"}`.trim() || "OPENROUTER_API_KEY",
        siteUrl: `${config.providers?.openrouter?.siteUrl ?? ""}`.trim(),
        siteName: `${config.providers?.openrouter?.siteName ?? ""}`.trim(),
        timeoutMs: Math.max(1000, Number(config.providers?.openrouter?.timeoutMs ?? 120000) || 120000),
        temperature: Number(config.providers?.openrouter?.temperature ?? 0)
      },
      ollama: {
        endpoint: `${config.providers?.ollama?.endpoint ?? "/chat/completions"}`.trim() || "/chat/completions",
        model: `${config.providers?.ollama?.model ?? config.model ?? ""}`.trim(),
        responseFormat: `${config.providers?.ollama?.responseFormat ?? "json"}`.trim() || "json",
        baseUrl: `${config.providers?.ollama?.baseUrl ?? "http://127.0.0.1:11434/v1"}`.trim(),
        apiKeyEnvVar: `${config.providers?.ollama?.apiKeyEnvVar ?? ""}`.trim(),
        timeoutMs: Math.max(1000, Number(config.providers?.ollama?.timeoutMs ?? 120000) || 120000),
        temperature: Number(config.providers?.ollama?.temperature ?? 0)
      },
      lmstudio: {
        endpoint: `${config.providers?.lmstudio?.endpoint ?? "/chat/completions"}`.trim() || "/chat/completions",
        model: `${config.providers?.lmstudio?.model ?? config.model ?? ""}`.trim(),
        responseFormat: `${config.providers?.lmstudio?.responseFormat ?? "json"}`.trim() || "json",
        baseUrl: `${config.providers?.lmstudio?.baseUrl ?? "http://127.0.0.1:1234/v1"}`.trim(),
        apiKeyEnvVar: `${config.providers?.lmstudio?.apiKeyEnvVar ?? ""}`.trim(),
        timeoutMs: Math.max(1000, Number(config.providers?.lmstudio?.timeoutMs ?? 120000) || 120000),
        temperature: Number(config.providers?.lmstudio?.temperature ?? 0)
      }
    }
  };
}

export function normalizeAnalysisResult(result = {}, context = {}, runtimeConfig = {}) {
  const status = analysisStatuses.includes(result.status) ? result.status : "blocked";
  const productTarget = `${result.productTarget ?? result.product_target ?? "unknown"}`.trim() || "unknown";
  const repoTarget = `${result.repoTarget ?? result.repo_target ?? "UNKNOWN"}`.trim() || "UNKNOWN";
  const area = `${result.area ?? productTarget ?? "unknown"}`.trim() || "unknown";

  return {
    phase: "analysis",
    provider: context.provider ?? "mock",
    model: context.model ?? runtimeConfig.model ?? "",
    status,
    summary: `${result.summary ?? ""}`.trim(),
    feasibility: `${result.feasibility ?? "blocked"}`.trim() || "blocked",
    confidence: clampConfidence(result.confidence, 0),
    productTarget,
    repoTarget,
    area,
    proposedFix: normalizeProposedFix(result.proposedFix ?? { summary: result.fixSummary }),
    verificationPlan: normalizeVerificationPlan(result.verificationPlan, runtimeConfig),
    questions: normalizeQuestions(result.questions)
  };
}

export function normalizeAuditResult(result = {}, context = {}) {
  const verdict = auditVerdicts.includes(result.verdict) ? result.verdict : "blocked";

  return {
    phase: "audit",
    provider: context.provider ?? "mock",
    model: context.model ?? "",
    verdict,
    summary: `${result.summary ?? ""}`.trim(),
    confidence: clampConfidence(result.confidence, 0),
    issues: normalizeStringList(result.issues),
    refinementRequests: normalizeStringList(result.refinementRequests),
    questions: normalizeQuestions(result.questions)
  };
}

export function normalizeImplementationResult(result = {}, context = {}, runtimeConfig = {}) {
  const status = implementationStatuses.includes(result.status) ? result.status : "failed";

  return {
    phase: "implementation",
    provider: context.provider ?? "mock",
    model: context.model ?? runtimeConfig.model ?? "",
    status,
    summary: `${result.summary ?? ""}`.trim(),
    branchName: `${result.branchName ?? ""}`.trim(),
    commitMessage: `${result.commitMessage ?? ""}`.trim(),
    pullRequestTitle: `${result.pullRequestTitle ?? result.prTitle ?? ""}`.trim(),
    changedFiles: normalizeStringList(result.changedFiles),
    verificationResults: normalizeStringList(result.verificationResults),
    verificationPlan: normalizeVerificationPlan(result.verificationPlan, runtimeConfig),
    questions: normalizeQuestions(result.questions),
    followUp: normalizeStringList(result.followUp)
  };
}

export function normalizeAnalysisArtifact(record = {}) {
  return {
    ticketKey: `${record.ticketKey ?? record.ticket_key ?? "UNKNOWN"}`.trim() || "UNKNOWN",
    projectKey: `${record.projectKey ?? record.project_key ?? "UNKNOWN"}`.trim() || "UNKNOWN",
    provider: `${record.provider ?? "mock"}`.trim() || "mock",
    model: `${record.model ?? ""}`.trim(),
    phase: "analysis",
    status: analysisStatuses.includes(record.status) ? record.status : "blocked",
    summary: `${record.summary ?? ""}`.trim(),
    feasibility: `${record.feasibility ?? "blocked"}`.trim() || "blocked",
    confidence: clampConfidence(record.confidence, 0),
    productTarget: `${record.productTarget ?? record.product_target ?? "unknown"}`.trim() || "unknown",
    repoTarget: `${record.repoTarget ?? record.repo_target ?? "UNKNOWN"}`.trim() || "UNKNOWN",
    area: `${record.area ?? "unknown"}`.trim() || "unknown",
    proposedFix: normalizeProposedFix(record.proposedFix),
    verificationPlan: normalizeVerificationPlan(record.verificationPlan),
    questions: normalizeQuestions(record.questions),
    updatedAt: `${record.updatedAt ?? record.updated_at ?? new Date().toISOString()}`,
    createdAt: `${record.createdAt ?? record.created_at ?? record.updatedAt ?? record.updated_at ?? new Date().toISOString()}`
  };
}

export function normalizeImplementationArtifact(record = {}) {
  return {
    ticketKey: `${record.ticketKey ?? record.ticket_key ?? "UNKNOWN"}`.trim() || "UNKNOWN",
    projectKey: `${record.projectKey ?? record.project_key ?? "UNKNOWN"}`.trim() || "UNKNOWN",
    provider: `${record.provider ?? "mock"}`.trim() || "mock",
    model: `${record.model ?? ""}`.trim(),
    phase: "implementation",
    status: implementationStatuses.includes(record.status) ? record.status : "failed",
    summary: `${record.summary ?? ""}`.trim(),
    branchName: `${record.branchName ?? ""}`.trim(),
    commitMessage: `${record.commitMessage ?? ""}`.trim(),
    pullRequestTitle: `${record.pullRequestTitle ?? record.prTitle ?? ""}`.trim(),
    changedFiles: normalizeStringList(record.changedFiles),
    verificationResults: normalizeStringList(record.verificationResults),
    verificationPlan: normalizeVerificationPlan(record.verificationPlan),
    questions: normalizeQuestions(record.questions),
    followUp: normalizeStringList(record.followUp),
    attemptNumber: Math.max(1, Number(record.attemptNumber ?? record.attempt_number ?? 1) || 1),
    updatedAt: `${record.updatedAt ?? record.updated_at ?? new Date().toISOString()}`,
    createdAt: `${record.createdAt ?? record.created_at ?? record.updatedAt ?? record.updated_at ?? new Date().toISOString()}`
  };
}


