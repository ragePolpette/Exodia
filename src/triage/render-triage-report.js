export function renderTriageReport(summary) {
  const counts = new Map();

  for (const item of summary.triage) {
    counts.set(item.status_decision, (counts.get(item.status_decision) ?? 0) + 1);
  }

  const lines = [
    "BpoPilot Triage Report",
    `Mode: ${summary.mode}`,
    `Dry run: ${summary.dryRun}`,
    `Tickets loaded: ${summary.ticketCount}`,
    `Memory file: ${summary.memoryFile}`,
    "Status counts:"
  ];

  for (const [status, count] of [...counts.entries()].sort(([left], [right]) =>
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
