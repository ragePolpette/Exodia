#!/usr/bin/env node
import { runHarness } from "./orchestration/run-harness.js";
import { loadConfig } from "./config/load-config.js";
import { InteractionStore } from "./interaction/interaction-store.js";
import { collectMonitoringSnapshot } from "./monitoring/monitoring-service.js";
import { renderMonitoringSnapshot } from "./monitoring/render-monitor-report.js";
import { renderPublishReadinessReport, runPublishReadinessReview } from "./review/publish-readiness.js";
import { resolveWorkspaceRootForChecks } from "./review/resolve-check-workspace.js";
import { resolveScheduleProfile, withRunLock } from "./scheduling/scheduling-service.js";
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
    limit: 20,
    profile: "",
    ignoreLock: false,
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

    if (value === "--limit") {
      options.limit = Number(rest[index + 1] ?? options.limit);
      index += 1;
      continue;
    }

    if (value === "--profile") {
      options.profile = rest[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (value === "--ignore-lock") {
      options.ignoreLock = true;
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
    "  node src/cli.js questions --config ./config/harness.config.example.json",
    "  node src/cli.js monitor --config ./config/harness.config.example.json --limit 20",
    "  node src/cli.js schedule-run --config ./config/harness.config.example.json --profile triage",
    "",
    "Commands:",
    "  run      triage + execution",
    "  triage   triage only report",
    "  execute  triage + execution with execution report",
    "  audit    public hygiene scan for tracked source, tests and config",
    "  review   publish-readiness review for docs, examples and hygiene",
    "  questions list pending human-in-the-loop questions",
    "  monitor  aggregate local run summaries and JSONL logs",
    "  schedule-run run a configured manual scheduling profile with a lock file",
    "",
    "Options:",
    "  --config <path>   config json path",
    "  --dry-run         force safe mode",
    "  --real-run        disable dry-run and allow config to request real execution",
    "  --execution-enabled    force execution on",
    "  --execution-disabled   force execution off",
    "  --report <name>   default | execution | final",
    "  --limit <n>       number of recent runs for monitor",
    "  --profile <name>  scheduling profile name for schedule-run",
    "  --ignore-lock     bypass scheduling lock protection",
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

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(renderHelp());
    return;
  }

  if (options.command === "audit") {
    const config = await loadConfig(options.configPath);
    const workspaceRoot = await resolveWorkspaceRootForChecks(config, process.cwd());
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
    const workspaceRoot = await resolveWorkspaceRootForChecks(config, process.cwd());
    const result = await runPublishReadinessReview(workspaceRoot, config.verification?.sensitiveScan);
    console.log(renderPublishReadinessReport(result));
    if (result.status !== "passed") {
      process.exitCode = 1;
    }
    return;
  }

  if (options.command === "questions") {
    const config = await loadConfig(options.configPath);
    if (!config.interaction?.enabled) {
      console.log("Interaction loop disabled by configuration.");
      return;
    }

    const store = new InteractionStore(config.interaction.storeFile);
    const pending = (await store.list()).filter((record) => record.status === "awaiting_response");
    if (pending.length === 0) {
      console.log("No pending interaction questions.");
      return;
    }

    const lines = [
      "Pending Interaction Questions",
      `Count: ${pending.length}`
    ];

    for (const record of pending) {
      lines.push(`- ${record.ticketKey} [${record.phase}] ${record.id}`);
      lines.push(`  destinations: ${record.destinations.join(", ") || "n/a"}`);
      lines.push(`  question: ${record.question}`);
    }

    console.log(lines.join("\n"));
    return;
  }

  if (options.command === "monitor") {
    const config = await loadConfig(options.configPath);
    const snapshot = await collectMonitoringSnapshot(config.logging?.file?.rootDir, {
      limit: Number.isFinite(options.limit) ? options.limit : 20
    });
    console.log(renderMonitoringSnapshot(snapshot));
    if (snapshot.aggregates.errorRuns > 0) {
      process.exitCode = 1;
    }
    return;
  }

  if (options.command === "schedule-run") {
    const config = await loadConfig(options.configPath);
    if (!config.scheduling?.enabled) {
      throw new Error("Scheduling profiles are disabled by configuration");
    }

    const profile = resolveScheduleProfile(config.scheduling, options.profile);
    const runScheduledProfile = async () => {
      const modeOverride =
        profile.command === "triage"
          ? "triage-only"
          : profile.command === "execute"
            ? "triage-and-execution"
            : undefined;
      const summary = await runHarness({
        configPath: options.configPath,
        modeOverride,
        dryRunOverride: profile.dryRun,
        executionEnabledOverride: profile.executionEnabled
      });
      console.log(
        renderSummary({
          ...summary,
          report:
            profile.report ?? (profile.command === "execute" ? "execution" : "default")
        })
      );
    };

    if (options.ignoreLock) {
      await runScheduledProfile();
      return;
    }

    await withRunLock(config.scheduling.lockFile, runScheduledProfile);
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
