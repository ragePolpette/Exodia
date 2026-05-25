import { BitbucketAdapter } from "./bitbucket-adapter.js";
import { McpBitbucketAdapter } from "./bitbucket-mcp-adapter.js";
import { JiraAdapter } from "./jira-adapter.js";
import { McpJiraAdapter } from "./jira-mcp-adapter.js";
import { LlmSqlDbAdapter } from "./llm-sql-db-adapter.js";
import { McpLlmSqlDbAdapter } from "./llm-sql-db-mcp-adapter.js";
import { ResilientLlmSqlDbAdapter } from "./resilient-llm-sql-db-adapter.js";

export function buildEnterpriseAdapters({ config, mcpClient, logger }) {
  return {
    jira: {
      mock: () => new JiraAdapter({ tickets: config.mockTickets, targeting: config.targeting }),
      mcp: () =>
        new McpJiraAdapter({
          ...config.adapters.jira.mcp,
          targeting: config.targeting,
          client: mcpClient
        })
    },
    llmSqlDb: {
      mock: () => new LlmSqlDbAdapter(config.adapters.llmSqlDb.mock),
      mcp: () => {
        const primaryAdapter = new McpLlmSqlDbAdapter({
          ...config.adapters.llmSqlDb.mcp,
          client: mcpClient
        });

        if (config.adapters.llmSqlDb.mcp?.fallbackToMockOnError === false) {
          return primaryAdapter;
        }

        return new ResilientLlmSqlDbAdapter({
          primaryAdapter,
          fallbackAdapter: new LlmSqlDbAdapter(config.adapters.llmSqlDb.mock),
          logger
        });
      }
    },
    bitbucket: {
      mock: () =>
        new BitbucketAdapter({
          ...config.adapters.bitbucket.mock,
          repository:
            config.adapters.bitbucket.mock.repository ?? config.adapters.bitbucket.mcp.repository,
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
}