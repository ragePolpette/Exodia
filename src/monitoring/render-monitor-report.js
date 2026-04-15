export function renderMonitoringSnapshot(snapshot) {
  const lines = [
    "Exodia Monitoring Report",
    `Log root: ${snapshot.rootDir}`,
    `Runs inspected: ${snapshot.totalRuns}`,
    `Healthy runs: ${snapshot.aggregates.healthyRuns}`,
    `Warning runs: ${snapshot.aggregates.warningRuns}`,
    `Error runs: ${snapshot.aggregates.errorRuns}`,
    `Tickets processed: ${snapshot.aggregates.ticketsProcessed}`,
    `Interactions: pending=${snapshot.aggregates.pendingInteractions} resolved=${snapshot.aggregates.resolvedInteractions}`,
    `Logged warnings: ${snapshot.aggregates.warnings}`,
    `Logged errors: ${snapshot.aggregates.errors}`,
    "Recent runs:"
  ];

  if (snapshot.runs.length === 0) {
    lines.push("- no run summaries found");
    return lines.join("\n");
  }

  for (const run of snapshot.runs) {
    lines.push(
      `- ${run.startedAt || "n/a"} | ${run.status} | ${run.runId || "n/a"} | mode=${run.mode} | dryRun=${run.dryRun} | tickets=${run.ticketCount}`
    );
    lines.push(
      `  interactions: pending=${run.interactionStats?.pending ?? 0} resolved=${run.interactionStats?.resolved ?? 0} | warn=${run.warnCount} error=${run.errorCount}`
    );
    lines.push(`  summary: ${run.summaryFile}`);
  }

  return lines.join("\n");
}
