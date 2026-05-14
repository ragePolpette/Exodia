const DEFAULT_TAIL_LENGTH = 4000;

function truncateTail(value = "", maxLength = DEFAULT_TAIL_LENGTH) {
  const text = `${value ?? ""}`;
  if (text.length <= maxLength) {
    return text;
  }

  return text.slice(text.length - maxLength);
}

function compactMessage(value = "") {
  return `${value ?? ""}`.replace(/\s+/g, " ").trim();
}

export class AgentRuntimeInvocationError extends Error {
  constructor(message, { code = "AGENT_RUNTIME_FAILED", diagnostics = {}, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "AgentRuntimeInvocationError";
    this.code = code;
    this.diagnostics = diagnostics;
  }
}

export function isAgentRuntimeInvocationError(error) {
  return error instanceof AgentRuntimeInvocationError || error?.name === "AgentRuntimeInvocationError";
}

export function buildRuntimeDiagnostics({
  provider = "",
  phase = "",
  model = "",
  code = "AGENT_RUNTIME_FAILED",
  message = "",
  command = "",
  args = [],
  cwd = "",
  timeoutMs = 0,
  timedOut = false,
  stdout = "",
  stderr = "",
  startedAt = "",
  endedAt = "",
  metadata = {}
} = {}) {
  return {
    provider: `${provider ?? ""}`.trim(),
    phase: `${phase ?? ""}`.trim(),
    model: `${model ?? ""}`.trim(),
    code: `${code ?? "AGENT_RUNTIME_FAILED"}`.trim() || "AGENT_RUNTIME_FAILED",
    message: compactMessage(message),
    command: `${command ?? ""}`.trim(),
    args: Array.isArray(args) ? args.map((arg) => `${arg}`) : [],
    cwd: `${cwd ?? ""}`.trim(),
    timeoutMs: Math.max(0, Number(timeoutMs) || 0),
    timedOut: Boolean(timedOut),
    stdoutTail: truncateTail(stdout),
    stderrTail: truncateTail(stderr),
    startedAt: `${startedAt ?? ""}`.trim(),
    endedAt: `${endedAt ?? ""}`.trim(),
    metadata: metadata && typeof metadata === "object" && !Array.isArray(metadata) ? { ...metadata } : {}
  };
}

export function normalizeRuntimeDiagnostics(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return buildRuntimeDiagnostics(value);
}

export function failureKindFromDiagnostics(diagnostics = {}) {
  const code = `${diagnostics?.code ?? ""}`.toUpperCase();
  if (diagnostics?.timedOut || code.includes("TIMEOUT")) {
    return "runtime_timeout";
  }
  if (code.includes("INVALID_JSON")) {
    return "runtime_invalid_json";
  }
  if (code.includes("SUBPROCESS")) {
    return "runtime_subprocess_failed";
  }
  if (code.includes("HTTP") || code.includes("REQUEST")) {
    return "runtime_request_failed";
  }
  return "runtime_failed";
}

export function buildImplementationFailureFromError(error, context = {}) {
  const diagnostics = normalizeRuntimeDiagnostics(error?.diagnostics) ??
    buildRuntimeDiagnostics({
      ...context,
      code: error?.code ?? "AGENT_RUNTIME_FAILED",
      message: error?.message ?? "agent runtime failed"
    });
  const failureKind = failureKindFromDiagnostics(diagnostics);
  const summary = diagnostics.message || error?.message || "agent runtime failed before producing a result";

  return {
    status: "failed",
    summary,
    branchName: "",
    commitMessage: "",
    pullRequestTitle: "",
    changedFiles: [],
    verificationResults: [summary],
    verificationPlan: {},
    questions: [],
    followUp: ["Inspect runtimeDiagnostics before retrying this ticket."],
    failureKind,
    runtimeDiagnostics: diagnostics
  };
}
