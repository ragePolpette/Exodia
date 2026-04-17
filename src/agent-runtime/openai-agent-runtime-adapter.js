import { HttpAgentRuntimeAdapter } from "./http-agent-runtime-adapter.js";

export class OpenAiAgentRuntimeAdapter extends HttpAgentRuntimeAdapter {
  buildHeaders() {
    const providerConfig = this.getProviderConfig();
    const apiKey = process.env[providerConfig.apiKeyEnvVar ?? "OPENAI_API_KEY"];
    if (!apiKey) {
      throw new Error(
        `Missing OpenAI API key in environment variable ${providerConfig.apiKeyEnvVar ?? "OPENAI_API_KEY"}`
      );
    }

    return {
      ...super.buildHeaders(),
      authorization: `Bearer ${apiKey}`
    };
  }
}
