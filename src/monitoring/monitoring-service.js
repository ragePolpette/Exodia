import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

async function listDateDirectories(rootDir) {
  try {
    const entries = await readdir(rootDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(rootDir, entry.name));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function listSummaryFiles(rootDir) {
  const dateDirectories = await listDateDirectories(rootDir);
  const files = [];

  for (const directory of dateDirectories) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".summary.json")) {
        files.push(path.join(directory, entry.name));
      }
    }
  }

  return files.sort((left, right) => right.localeCompare(left));
}

async function readJsonFile(filePath) {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function countJsonlLevels(filePath) {
  try {
    const raw = await readFile(filePath, "utf8");
    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    let errorCount = 0;
    let warnCount = 0;

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.level === "error") {
          errorCount += 1;
        } else if (entry.level === "warn") {
          warnCount += 1;
        }
      } catch {
        // ignore malformed log rows in monitoring view
      }
    }

    return {
      errorCount,
      warnCount,
      eventCount: lines.length
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        errorCount: 0,
        warnCount: 0,
        eventCount: 0
      };
    }

    throw error;
  }
}

function sumCounts(items = []) {
  return items.reduce((accumulator, item) => accumulator + Number(item ?? 0), 0);
}

function normalizeRunStatus(run) {
  if (run.errorCount > 0) {
    return "error";
  }

  if (run.warnCount > 0) {
    return "warning";
  }

  return "healthy";
}

export async function collectMonitoringSnapshot(rootDir, { limit = 20 } = {}) {
  const summaryFiles = await listSummaryFiles(rootDir);
  const selectedFiles = summaryFiles.slice(0, limit);
  const runs = [];

  for (const summaryFile of selectedFiles) {
    const summary = await readJsonFile(summaryFile);
    const jsonlFile = summaryFile.replace(/\.summary\.json$/i, ".jsonl");
    const levels = await countJsonlLevels(jsonlFile);
    runs.push({
      runId: summary.runId ?? "",
      recordedRunId: summary.recordedRunId ?? "",
      startedAt: summary.startedAt ?? "",
      mode: summary.mode ?? "",
      dryRun: summary.dryRun ?? false,
      ticketCount: summary.ticketCount ?? 0,
      triageCounts: summary.triageCounts ?? {},
      verificationCounts: summary.verificationCounts ?? {},
      executionCounts: summary.executionCounts ?? {},
      interactionStats: summary.interactionStats ?? { pending: 0, resolved: 0 },
      resumeStats: summary.resumeStats ?? {},
      errorCount: levels.errorCount,
      warnCount: levels.warnCount,
      eventCount: levels.eventCount,
      summaryFile,
      jsonlFile
    });
  }

  const enrichedRuns = runs.map((run) => ({
    ...run,
    status: normalizeRunStatus(run)
  }));

  return {
    rootDir,
    totalRuns: enrichedRuns.length,
    runs: enrichedRuns,
    aggregates: {
      healthyRuns: enrichedRuns.filter((run) => run.status === "healthy").length,
      warningRuns: enrichedRuns.filter((run) => run.status === "warning").length,
      errorRuns: enrichedRuns.filter((run) => run.status === "error").length,
      ticketsProcessed: sumCounts(enrichedRuns.map((run) => run.ticketCount)),
      pendingInteractions: sumCounts(enrichedRuns.map((run) => run.interactionStats?.pending ?? 0)),
      resolvedInteractions: sumCounts(enrichedRuns.map((run) => run.interactionStats?.resolved ?? 0)),
      warnings: sumCounts(enrichedRuns.map((run) => run.warnCount)),
      errors: sumCounts(enrichedRuns.map((run) => run.errorCount)),
      events: sumCounts(enrichedRuns.map((run) => run.eventCount))
    }
  };
}
