import { AgentRuntimeAdapter } from "./agent-runtime-adapter.js";

function withTrailingSlash(value = "") {
  return value.endsWith("/") ? value : `${value}/`;
}

function joinUrl(baseUrl, endpoint) {
  return new URL(endpoint.replace(/^\//, ""), withTrailingSlash(baseUrl)).toString();
}

function buildPhaseSchemaHint(phase) {
  switch (phase) {
    case "analysis":
      return {
        status: "proposal_ready | needs_human | blocked",
        summary: "short explanation",
        feasibility: "feasible | feasible_low_confidence | blocked | not_feasible",
        confidence: 0.0,
        productTarget: "canonical product target",
        repoTarget: "canonical repo target",
        area: "logical code area",
        proposedFix: {
          summary: "short fix summary",
          steps: ["step 1"],
          risks: ["risk"],
          assumptions: ["assumption"]
        },
        verificationPlan: {
          summary: "how to verify the fix",
          checks: ["command or verification check"],
          successCriteria: ["observable success criterion"],
          maxVerificationLoops: 3
        },
        questions: [
          {
            reason: "missing_information",
            question: "human clarification question",
            blocking: true
          }
        ]
      };
    case "audit":
      return {
        verdict: "approved | needs_refinement | blocked",
        summary: "short audit summary",
        confidence: 0.0,
        issues: ["issue"],
        refinementRequests: ["specific refinement request"],
        questions: [
          {
            reason: "missing_information",
            question: "human clarification question",
            blocking: true
          }
        ]
      };
    case "implementation":
      return {
        status: "completed | needs_human | blocked | failed",
        summary: "short implementation summary",
        branchName: "optional branch override",
        commitMessage: "optional commit message override",
        pullRequestTitle: "optional pull request title override",
        changedFiles: ["path/to/file"],
        verificationResults: ["verification output summary"],
        verificationPlan: {
          summary: "verification plan summary",
          checks: ["check"],
          successCriteria: ["criterion"],
          maxVerificationLoops: 3
        },
        questions: [
          {
            reason: "missing_information",
            question: "human clarification question",
            blocking: true
          }
        ],
        followUp: ["follow-up note"]
      };
    default:
      return {};
  }
}

function buildSystemPrompt(phase, prompt, requireStructuredOutput) {
  const base = `${prompt ?? ""}`.trim();
  const jsonInstruction = requireStructuredOutput
    ? "Return only one valid JSON object. Do not include markdown fences, explanations, or any prose outside the JSON object."
    : "Prefer JSON output.";
  const schemaHint = JSON.stringify(buildPhaseSchemaHint(phase), null, 2);

  return [
    base,
    jsonInstruction,
    `Use this target shape for phase ${phase}:`,
    schemaHint
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildUserPrompt(input = {}) {
  return JSON.stringify(input, null, 2);
}

function safeJsonParse(content) {
  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}$/);
    if (!match) {
      throw new Error("model response did not contain valid JSON");
    }
    return JSON.parse(match[0]);
  }
}

async function postJson({ url, headers, body, timeoutMs }) {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const text = await response.text();

    if (!response.ok) {
      throw new Error(`agent runtime request failed with ${response.status}: ${text}`);
    }

    return text ? JSON.parse(text) : {};
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`agent runtime request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

export class HttpAgentRuntimeAdapter extends AgentRuntimeAdapter {
  getBaseUrl() {
    const providerConfig = this.getProviderConfig();
    if (!providerConfig.baseUrl) {
      throw new Error(`Missing baseUrl for agent runtime provider ${this.provider}`);
    }
    return providerConfig.baseUrl;
  }

  getEndpoint() {
    return this.getProviderConfig().endpoint ?? "/chat/completions";
  }

  getTimeoutMs() {
    return this.getProviderConfig().timeoutMs ?? 120000;
  }

  buildHeaders() {
    return {
      "content-type": "application/json"
    };
  }

  normalizeResponseFormat() {
    const responseFormat = this.getProviderConfig().responseFormat;
    if (typeof responseFormat === "string") {
      return responseFormat === "json" ? { type: "json_object" } : { type: responseFormat };
    }
    return responseFormat ?? { type: "json_object" };
  }

  buildRequestBody(phase, input) {
    return {
      model: this.model,
      temperature: this.getProviderConfig().temperature ?? 0,
      response_format: this.normalizeResponseFormat(),
      messages: [
        {
          role: "system",
          content: buildSystemPrompt(phase, input.prompt, this.config.requireStructuredOutput)
        },
        {
          role: "user",
          content: buildUserPrompt(input)
        }
      ]
    };
  }

  extractResponsePayload(response) {
    const content = response?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("agent runtime response did not contain assistant JSON content");
    }
    return safeJsonParse(content.trim());
  }

  async invoke(phase, input) {
    const response = await postJson({
      url: joinUrl(this.getBaseUrl(), this.getEndpoint()),
      headers: this.buildHeaders(),
      body: this.buildRequestBody(phase, input),
      timeoutMs: this.getTimeoutMs()
    });

    return this.extractResponsePayload(response);
  }
}

