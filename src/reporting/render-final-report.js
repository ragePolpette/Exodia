export function renderFinalReport(summary) {
  const lines = [
    "Malkuth Final Report",
    `Mode: ${summary.mode}`,
    `Dry run: ${summary.dryRun}`,
    `Execution enabled: ${summary.executionEnabled}`,
    `Execution dry run: ${summary.executionDryRun}`,
    `Execution trust: ${summary.executionTrustLevel ?? "n/a"}`,
    `Run id: ${summary.runId || "n/a"}`,
    `Adapters: jira=${summary.adapterKinds.jira}, llmContext=${summary.adapterKinds.llmContext}, llmMemory=${summary.adapterKinds.llmMemory}, llmSqlDb=${summary.adapterKinds.llmSqlDb}, bitbucket=${summary.adapterKinds.bitbucket}`,
    `Tickets loaded: ${summary.ticketCount}`,
    `Memory file: ${summary.memoryFile}`,
    `Resume reused: rejected=${summary.resumeStats.skippedAlreadyRejected} in_progress=${summary.resumeStats.skippedAlreadyInProgress}`,
    "Triage counts:"
  ];

  for (const [status, count] of Object.entries(summary.triageCounts ?? {}).sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    lines.push(`- ${status}: ${count}`);
  }

  lines.push("Verification counts:");
  for (const [status, count] of Object.entries(summary.verificationCounts ?? {}).sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    lines.push(`- ${status}: ${count}`);
  }

  if (Object.keys(summary.verificationCounts ?? {}).length === 0) {
    lines.push("- none: 0");
  }

  lines.push("Execution counts:");
  for (const [status, count] of Object.entries(summary.executionCounts ?? {}).sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    lines.push(`- ${status}: ${count}`);
  }

  if (Object.keys(summary.executionCounts ?? {}).length === 0) {
    lines.push("- none: 0");
  }

  if ((summary.auditTrail?.length ?? 0) > 0) {
    lines.push("Audit trail:");
    for (const entry of summary.auditTrail) {
      lines.push(`- ${entry.phase}: ${entry.message}`);
    }
  }

  return lines.join("\n");
}
