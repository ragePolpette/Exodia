import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

function normalizeDateSegment(timestamp) {
  return `${timestamp ?? new Date().toISOString()}`.slice(0, 10);
}

export function resolveRunLogPaths(config = {}, runId, timestamp = new Date().toISOString()) {
  const enabled = config?.file?.enabled ?? false;
  if (!enabled) {
    return null;
  }

  const rootDir = path.resolve(config.file?.rootDir ?? path.join(process.cwd(), "data", "logs"));
  const dateDir = normalizeDateSegment(timestamp);
  const runDir = path.join(rootDir, dateDir);
  const safeRunId = `${runId ?? "unknown-run"}`.replace(/[^a-zA-Z0-9._-]+/g, "-");

  return {
    rootDir,
    runDir,
    jsonlFile: path.join(runDir, `run-${safeRunId}.jsonl`),
    summaryTextFile: path.join(runDir, `run-${safeRunId}.summary.txt`),
    summaryJsonFile: path.join(runDir, `run-${safeRunId}.summary.json`)
  };
}

export class RunLogStore {
  constructor(paths) {
    this.paths = paths;
    this.enabled = Boolean(paths?.runDir);
    if (this.enabled) {
      mkdirSync(this.paths.runDir, { recursive: true });
    }
  }

  append(entry) {
    if (!this.enabled) {
      return;
    }

    appendFileSync(this.paths.jsonlFile, `${JSON.stringify(entry)}\n`, "utf8");
  }

  writeSummary({ text, json }) {
    if (!this.enabled) {
      return;
    }

    if (typeof text === "string") {
      writeFileSync(this.paths.summaryTextFile, text, "utf8");
    }

    if (json !== undefined) {
      writeFileSync(this.paths.summaryJsonFile, JSON.stringify(json, null, 2), "utf8");
    }
  }
}
