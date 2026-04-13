import { redactText } from "../security/redaction.js";

export function renderTriageReport(summary) {
  const redaction = summary.redaction;
  const lines = [
    "Malkuth Triage Report",
    `Mode: ${summary.mode}`,
    `Dry run: ${summary.dryRun}`,
    `Execution trust: ${summary.executionTrustLevel ?? "n/a"}`,
    `Run id: ${summary.runId || "n/a"}`,
    `Adapters: jira=${summary.adapterKinds.jira}, llmContext=${summary.adapterKinds.llmContext}, llmMemory=${summary.adapterKinds.llmMemory}, llmSqlDb=${summary.adapterKinds.llmSqlDb}, bitbucket=${summary.adapterKinds.bitbucket}`,
    `Tickets loaded: ${summary.ticketCount}`,
    `Interactions: pending=${summary.interactionStats?.pending ?? 0} resolved=${summary.interactionStats?.resolved ?? 0}`,
    `Memory file: ${summary.memoryFile}`,
    `Log file: ${summary.logFiles?.jsonl ?? "disabled"}`,
    `Resume: before=${summary.resumeStats.memoryRecordsBefore} after=${summary.resumeStats.memoryRecordsAfter} reused_rejected=${summary.resumeStats.skippedAlreadyRejected} reused_in_progress=${summary.resumeStats.skippedAlreadyInProgress}`,
    `Audit entries: ${summary.auditTrail?.length ?? 0}`,
    "Status counts:"
  ];

  for (const [status, count] of Object.entries(summary.triageCounts).sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    lines.push(`- ${status}: ${count}`);
  }

  lines.push("Tickets:");
  for (const item of summary.triage) {
    lines.push(
      `- ${item.ticket_key}: ${item.status_decision} | confidence=${item.confidence} | product=${item.product_target} | repo=${item.repo_target}`
    );
    lines.push(`  reason: ${redactText(item.short_reason, redaction)}`);
    if (item.implementation_hint) {
      lines.push(`  hint: ${redactText(item.implementation_hint, redaction)}`);
    }
    if (item.clarification_summary) {
      lines.push(`  clarification: ${redactText(item.clarification_summary, redaction)}`);
    }
    if ((item.recheck_conditions ?? []).length > 0) {
      lines.push(`  recheck: ${redactText(item.recheck_conditions.join(", "), redaction)}`);
    }
  }

  if ((summary.auditTrail?.length ?? 0) > 0) {
    lines.push("Audit trail:");
    for (const entry of summary.auditTrail) {
      lines.push(`- ${entry.phase}: ${entry.message}`);
    }
  }

  return lines.join("\n");
}
