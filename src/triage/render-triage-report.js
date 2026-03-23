export function renderTriageReport(summary) {
  const lines = [
    "BpoPilot Triage Report",
    `Mode: ${summary.mode}`,
    `Dry run: ${summary.dryRun}`,
    `Run id: ${summary.runId || "n/a"}`,
    `Adapters: jira=${summary.adapterKinds.jira}, llmContext=${summary.adapterKinds.llmContext}, llmMemory=${summary.adapterKinds.llmMemory}, llmSqlDb=${summary.adapterKinds.llmSqlDb}, bitbucket=${summary.adapterKinds.bitbucket}`,
    `Tickets loaded: ${summary.ticketCount}`,
    `Memory file: ${summary.memoryFile}`,
    `Resume: before=${summary.resumeStats.memoryRecordsBefore} after=${summary.resumeStats.memoryRecordsAfter} reused_rejected=${summary.resumeStats.skippedAlreadyRejected} reused_in_progress=${summary.resumeStats.skippedAlreadyInProgress}`,
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
      `- ${item.ticket_key}: ${item.status_decision} | confidence=${item.confidence} | repo=${item.repo_target}`
    );
    lines.push(`  reason: ${item.short_reason}`);
    if (item.implementation_hint) {
      lines.push(`  hint: ${item.implementation_hint}`);
    }
    if ((item.recheck_conditions ?? []).length > 0) {
      lines.push(`  recheck: ${item.recheck_conditions.join(", ")}`);
    }
  }

  return lines.join("\n");
}
