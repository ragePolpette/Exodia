import { BitbucketAdapter } from "./bitbucket-adapter.js";
import { McpBitbucketAdapter } from "./bitbucket-mcp-adapter.js";
import { JiraAdapter } from "./jira-adapter.js";
import { McpJiraAdapter } from "./jira-mcp-adapter.js";
import { LlmSqlDbAdapter } from "./llm-sql-db-adapter.js";
import { McpLlmSqlDbAdapter } from "./llm-sql-db-mcp-adapter.js";

export function buildEnterpriseAdapters({ config, mcpClient }) {
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
      mcp: () =>
        new McpLlmSqlDbAdapter({
          ...config.adapters.llmSqlDb.mcp,
          client: mcpClient
        })
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
