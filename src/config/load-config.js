import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveTargetingConfig } from "../targeting/target-rules.js";

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
        namespace: "malkuth"
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
        namespace: "malkuth",
        topology: "unified",
        operations: {
          recordRun: {
            server: "llm_db_dev_mcp",
            action: "recordHarnessRun",
            enabled: false,
            database: "dev",
            sql: ""
          }
        },
        targets: {
          prod: {
            server: "llm_db_prod_mcp",
            database: "prod",
            access: "read-only",
            action: "runDiagnosticQuery",
            maxRows: 50
          },
          dev: {
            server: "llm_db_dev_mcp",
            database: "dev",
            access: "schema-and-tests",
            action: "runDiagnosticQuery",
            maxRows: 50
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
    trustLevel: "",
    baseBranch: "",
    allowRealPrs: false,
    allowMerge: false,
    allowedRepositories: [],
    allowedBaseBranches: [],
    workspaceRoot: ""
  },
  verification: {
    enabled: true,
    minConfidence: 0.75,
    maxCommitMessageLength: 120,
    maxPullRequestTitleLength: 120,
    allowedPathPrefixesByRepo: {},
    preflightCommands: [],
    allowedCommandPrefixes: [],
    sensitiveScan: {
      enabled: false,
      workspaceRoot: "",
      includePaths: ["src", "tests", "config", "README.md", "package.json"],
      forbiddenLiteralPatterns: [],
      forbiddenRegexPatterns: [],
      exampleFiles: []
    }
  },
  targeting: resolveTargetingConfig(),
  mcpBridge: {
    mode: "fixture",
    fixtureFile: "",
    fixtures: {},
    command: "",
    args: [],
    allowedActionsByServer: {},
    timeoutMs: 30000,
    retries: 0,
    retryDelayMs: 250
  },
  logging: {
    level: "info",
    includeTimestamp: false
  },
  security: {
    redaction: {
      enabled: true,
      redactUrls: true,
      redactPaths: true,
      redactPhones: true,
      redactTaxIds: true
    }
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
          config.operations?.recordRun?.server ??
          devTarget.server ??
          explicitConfig.server ??
          config.server ??
          prodTarget.server,
        action:
          explicitConfig.operations?.recordRun?.action ??
          config.operations?.recordRun?.action ??
          "recordHarnessRun",
        enabled:
          explicitConfig.operations?.recordRun?.enabled ??
          config.operations?.recordRun?.enabled ??
          false,
        database:
          explicitConfig.operations?.recordRun?.database ??
          config.operations?.recordRun?.database ??
          devTarget.database ??
          "dev",
        sql:
          explicitConfig.operations?.recordRun?.sql ??
          config.operations?.recordRun?.sql ??
          ""
      }
    },
    targets: {
      ...config.targets,
      prod: {
        ...prodTarget,
        action:
          explicitConfig.targets?.prod?.action ??
          config.targets?.prod?.action ??
          "runDiagnosticQuery",
        maxRows:
          explicitConfig.targets?.prod?.maxRows ??
          config.targets?.prod?.maxRows ??
          50
      },
      dev: {
        ...devTarget,
        action:
          explicitConfig.targets?.dev?.action ??
          config.targets?.dev?.action ??
          "runDiagnosticQuery",
        maxRows:
          explicitConfig.targets?.dev?.maxRows ??
          config.targets?.dev?.maxRows ??
          50
      }
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
  const normalizedTargetingConfig = resolveTargetingConfig(merged.targeting);

  return {
    ...merged,
    targeting: normalizedTargetingConfig,
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
