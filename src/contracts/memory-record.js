import { assertTriageStatus } from "./harness-contracts.js";

function mapLegacyStatus(status) {
  if (status === "stub_candidate" || status === "already_seen") {
    return "feasible";
  }

  return status;
}

function toArray(value) {
  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }

  if (typeof value === "string" && value.trim().length > 0) {
    return [value.trim()];
  }

  return [];
}

export function normalizeMemoryRecord(record) {
  const normalized = {
    ticket_key: record.ticket_key ?? record.ticketKey,
    project_key: record.project_key ?? record.projectKey ?? "UNKNOWN",
    repo_target: record.repo_target ?? record.repoTarget ?? "UNKNOWN",
    status_decision: mapLegacyStatus(record.status_decision ?? record.lastDecision ?? "blocked"),
    confidence: record.confidence ?? 0,
    short_reason: record.short_reason ?? record.reason ?? "legacy record",
    implementation_hint: record.implementation_hint ?? "",
    branch_name: record.branch_name ?? record.branchName ?? "",
    pr_url: record.pr_url ?? record.prUrl ?? "",
    last_outcome: record.last_outcome ?? record.lastOutcome ?? "",
    recheck_conditions: toArray(record.recheck_conditions),
    updated_at: record.updated_at ?? record.updatedAt ?? new Date().toISOString()
  };

  assertTriageStatus(normalized.status_decision);
  return normalized;
}

export function createMemoryRecord(decision) {
  const record = {
    ticket_key: decision.ticket_key,
    project_key: decision.project_key,
    repo_target: decision.repo_target,
    status_decision: decision.status_decision,
    confidence: decision.confidence,
    short_reason: decision.short_reason,
    implementation_hint: decision.implementation_hint,
    branch_name: decision.branch_name ?? "",
    pr_url: decision.pr_url ?? "",
    last_outcome: decision.last_outcome ?? "",
    recheck_conditions: toArray(decision.recheck_conditions),
    updated_at: new Date().toISOString()
  };

  assertTriageStatus(record.status_decision);
  return record;
}
