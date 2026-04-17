import { normalizeAgentRuntimeConfig } from "./agent-runtime-contracts.js";
import { MockAgentRuntimeAdapter } from "./mock-agent-runtime-adapter.js";
import { CodexCliAgentRuntimeAdapter } from "./codex-cli-agent-runtime-adapter.js";
import { OpenAiAgentRuntimeAdapter } from "./openai-agent-runtime-adapter.js";
import { ClaudeAgentRuntimeAdapter } from "./claude-agent-runtime-adapter.js";
import { OpenRouterAgentRuntimeAdapter } from "./openrouter-agent-runtime-adapter.js";
import { OllamaAgentRuntimeAdapter } from "./ollama-agent-runtime-adapter.js";

export function buildAgentRuntime(config = {}, logger) {
  const normalizedConfig = normalizeAgentRuntimeConfig(config);
  const options = { logger };

  switch (normalizedConfig.provider) {
    case "mock":
      return new MockAgentRuntimeAdapter(normalizedConfig, options);
    case "codex-cli":
      return new CodexCliAgentRuntimeAdapter(normalizedConfig, options);
    case "openai":
      return new OpenAiAgentRuntimeAdapter(normalizedConfig, options);
    case "claude":
      return new ClaudeAgentRuntimeAdapter(normalizedConfig, options);
    case "openrouter":
      return new OpenRouterAgentRuntimeAdapter(normalizedConfig, options);
    case "ollama":
      return new OllamaAgentRuntimeAdapter(normalizedConfig, options);
    default:
      throw new Error(`Unsupported agent runtime provider: ${normalizedConfig.provider}`);
  }
}


