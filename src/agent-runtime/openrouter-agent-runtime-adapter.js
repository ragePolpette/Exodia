import { HttpAgentRuntimeAdapter } from "./http-agent-runtime-adapter.js";

export class OpenRouterAgentRuntimeAdapter extends HttpAgentRuntimeAdapter {
  buildHeaders() {
    const providerConfig = this.getProviderConfig();
    const envVar = providerConfig.apiKeyEnvVar ?? "OPENROUTER_API_KEY";
    const apiKey = process.env[envVar];
    if (!apiKey) {
      throw new Error(`Missing OpenRouter API key in environment variable ${envVar}`);
    }

    const headers = {
      ...super.buildHeaders(),
      authorization: `Bearer ${apiKey}`
    };

    if (providerConfig.siteUrl) {
      headers["http-referer"] = providerConfig.siteUrl;
    }

    if (providerConfig.siteName) {
      headers["x-title"] = providerConfig.siteName;
    }

    return headers;
  }
}
