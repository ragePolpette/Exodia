import { AgentRuntimeAdapter } from "./agent-runtime-adapter.js";

export class OpenAiAgentRuntimeAdapter extends AgentRuntimeAdapter {
  async invoke(phase) {
    const providerConfig = this.getProviderConfig();
    throw new Error(
      `openai agent runtime is not implemented yet for phase ${phase}. ` +
        `Configure model ${providerConfig.model ?? this.model ?? ""} when wiring the live runtime.`
    );
  }
}
