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

test("claude runtime provider sends an anthropic messages request and parses JSON output", async () => {
  await withServer(async (req, res) => {
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/v1/messages");
    assert.equal(req.headers['x-api-key'], "test-claude-key");
    assert.equal(req.headers['anthropic-version'], "2023-06-01");

    let body = "";
    for await (const chunk of req) {
      body += chunk;
    }

    const payload = JSON.parse(body);
    assert.equal(payload.model, "claude-sonnet-4-5");
    assert.equal(payload.messages[0].role, "user");
    assert.equal(typeof payload.system, "string");

    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            verdict: "approved",
            summary: "Claude audit approves the plan",
            confidence: 0.88,
            issues: [],
            refinementRequests: [],
            questions: []
          })
        }
      ]
    }));
  }, async (baseUrl) => {
    process.env.ANTHROPIC_API_KEY = "test-claude-key";
    const runtime = buildAgentRuntime(
      {
        enabled: true,
        provider: "claude",
        model: "claude-sonnet-4-5",
        enabledPhases: ["audit"],
        providers: {
          claude: {
            baseUrl,
            endpoint: "/messages",
            apiKeyEnvVar: "ANTHROPIC_API_KEY",
            anthropicVersion: "2023-06-01",
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
        proposedFix: { summary: "Fix auth validation", steps: ["Inspect auth"] },
        questions: []
      }
    });

    assert.equal(result.phase, "audit");
    assert.equal(result.provider, "claude");
    assert.equal(result.verdict, "approved");
    assert.equal(result.summary, "Claude audit approves the plan");
  });
});
