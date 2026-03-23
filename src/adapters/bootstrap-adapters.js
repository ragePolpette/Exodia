import { BitbucketAdapter } from "./bitbucket-adapter.js";
import { McpBitbucketAdapter } from "./bitbucket-mcp-adapter.js";
import { JiraAdapter } from "./jira-adapter.js";
import { McpJiraAdapter } from "./jira-mcp-adapter.js";
import { LlmContextAdapter } from "./llm-context-adapter.js";
import { McpLlmContextAdapter } from "./llm-context-mcp-adapter.js";
import { LlmMemoryAdapter } from "./llm-memory-adapter.js";
import { McpLlmMemoryAdapter } from "./llm-memory-mcp-adapter.js";
import { LlmSqlDbAdapter } from "./llm-sql-db-adapter.js";
import { McpLlmSqlDbAdapter } from "./llm-sql-db-mcp-adapter.js";
import { createMcpClient } from "../mcp/create-mcp-client.js";
import { FileMemoryStore } from "../memory/file-memory-store.js";

function assertAdapterKind(name, adapterConfig) {
  if (!["mock", "mcp"].includes(adapterConfig.kind)) {
    throw new Error(`Unsupported adapter kind for ${name}: ${adapterConfig.kind}`);
  }
}

function resolveMemoryStore(config) {
  return new FileMemoryStore(config.memory.filePath);
}

export function buildAdapters({ config, logger }) {
  const memoryStore = resolveMemoryStore(config);
  const needsMcpClient = Object.values(config.adapters).some(
    (adapterConfig) => adapterConfig.kind === "mcp"
  );
  const mcpClient = needsMcpClient ? createMcpClient(config.mcpBridge) : null;
  const definitions = {
    jira: {
      mock: () => new JiraAdapter({ tickets: config.mockTickets }),
      mcp: () =>
        new McpJiraAdapter({
          ...config.adapters.jira.mcp,
          client: mcpClient
        })
    },
    llmContext: {
      mock: () => new LlmContextAdapter(config.adapters.llmContext.mock),
      mcp: () =>
        new McpLlmContextAdapter({
          ...config.adapters.llmContext.mcp,
          client: mcpClient
        })
    },
    llmMemory: {
      mock: () =>
        new LlmMemoryAdapter(memoryStore, {
          ...config.adapters.llmMemory.mock,
          backend: config.memory.backend
        }),
      mcp: () =>
        new McpLlmMemoryAdapter({
          ...config.adapters.llmMemory.mcp,
          client: mcpClient
        })
    },
    llmSqlDb: {
      mock: () => new LlmSqlDbAdapter(config.adapters.llmSqlDb.mock),
      mcp: () => new McpLlmSqlDbAdapter(config.adapters.llmSqlDb.mcp)
    },
    bitbucket: {
      mock: () =>
        new BitbucketAdapter({
          ...config.adapters.bitbucket.mock,
          baseBranch: config.execution.baseBranch,
          allowMerge: config.execution.allowMerge
        }),
      mcp: () =>
        new McpBitbucketAdapter({
          ...config.adapters.bitbucket.mcp,
          baseBranch: config.execution.baseBranch,
          allowMerge: config.execution.allowMerge,
          workspaceRoot: config.execution.workspaceRoot || config.adapters.bitbucket.mcp.workspaceRoot,
          client: mcpClient
        })
    }
  };

  const adapters = {};
  const kinds = {};

  for (const [name, registry] of Object.entries(definitions)) {
    const adapterConfig = config.adapters[name];
    assertAdapterKind(name, adapterConfig);
    adapters[name] = registry[adapterConfig.kind]();
    kinds[name] = adapterConfig.kind;
  }

  logger?.debug("Adapters bootstrapped", kinds);

  return {
    adapters,
    memoryStore,
    kinds
  };
}
