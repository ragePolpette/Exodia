import { redactText } from "../security/redaction.js";

export function renderExecutionReport(summary) {
  const redaction = summary.redaction;
  const lines = [
    "Malkuth Execution Report",
    `Mode: ${summary.mode}`,
    `Dry run: ${summary.dryRun}`,
    `Execution trust: ${summary.executionTrustLevel ?? "n/a"}`,
    `Run id: ${summary.runId || "n/a"}`,
    `Adapters: jira=${summary.adapterKinds.jira}, llmContext=${summary.adapterKinds.llmContext}, llmMemory=${summary.adapterKinds.llmMemory}, llmSqlDb=${summary.adapterKinds.llmSqlDb}, bitbucket=${summary.adapterKinds.bitbucket}`,
    `Tickets triaged: ${summary.triage.length}`,
    `Interactions: pending=${summary.interactionStats?.pending ?? 0} resolved=${summary.interactionStats?.resolved ?? 0}`,
    `Verification results: ${summary.verification.length}`,
    `Execution results: ${summary.execution.length}`,
    `Memory file: ${summary.memoryFile}`,
    `Log file: ${summary.logFiles?.jsonl ?? "disabled"}`,
    `Resume: before=${summary.resumeStats.memoryRecordsBefore} after=${summary.resumeStats.memoryRecordsAfter}`,
    `Audit entries: ${summary.auditTrail?.length ?? 0}`,
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
    lines.push(`  reason: ${redactText(item.reason, redaction)}`);
    if (item.branchName) {
      lines.push(`  branch: ${item.branchName}`);
    }
    if (item.commitMessage) {
      lines.push(`  commit: ${redactText(item.commitMessage, redaction)}`);
    }
    if (item.pullRequestTitle) {
      lines.push(`  pr_title: ${redactText(item.pullRequestTitle, redaction)}`);
    }
  }

  lines.push("Execution:");

  if (summary.execution.length === 0) {
    lines.push("- no execution actions");
  }

  for (const item of summary.execution) {
    lines.push(`- ${item.ticketKey}: ${item.status} | product=${item.productTarget} | repo=${item.repoTarget}`);
    lines.push(`  reason: ${redactText(item.reason, redaction)}`);
    if (item.branchName) {
      lines.push(`  branch: ${item.branchName}`);
    }
    if (item.commitMessage) {
      lines.push(`  commit: ${redactText(item.commitMessage, redaction)}`);
    }
    if (item.pullRequestUrl) {
      lines.push(`  pr: ${redactText(item.pullRequestUrl, redaction)}`);
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
