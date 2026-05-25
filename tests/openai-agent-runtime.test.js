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

test("openai runtime provider sends an authorized chat completion request and parses JSON output", async () => {
  await withServer(async (req, res) => {
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/v1/chat/completions");
    assert.equal(req.headers.authorization, "Bearer test-openai-key");

    let body = "";
    for await (const chunk of req) {
      body += chunk;
    }

    const payload = JSON.parse(body);
    assert.equal(payload.model, "gpt-5.2");
    assert.equal(payload.max_tokens, 321);
    assert.equal(payload.response_format.type, "json_object");
    assert.equal(payload.messages[0].role, "system");
    assert.equal(payload.messages[1].role, "user");

    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              status: "proposal_ready",
              summary: "OpenAI analysis ready",
              feasibility: "feasible",
              confidence: 0.91,
              productTarget: "public-app",
              repoTarget: "public-web",
              area: "portal",
              proposedFix: {
                summary: "Tighten the public auth validation path",
                steps: ["Inspect the auth form validation"],
                risks: [],
                assumptions: []
              },
              verificationPlan: {
                summary: "Run targeted auth checks",
                checks: ["npm test -- auth"],
                successCriteria: ["validation path no longer fails"],
                maxVerificationLoops: 2
              },
              questions: []
            })
          }
        }
      ]
    }));
  }, async (baseUrl) => {
    process.env.OPENAI_API_KEY = "test-openai-key";
    const runtime = buildAgentRuntime(
      {
        enabled: true,
        provider: "openai",
        model: "gpt-5.2",
        enabledPhases: ["analysis"],
        providers: {
          openai: {
            baseUrl,
            apiKeyEnvVar: "OPENAI_API_KEY",
            endpoint: "/chat/completions",
            timeoutMs: 5000,
            maxTokens: 321
          }
        }
      },
      { debug() {} }
    );

    const result = await runtime.analyzeTicket({
      prompt: "Return JSON",
      ticket: { key: "GEN-950", summary: "Portal auth fails" },
      mapping: {
        productTarget: "public-app",
        repoTarget: "public-web",
        area: "auth",
        feasibility: "feasible",
        confidence: 0.8
      }
    });

    assert.equal(result.phase, "analysis");
    assert.equal(result.provider, "openai");
    assert.equal(result.status, "proposal_ready");
    assert.equal(result.productTarget, "public-app");
    assert.equal(result.repoTarget, "public-web");
  });
});
