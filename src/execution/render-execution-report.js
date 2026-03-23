export function renderExecutionReport(summary) {
  const lines = [
    "BpoPilot Execution Report",
    `Mode: ${summary.mode}`,
    `Dry run: ${summary.dryRun}`,
    `Tickets triaged: ${summary.triage.length}`,
    `Execution results: ${summary.execution.length}`,
    `Memory file: ${summary.memoryFile}`,
    "Execution:"
  ];

  for (const item of summary.execution) {
    lines.push(`- ${item.ticketKey}: ${item.status} | repo=${item.repoTarget}`);
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
