import { readFile } from "node:fs/promises";
import path from "node:path";

const defaultConfig = {
  mode: "triage-and-execution",
  dryRun: true,
  memory: {
    backend: "file",
    filePath: "./data/memory.json"
  },
  adapters: {
    jira: {
      kind: "mock",
      mock: {
        ticketSource: "config.mockTickets"
      },
      mcp: {
        server: "jira-official",
        jql: "",
        filterId: ""
      }
    },
    llmContext: {
      kind: "mock",
      mock: {
        mappingSource: "ticket.contextMapping"
      },
      mcp: {
        server: "llm-context",
        workspaceRoot: ""
      }
    },
    llmMemory: {
      kind: "mock",
      mock: {
        backend: "file"
      },
      mcp: {
        server: "llm-memory",
        namespace: "bpopilot-ticket-harness"
      }
    },
    llmSqlDb: {
      kind: "mock",
      mock: {
        recordRuns: true
      },
      mcp: {
        server: "llm-sql-db-mcp",
        enabled: false
      }
    },
    bitbucket: {
      kind: "mock",
      mock: {
        workspaceRoot: ""
      },
      mcp: {
        server: "llm-bitbucket-mcp",
        repository: "",
        project: ""
      }
    }
  },
  execution: {
    baseBranch: "BPOFH",
    allowRealPrs: false,
    allowMerge: false
  },
  logging: {
    level: "info"
  },
  mockTickets: []
};

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepMerge(base, override) {
  if (!isObject(base) || !isObject(override)) {
    return override ?? base;
  }

  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    result[key] =
      key in base ? deepMerge(base[key], value) : Array.isArray(value) ? [...value] : value;
  }
  return result;
}

function normalizeLegacyAdapter(name, value) {
  if (typeof value !== "string") {
    return value;
  }

  if (name === "llmMemory" && value === "file") {
    return {
      kind: "mock",
      mock: {
        backend: "file"
      }
    };
  }

  return {
    kind: value
  };
}

function normalizeAdaptersConfig(adapters) {
  const normalized = {};

  for (const [name, value] of Object.entries(adapters ?? {})) {
    normalized[name] = normalizeLegacyAdapter(name, value);
  }

  return normalized;
}

export async function loadConfig(configPath) {
  const resolvedPath = path.resolve(configPath);
  const configDirectory = path.dirname(resolvedPath);
  const raw = await readFile(resolvedPath, "utf8");
  const parsed = JSON.parse(raw);
  const merged = deepMerge(defaultConfig, {
    ...parsed,
    adapters: normalizeAdaptersConfig(parsed.adapters)
  });

  return {
    ...merged,
    configPath: resolvedPath,
    memory: {
      ...merged.memory,
      filePath: path.resolve(configDirectory, merged.memory.filePath)
    }
  };
}
