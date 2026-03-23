#!/usr/bin/env node
import { runHarness } from "./orchestration/run-harness.js";

function parseArgs(argv) {
  const [first, ...remaining] = argv;
  const command = !first || first.startsWith("-") ? "run" : first;
  const rest = command === "run" && first?.startsWith("-") ? argv : remaining;
  const options = {
    command,
    configPath: "./config/harness.config.example.json",
    dryRun: false,
    report: undefined,
    help: false
  };

  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];

    if (value === "--config") {
      options.configPath = rest[index + 1];
      index += 1;
      continue;
    }

    if (value === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (value === "--mode") {
      options.command = rest[index + 1];
      index += 1;
      continue;
    }

    if (value === "--report") {
      options.report = rest[index + 1];
      index += 1;
      continue;
    }

    if (value === "--help" || value === "-h") {
      options.help = true;
    }
  }

  return options;
}

function renderHelp() {
  return [
    "Usage:",
    "  node src/cli.js run --config ./config/harness.config.example.json --dry-run",
    "  node src/cli.js triage --config ./config/harness.config.example.json --dry-run",
    "  node src/cli.js execute --config ./config/harness.config.example.json --dry-run --report execution",
    "",
    "Commands:",
    "  run      triage + execution",
    "  triage   triage only report",
    "  execute  triage + execution with execution report",
    "",
    "Options:",
    "  --config <path>   config json path",
    "  --dry-run         force safe mock mode",
    "  --report <name>   default | execution",
    "  --help            show this help"
  ].join("\n");
}

function renderSummary(summary) {
  if (summary.mode === "triage-and-execution" && summary.report === "execution") {
    return summary.executionReport;
  }

  if (summary.mode === "triage-only") {
    return summary.triageReport;
  }

  const lines = [
    "BpoPilot Ticket Harness",
    `Mode: ${summary.mode}`,
    `Dry run: ${summary.dryRun}`,
    `Adapters: jira=${summary.adapterKinds.jira}, llmContext=${summary.adapterKinds.llmContext}, llmMemory=${summary.adapterKinds.llmMemory}, llmSqlDb=${summary.adapterKinds.llmSqlDb}, bitbucket=${summary.adapterKinds.bitbucket}`,
    `Tickets loaded: ${summary.ticketCount}`,
    `Tickets triaged: ${summary.triage.length}`,
    `Execution plans: ${summary.execution.length}`,
    `Memory file: ${summary.memoryFile}`
  ];

  lines.push("Triage:");
  for (const item of summary.triage) {
    lines.push(`- ${item.ticket_key}: ${item.status_decision} (${item.short_reason})`);
  }

  if (summary.execution.length > 0) {
    lines.push("Execution:");
    for (const item of summary.execution) {
      lines.push(
        `- ${item.ticketKey}: branch=${item.branchName} pr=${item.pullRequestTitle}`
      );
    }
  }

  return lines.join("\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(renderHelp());
    return;
  }

  const modeOverride =
    options.command === "triage"
      ? "triage-only"
      : options.command === "execute"
        ? "triage-and-execution"
        : undefined;
  const summary = await runHarness({
    configPath: options.configPath,
    modeOverride,
    dryRunOverride: options.dryRun
  });

  console.log(renderSummary({ ...summary, report: options.report ?? "default" }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
