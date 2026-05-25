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

test("ollama runtime provider sends an OpenAI-compatible local request without auth by default", async () => {
  await withServer(async (req, res) => {
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/v1/chat/completions");
    assert.equal(req.headers.authorization, undefined);

    let body = "";
    for await (const chunk of req) {
      body += chunk;
    }

    const payload = JSON.parse(body);
    assert.equal(payload.model, "qwen2.5-coder");
    assert.equal(payload.max_tokens, 444);
    assert.equal(payload.response_format.type, "json_object");

    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              status: "completed",
              summary: "Ollama implementation completed",
              branchName: "feat/gen-1001-portal-auth-fix",
              commitMessage: "fix: tighten portal auth validation",
              pullRequestTitle: "fix: tighten portal auth validation",
              changedFiles: ["public/app/auth.js"],
              verificationResults: ["npm test -- auth"],
              verificationPlan: {
                summary: "Run auth verification",
                checks: ["npm test -- auth"],
                successCriteria: ["auth path no longer fails"],
                maxVerificationLoops: 2
              },
              questions: [],
              followUp: []
            })
          }
        }
      ]
    }));
  }, async (baseUrl) => {
    const runtime = buildAgentRuntime(
      {
        enabled: true,
        provider: "ollama",
        model: "qwen2.5-coder",
        enabledPhases: ["implementation"],
        providers: {
          ollama: {
            baseUrl,
            endpoint: "/chat/completions",
            timeoutMs: 5000,
            maxTokens: 444
          }
        }
      },
      { debug() {} }
    );

    const result = await runtime.implementPlan({
      prompt: "Return JSON",
      plan: {
        summary: "Fix portal auth validation",
        steps: ["Inspect auth code", "Tighten validation"]
      },
      verificationPlan: {
        summary: "Run auth verification",
        checks: ["npm test -- auth"],
        successCriteria: ["auth path no longer fails"],
        maxVerificationLoops: 2
      }
    });

    assert.equal(result.phase, "implementation");
    assert.equal(result.provider, "ollama");
    assert.equal(result.status, "completed");
    assert.equal(result.branchName, "feat/gen-1001-portal-auth-fix");
  });
});
