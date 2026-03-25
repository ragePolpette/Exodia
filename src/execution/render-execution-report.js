export function renderExecutionReport(summary) {
  const lines = [
    "Malkuth Execution Report",
    `Mode: ${summary.mode}`,
    `Dry run: ${summary.dryRun}`,
    `Run id: ${summary.runId || "n/a"}`,
    `Adapters: jira=${summary.adapterKinds.jira}, llmContext=${summary.adapterKinds.llmContext}, llmMemory=${summary.adapterKinds.llmMemory}, llmSqlDb=${summary.adapterKinds.llmSqlDb}, bitbucket=${summary.adapterKinds.bitbucket}`,
    `Tickets triaged: ${summary.triage.length}`,
    `Verification results: ${summary.verification.length}`,
    `Execution results: ${summary.execution.length}`,
    `Memory file: ${summary.memoryFile}`,
    `Resume: before=${summary.resumeStats.memoryRecordsBefore} after=${summary.resumeStats.memoryRecordsAfter}`,
    "Verification status counts:"
  ];

  const verificationCountEntries = Object.entries(summary.verificationCounts).sort(([left], [right]) =>
    left.localeCompare(right)
  );

  if (verificationCountEntries.length === 0) {
    lines.push("- none: 0");
  }

  for (const [status, count] of verificationCountEntries) {
    lines.push(`- ${status}: ${count}`);
  }

  lines.push(
    "Execution status counts:"
  );

  const executionCountEntries = Object.entries(summary.executionCounts).sort(([left], [right]) =>
    left.localeCompare(right)
  );

  if (executionCountEntries.length === 0) {
    lines.push("- none: 0");
  }

  for (const [status, count] of executionCountEntries) {
    lines.push(`- ${status}: ${count}`);
  }

  lines.push("Verification:");

  if (summary.verification.length === 0) {
    lines.push("- no verification actions");
  }

  for (const item of summary.verification) {
    lines.push(`- ${item.ticketKey}: ${item.status} | product=${item.productTarget} | repo=${item.repoTarget}`);
    lines.push(`  reason: ${item.reason}`);
    if (item.branchName) {
      lines.push(`  branch: ${item.branchName}`);
    }
    if (item.commitMessage) {
      lines.push(`  commit: ${item.commitMessage}`);
    }
    if (item.pullRequestTitle) {
      lines.push(`  pr_title: ${item.pullRequestTitle}`);
    }
  }

  lines.push("Execution:");

  if (summary.execution.length === 0) {
    lines.push("- no execution actions");
  }

  for (const item of summary.execution) {
    lines.push(`- ${item.ticketKey}: ${item.status} | product=${item.productTarget} | repo=${item.repoTarget}`);
    lines.push(`  reason: ${item.reason}`);
    if (item.branchName) {
      lines.push(`  branch: ${item.branchName}`);
    }
    if (item.commitMessage) {
      lines.push(`  commit: ${item.commitMessage}`);
    }
    if (item.pullRequestUrl) {
      lines.push(`  pr: ${item.pullRequestUrl}`);
    }
  }

  return lines.join("\n");
}
