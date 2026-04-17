export const supportedModes = ["triage-only", "triage-and-execution"];

export const productTargets = ["legacy", "public-app", "automation-bot", "unknown"];

export const triageStatuses = [
  "skipped_out_of_scope",
  "skipped_already_rejected",
  "skipped_already_in_progress",
  "not_feasible",
  "feasible",
  "feasible_low_confidence",
  "blocked"
];

export const verificationStatuses = ["approved", "blocked", "needs_review"];
export const auditVerdicts = ["approved", "needs_refinement", "blocked"];

export const terminalOutcomes = ["not_feasible", "pr_opened", "implemented", "blocked"];

export function assertTriageStatus(status) {
  if (!triageStatuses.includes(status)) {
    throw new Error(`Unsupported triage status: ${status}`);
  }
}

export function assertProductTarget(target) {
  if (!productTargets.includes(target)) {
    throw new Error(`Unsupported product target: ${target}`);
  }
}

export function assertMode(mode) {
  if (!supportedModes.includes(mode)) {
    throw new Error(`Unsupported mode: ${mode}`);
  }
}

export function assertVerificationStatus(status) {
  if (!verificationStatuses.includes(status)) {
    throw new Error(`Unsupported verification status: ${status}`);
  }
}

export function assertAuditVerdict(verdict) {
  if (!auditVerdicts.includes(verdict)) {
    throw new Error(`Unsupported audit verdict: ${verdict}`);
  }
}
