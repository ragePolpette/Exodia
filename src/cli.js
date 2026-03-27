#!/usr/bin/env node
import { access } from "node:fs/promises";
import { runHarness } from "./orchestration/run-harness.js";
import { loadConfig } from "./config/load-config.js";
import { renderPublishReadinessReport, runPublishReadinessReview } from "./review/publish-readiness.js";
import { renderScanReport, scanWorkspace } from "./security/public-hygiene.js";

function parseArgs(argv) {
  const [first, ...remaining] = argv;
  const command = !first || first.startsWith("-") ? "run" : first;
  const rest = command === "run" && first?.startsWith("-") ? argv : remaining;
  const options = {
    command,
    configPath: "./config/harness.config.example.json",
    dryRun: undefined,
    executionEnabled: undefined,
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

    if (value === "--real-run") {
      options.dryRun = false;
      continue;
    }

    if (value === "--execution-disabled") {
      options.executionEnabled = false;
      continue;
    }

    if (value === "--execution-enabled") {
      options.executionEnabled = true;
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
    "  node src/cli.js execute --config ./config/harness.config.real.example.json --real-run --report execution",
    "  node src/cli.js audit --config ./config/harness.config.example.json",
    "  node src/cli.js review --config ./config/harness.config.example.json",
    "",
    "Commands:",
    "  run      triage + execution",
    "  triage   triage only report",
    "  execute  triage + execution with execution report",
    "  audit    public hygiene scan for tracked source, tests and config",
    "  review   publish-readiness review for docs, examples and hygiene",
    "",
    "Options:",
    "  --config <path>   config json path",
    "  --dry-run         force safe mode",
    "  --real-run        disable dry-run and allow config to request real execution",
    "  --execution-enabled    force execution on",
    "  --execution-disabled   force execution off",
    "  --report <name>   default | execution | final",
    "  --help            show this help"
  ].join("\n");
}

function renderSummary(summary) {
  if (summary.mode === "triage-and-execution" && summary.report === "execution") {
    return summary.executionReport;
  }

  if (summary.report === "final") {
    return summary.finalReport;
  }

  if (summary.mode === "triage-only") {
    return summary.triageReport;
  }
  return summary.finalReport;
}

async function resolveWorkspaceRootForChecks(config) {
  const candidates = [
    config.verification?.sensitiveScan?.workspaceRoot,
    process.cwd(),
    config.execution.workspaceRoot
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // try the next candidate
    }
  }

  return process.cwd();
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(renderHelp());
    return;
  }

  if (options.command === "audit") {
    const config = await loadConfig(options.configPath);
    const workspaceRoot = await resolveWorkspaceRootForChecks(config);
    const result = await scanWorkspace(workspaceRoot, {
      ...config.verification?.sensitiveScan,
      enabled: true
    });
    console.log(renderScanReport(result));
    if (result.issues.length > 0) {
      process.exitCode = 1;
    }
    return;
  }

  if (options.command === "review") {
    const config = await loadConfig(options.configPath);
    const workspaceRoot = await resolveWorkspaceRootForChecks(config);
    const result = await runPublishReadinessReview(workspaceRoot, config.verification?.sensitiveScan);
    console.log(renderPublishReadinessReport(result));
    if (result.status !== "passed") {
      process.exitCode = 1;
    }
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
    dryRunOverride: options.dryRun,
    executionEnabledOverride: options.executionEnabled
  });

  const effectiveReport =
    options.report ?? (options.command === "execute" ? "execution" : "default");

  console.log(renderSummary({ ...summary, report: effectiveReport }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
