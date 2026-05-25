import { HttpAgentRuntimeAdapter } from "./http-agent-runtime-adapter.js";

export class OllamaAgentRuntimeAdapter extends HttpAgentRuntimeAdapter {
  buildHeaders() {
    const providerConfig = this.getProviderConfig();
    const envVar = providerConfig.apiKeyEnvVar ?? "";
    const apiKey = envVar ? process.env[envVar] : "";

    return apiKey
      ? {
          ...super.buildHeaders(),
          authorization: `Bearer ${apiKey}`
        }
      : super.buildHeaders();
  }
}
