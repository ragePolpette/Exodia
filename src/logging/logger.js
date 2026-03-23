export function createLogger({ level = "info", includeTimestamp = false } = {}) {
  const levels = {
    silent: 0,
    error: 1,
    warn: 2,
    info: 3,
    debug: 4
  };

  const activeLevel = levels[level] ?? levels.info;

  function log(kind, message, details) {
    if ((levels[kind] ?? levels.info) > activeLevel) {
      return;
    }

    const prefix = includeTimestamp ? `${new Date().toISOString()} ` : "";
    const line = `${prefix}[${kind.toUpperCase()}] ${message}`;
    if (details === undefined) {
      console.error(line);
      return;
    }

    console.error(`${line} ${JSON.stringify(details)}`);
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
    }
  };
}
