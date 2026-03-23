export function createLogger({ level = "info" } = {}) {
  const levels = {
    silent: 0,
    error: 1,
    info: 2,
    debug: 3
  };

  const activeLevel = levels[level] ?? levels.info;

  function log(kind, message, details) {
    if ((levels[kind] ?? levels.info) > activeLevel) {
      return;
    }

    const line = `[${kind.toUpperCase()}] ${message}`;
    if (details === undefined) {
      console.error(line);
      return;
    }

    console.error(`${line} ${JSON.stringify(details)}`);
  }

  return {
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
