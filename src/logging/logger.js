import { redactValue } from "../security/redaction.js";

export function createLogger({
  level = "info",
  includeTimestamp = false,
  redaction,
  runId = "",
  sink = null,
  baseContext = {}
} = {}) {
  const levels = {
    silent: 0,
    error: 1,
    warn: 2,
    info: 3,
    debug: 4
  };

  const activeLevel = levels[level] ?? levels.info;

  function buildEntry(kind, message, details) {
    const timestamp = new Date().toISOString();
    const safeDetails = details === undefined ? undefined : redactValue(details, redaction);
    return {
      timestamp,
      level: kind,
      runId,
      message,
      ...baseContext,
      ...(safeDetails === undefined ? {} : { details: safeDetails })
    };
  }

  function writeConsole(entry) {
    const prefix = includeTimestamp ? `${entry.timestamp} ` : "";
    const line = `${prefix}[${entry.level.toUpperCase()}] ${entry.message}`;
    if (entry.details === undefined) {
      console.error(line);
      return;
    }

    console.error(`${line} ${JSON.stringify(entry.details)}`);
  }

  function log(kind, message, details) {
    const entry = buildEntry(kind, message, details);
    if ((levels[kind] ?? levels.info) > activeLevel) {
      return;
    }

    sink?.append?.(entry);
    writeConsole(entry);
  }

  return {
    warn(message, details) {
      log("warn", message, details);
    },
    error(message, details) {
      log("error", message, details);
    },
    info(message, details) {
      log("info", message, details);
    },
    debug(message, details) {
      log("debug", message, details);
    },
    child(context = {}) {
      return createLogger({
        level,
        includeTimestamp,
        redaction,
        runId,
        sink,
        baseContext: {
          ...baseContext,
          ...context
        }
      });
    }
  };
}
