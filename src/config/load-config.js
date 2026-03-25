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
        server: "atlassian_rovo_mcp",
        cloudId: "",
        jql: "",
        filterId: "",
        maxResults: 50,
        responseContentFormat: "markdown"
      }
    },
    llmContext: {
      kind: "mock",
      mock: {
        mappingSource: "ticket.contextMapping"
      },
      mcp: {
        server: "llm_context",
        workspaceRoot: ""
      }
    },
    llmMemory: {
      kind: "mock",
      mock: {
        backend: "file"
      },
      mcp: {
        server: "llm_memory",
        namespace: "bpopilot-ticket-harness"
      }
    },
    llmSqlDb: {
      kind: "mock",
      mock: {
        recordRuns: true
      },
      mcp: {
        server: "llm_db_prod_mcp",
        enabled: false,
        defaultDatabase: "prod",
        namespace: "bpopilot-ticket-harness",
        topology: "unified",
        operations: {
          recordRun: {
            server: "llm_db_prod_mcp"
          }
        },
        targets: {
          prod: {
            server: "llm_db_prod_mcp",
            database: "prod",
            access: "read-only"
          },
          dev: {
            server: "llm_db_dev_mcp",
            database: "dev",
            access: "schema-and-tests"
          }
        }
      }
    },
    bitbucket: {
      kind: "mock",
      mock: {
        workspaceRoot: "",
        existingPullRequests: []
      },
      mcp: {
        server: "llm_bitbucket_mcp",
        repository: "",
        project: "",
        workspaceRoot: "",
        operations: {
          findOpenPullRequest: {
            action: "findOpenPullRequest",
            enabled: true
          },
          createBranch: {
            action: "createBranch"
          },
          checkoutBranch: {
            action: "checkoutBranch"
          },
          createCommit: {
            action: "createCommit"
          },
          openPullRequest: {
            action: "openPullRequest"
          }
        }
      }
    }
  },
  execution: {
    enabled: true,
    dryRun: true,
    baseBranch: "BPOFH",
    allowRealPrs: false,
    allowMerge: false,
    workspaceRoot: ""
  },
  verification: {
    enabled: true,
    minConfidence: 0.75,
    maxCommitMessageLength: 120,
    maxPullRequestTitleLength: 120
  },
  mcpBridge: {
    mode: "fixture",
    fixtureFile: "",
    fixtures: {},
    command: "",
    args: []
  },
  logging: {
    level: "info",
    includeTimestamp: false
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

function normalizeSqlDbMcpConfig(config = {}, explicitConfig = {}) {
  const hasLegacyServers = Boolean(config.prodServer || config.devServer);
  const prodTarget = {
    server: config.prodServer ?? config.targets?.prod?.server ?? config.server,
    database: config.targets?.prod?.database ?? "prod",
    access: config.targets?.prod?.access ?? "read-only"
  };
  const devTarget = {
    server: config.devServer ?? config.targets?.dev?.server ?? config.server,
    database: config.targets?.dev?.database ?? "dev",
    access: config.targets?.dev?.access ?? "schema-and-tests"
  };
  const topology =
    (hasLegacyServers
      ? undefined
      : config.topology) ??
    (prodTarget.server && devTarget.server && prodTarget.server !== devTarget.server
      ? "split"
      : "unified");

  return {
    ...config,
    defaultDatabase: config.defaultDatabase ?? "prod",
    topology,
    operations: {
      ...config.operations,
      recordRun: {
        server:
          explicitConfig.operations?.recordRun?.server ??
          explicitConfig.server ??
          config.operations?.recordRun?.server ??
          config.server ??
          prodTarget.server ??
          devTarget.server
      }
    },
    targets: {
      ...config.targets,
      prod: prodTarget,
      dev: devTarget
    }
  };
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
  const normalizedSqlDbMcpConfig = normalizeSqlDbMcpConfig(
    merged.adapters.llmSqlDb?.mcp,
    parsed.adapters?.llmSqlDb?.mcp
  );

  return {
    ...merged,
    configPath: resolvedPath,
    adapters: {
      ...merged.adapters,
      llmSqlDb: {
        ...merged.adapters.llmSqlDb,
        mcp: normalizedSqlDbMcpConfig
      }
    },
    memory: {
      ...merged.memory,
      filePath: path.resolve(configDirectory, merged.memory.filePath)
    }
  };
}
