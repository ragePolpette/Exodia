import { LlmContextAdapter } from "./llm-context-adapter.js";
import { McpLlmContextAdapter } from "./llm-context-mcp-adapter.js";
import { LlmMemoryAdapter } from "./llm-memory-adapter.js";
import { McpLlmMemoryAdapter } from "./llm-memory-mcp-adapter.js";

export function buildGenericAdapters({ config, mcpClient }) {
  return {
    llmContext: {
      mock: () =>
        new LlmContextAdapter({
          ...config.adapters.llmContext.mock,
          targeting: config.targeting
        }),
      mcp: () =>
        new McpLlmContextAdapter({
          ...config.adapters.llmContext.mcp,
          targeting: config.targeting,
          client: mcpClient
        })
    },
    llmMemory: {
      mock: () => new LlmMemoryAdapter(config.adapters.llmMemory.mock),
      mcp: () =>
        new McpLlmMemoryAdapter({
          ...config.adapters.llmMemory.mcp,
          client: mcpClient
        })
    }
  };
}
