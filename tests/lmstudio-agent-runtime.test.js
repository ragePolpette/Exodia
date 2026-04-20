import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { buildAgentRuntime } from "../src/agent-runtime/build-agent-runtime.js";

async function withServer(handler, run) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;
  try {
    await run(baseUrl);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

test("lmstudio runtime provider sends an OpenAI-compatible local request and can use optional auth", async () => {
  await withServer(async (req, res) => {
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/v1/chat/completions");
    assert.equal(req.headers.authorization, "Bearer test-lmstudio-key");

    let body = "";
    for await (const chunk of req) {
      body += chunk;
    }

    const payload = JSON.parse(body);
    assert.equal(payload.model, "qwen2.5-coder-instruct");
    assert.equal(payload.response_format.type, "json_object");

    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              status: "proposal_ready",
              summary: "LM Studio analysis is ready",
              feasibility: "feasible",
              confidence: 0.87,
              productTarget: "public-app",
              repoTarget: "public-web",
              area: "portal",
              proposedFix: {
                summary: "Tighten public portal validation",
                steps: ["Inspect the portal validation flow"],
                risks: [],
                assumptions: []
              },
              verificationPlan: {
                summary: "Run portal validation checks",
                checks: ["npm test -- portal-validation"],
                successCriteria: ["portal validation no longer fails"],
                maxVerificationLoops: 2
              },
              questions: []
            })
          }
        }
      ]
    }));
  }, async (baseUrl) => {
    process.env.LMSTUDIO_API_KEY = "test-lmstudio-key";
    const runtime = buildAgentRuntime(
      {
        enabled: true,
        provider: "lmstudio",
        model: "qwen2.5-coder-instruct",
        enabledPhases: ["analysis"],
        providers: {
          lmstudio: {
            baseUrl,
            endpoint: "/chat/completions",
            apiKeyEnvVar: "LMSTUDIO_API_KEY",
            timeoutMs: 5000
          }
        }
      },
      { debug() {} }
    );

    const result = await runtime.analyzeTicket({
      prompt: "Return JSON",
      ticket: { key: "GEN-1200", summary: "Portal validation fails" },
      mapping: {
        productTarget: "public-app",
        repoTarget: "public-web",
        area: "portal",
        feasibility: "feasible",
        confidence: 0.8
      }
    });

    assert.equal(result.phase, "analysis");
    assert.equal(result.provider, "lmstudio");
    assert.equal(result.status, "proposal_ready");
    assert.equal(result.productTarget, "public-app");
    assert.equal(result.repoTarget, "public-web");
  });
});
