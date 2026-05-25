import { LlmContextAdapter } from "./llm-context-adapter.js";
import { McpLlmContextAdapter } from "./llm-context-mcp-adapter.js";
import { LlmMemoryAdapter } from "./llm-memory-adapter.js";
import { McpLlmMemoryAdapter } from "./llm-memory-mcp-adapter.js";
import { ResilientLlmContextAdapter } from "./resilient-llm-context-adapter.js";
import { ResilientLlmMemoryAdapter } from "./resilient-llm-memory-adapter.js";

export function buildGenericAdapters({ config, mcpClient, logger }) {
  return {
    llmContext: {
      mock: () =>
        new LlmContextAdapter({
          ...config.adapters.llmContext.mock,
          targeting: config.targeting
        }),
      mcp: () => {
        const primaryAdapter = new McpLlmContextAdapter({
          ...config.adapters.llmContext.mcp,
          targeting: config.targeting,
          client: mcpClient
        });

        if (config.adapters.llmContext.mcp?.fallbackToMockOnError === false) {
          return primaryAdapter;
        }

        return new ResilientLlmContextAdapter({
          primaryAdapter,
          fallbackAdapter: new LlmContextAdapter({
            ...config.adapters.llmContext.mock,
            targeting: config.targeting
          }),
          logger
        });
      }
    },
    llmMemory: {
      mock: () => new LlmMemoryAdapter(config.adapters.llmMemory.mock),
      mcp: () => {
        const primaryAdapter = new McpLlmMemoryAdapter({
          ...config.adapters.llmMemory.mcp,
          client: mcpClient
        });

        if (config.adapters.llmMemory.mcp?.fallbackToMockOnError === false) {
          return primaryAdapter;
        }

        return new ResilientLlmMemoryAdapter({
          primaryAdapter,
          fallbackAdapter: new LlmMemoryAdapter(config.adapters.llmMemory.mock),
          logger
        });
      }
    }
  };
}