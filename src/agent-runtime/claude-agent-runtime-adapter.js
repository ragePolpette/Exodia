import {
  HttpAgentRuntimeAdapter,
  buildSystemPrompt,
  buildUserPrompt,
  postJson,
  safeJsonParse
} from "./http-agent-runtime-adapter.js";

export class ClaudeAgentRuntimeAdapter extends HttpAgentRuntimeAdapter {
  buildHeaders() {
    const providerConfig = this.getProviderConfig();
    const envVar = providerConfig.apiKeyEnvVar ?? "ANTHROPIC_API_KEY";
    const apiKey = process.env[envVar];
    if (!apiKey) {
      throw new Error(`Missing Claude API key in environment variable ${envVar}`);
    }

    return {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": providerConfig.anthropicVersion ?? "2023-06-01"
    };
  }

  buildRequestBody(phase, input) {
    const providerConfig = this.getProviderConfig();
    return {
      model: this.model,
      max_tokens: providerConfig.maxTokens ?? 2000,
      temperature: providerConfig.temperature ?? 0,
      system: buildSystemPrompt(phase, input.prompt, this.config.requireStructuredOutput),
      messages: [
        {
          role: "user",
          content: buildUserPrompt(input)
        }
      ]
    };
  }

  extractResponsePayload(response) {
    const text = (response?.content ?? [])
      .filter((item) => item?.type === "text")
      .map((item) => item.text ?? "")
      .join("\n")
      .trim();

    if (!text) {
      throw new Error("agent runtime response did not contain Claude text content");
    }

    return safeJsonParse(text);
  }

  async invoke(phase, input) {
    const response = await postJson({
      url: new URL(this.getEndpoint().replace(/^\//, ""), `${this.getBaseUrl().replace(/\/?$/, "/")}`).toString(),
      headers: this.buildHeaders(),
      body: this.buildRequestBody(phase, input),
      timeoutMs: this.getTimeoutMs()
    });

    return this.extractResponsePayload(response);
  }
}
