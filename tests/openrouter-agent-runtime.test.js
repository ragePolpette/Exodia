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

test("openrouter runtime provider sends an authorized chat completion request and parses JSON output", async () => {
  await withServer(async (req, res) => {
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/v1/chat/completions");
    assert.equal(req.headers.authorization, "Bearer test-openrouter-key");
    assert.equal(req.headers["http-referer"], "https://exodia.local");
    assert.equal(req.headers["x-title"], "Exodia");

    let body = "";
    for await (const chunk of req) {
      body += chunk;
    }

    const payload = JSON.parse(body);
    assert.equal(payload.model, "openrouter/auto");
    assert.equal(payload.response_format.type, "json_object");

    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              verdict: "approved",
              summary: "OpenRouter audit approves the proposal",
              confidence: 0.9,
              issues: [],
              refinementRequests: [],
              questions: []
            })
          }
        }
      ]
    }));
  }, async (baseUrl) => {
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    const runtime = buildAgentRuntime(
      {
        enabled: true,
        provider: "openrouter",
        model: "openrouter/auto",
        enabledPhases: ["audit"],
        providers: {
          openrouter: {
            baseUrl,
            endpoint: "/chat/completions",
            apiKeyEnvVar: "OPENROUTER_API_KEY",
            siteUrl: "https://exodia.local",
            siteName: "Exodia",
            timeoutMs: 5000
          }
        }
      },
      { debug() {} }
    );

    const result = await runtime.auditProposal({
      prompt: "Return JSON",
      proposal: {
        status: "proposal_ready",
        proposedFix: { summary: "Fix portal auth", steps: ["Review auth flow"] },
        questions: []
      }
    });

    assert.equal(result.phase, "audit");
    assert.equal(result.provider, "openrouter");
    assert.equal(result.verdict, "approved");
    assert.equal(result.summary, "OpenRouter audit approves the proposal");
  });
});
