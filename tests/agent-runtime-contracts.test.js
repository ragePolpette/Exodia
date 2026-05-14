import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { buildAgentRuntime } from "../src/agent-runtime/build-agent-runtime.js";
import {
  normalizeAgentRuntimeConfig,
  normalizeAnalysisResult,
  normalizeImplementationResult
} from "../src/agent-runtime/agent-runtime-contracts.js";
import { resolveCodexTimeoutSettings } from "../src/agent-runtime/codex-cli-agent-runtime-adapter.js";
import {
  buildRuntimeProcessEnv,
  resolveRuntimeWorkingDirectory
} from "../src/agent-runtime/runtime-process-policy.js";
import { buildAdapters } from "../src/adapters/bootstrap-adapters.js";

function createConfig(overrides = {}) {
  return {
    mode: "triage-only",
    dryRun: true,
    memory: {
      backend: "file",
      filePath: "C:\\temp\\memory.json"
    },
    adapters: {
      jira: {
        kind: "mock",
        mock: {
          ticketSource: "config.mockTickets"
        },
        mcp: {
          server: "jira-official"
        }
      },
      llmContext: {
        kind: "mock",
        mock: {
          mappingSource: "ticket.contextMapping"
        },
        mcp: {
          server: "llm-context"
        }
      },
      llmMemory: {
        kind: "mock",
        mock: {
          backend: "file"
        },
        mcp: {
          server: "llm-memory"
        }
      },
      llmSqlDb: {
        kind: "mock",
        mock: {
          recordRuns: true
        },
        mcp: {
          server: "llm-sql-db-mcp"
        }
      },
      bitbucket: {
        kind: "mock",
        mock: {
          workspaceRoot: ""
        },
        mcp: {
          server: "llm-bitbucket-mcp"
        }
      }
    },
    agentRuntime: {
      enabled: true,
      provider: "mock",
      enabledPhases: ["analysis", "audit"],
      implementation: {
        maxVerificationLoops: 4
      },
      providers: {
        mock: {}
      }
    },
    execution: {
      baseBranch: "main",
      allowMerge: false
    },
    mcpBridge: {
      mode: "fixture",
      fixtures: {},
      fixtureFile: "",
      command: "",
      args: [],
      allowedActionsByServer: {}
    },
    mockTickets: [],
    ...overrides
  };
}

test("agent runtime config normalization provides provider defaults", () => {
  const normalized = normalizeAgentRuntimeConfig({
    enabled: true,
    provider: "codex-cli",
    providers: {
      "codex-cli": {
        command: "codex-dev",
        args: ["run"]
      }
    }
  });

  assert.equal(normalized.provider, "codex-cli");
  assert.deepEqual(normalized.enabledPhases, ["analysis", "audit", "implementation"]);
  assert.equal(normalized.providers["codex-cli"].command, "codex-dev");
  assert.ok(normalized.providers["codex-cli"].envPassthrough.includes("EXODIA_CODEX_COMMAND"));
  assert.ok(!normalized.providers["codex-cli"].envPassthrough.includes("AWS_SECRET_ACCESS_KEY"));
  assert.equal(normalized.audit.maxRefinementIterations, 2);
  assert.equal(normalized.implementation.maxVerificationLoops, 3);
});

test("agent runtime config normalization provides Pi RPC defaults", () => {
  const normalized = normalizeAgentRuntimeConfig({
    enabled: true,
    provider: "pi",
    model: "qwen-local",
    providers: {
      pi: {
        command: "pi-dev",
        provider: "ollama",
        tools: ["read", "edit"],
        toolsByPhase: {
          analysis: ["read-only"],
          implementation: ["write-and-test"]
        },
        sessionDir: "./data/pi-sessions"
      }
    }
  });

  assert.equal(normalized.provider, "pi");
  assert.equal(normalized.providers.pi.command, "pi-dev");
  assert.equal(normalized.providers.pi.provider, "ollama");
  assert.equal(normalized.providers.pi.model, "qwen-local");
  assert.deepEqual(normalized.providers.pi.tools, ["read", "edit"]);
  assert.deepEqual(normalized.providers.pi.toolsByPhase.analysis, ["read-only"]);
  assert.deepEqual(normalized.providers.pi.toolsByPhase.audit, []);
  assert.deepEqual(normalized.providers.pi.toolsByPhase.implementation, ["write-and-test"]);
  assert.equal(normalized.providers.pi.noSession, false);
  assert.ok(normalized.providers.pi.envPassthrough.includes("PATH"));
});

test("mock agent runtime returns structured analysis output", async () => {
  const runtime = buildAgentRuntime(
    {
      enabled: true,
      provider: "mock",
      enabledPhases: ["analysis"],
      implementation: {
        maxVerificationLoops: 5
      }
    },
    { debug() {} }
  );

  const result = await runtime.analyzeTicket({
    ticket: {
      key: "GEN-1",
      summary: "Portal login fails after password reset"
    },
    mapping: {
      productTarget: "public-app",
      repoTarget: "public-web",
      area: "auth",
      feasibility: "feasible",
      confidence: 0.84
    }
  });

  assert.equal(result.phase, "analysis");
  assert.equal(result.status, "proposal_ready");
  assert.equal(result.productTarget, "public-app");
  assert.equal(result.repoTarget, "public-web");
  assert.equal(result.verificationPlan.maxVerificationLoops, 5);
  assert.equal(result.questions.length, 0);
});

test("adapter bootstrap returns an agent runtime instance", () => {
  const { agentRuntime } = buildAdapters({
    config: createConfig(),
    logger: { debug() {} }
  });

  assert.equal(agentRuntime.provider, "mock");
  assert.equal(agentRuntime.isPhaseEnabled("analysis"), true);
  assert.equal(agentRuntime.isPhaseEnabled("implementation"), false);
});


test("agent runtime config preserves explicit workspace root", () => {
  const normalized = normalizeAgentRuntimeConfig({
    provider: "mock",
    workspaceRoot: "C:/path/to/target-worktree"
  });

  assert.equal(normalized.workspaceRoot, "C:/path/to/target-worktree");
});

test("analysis normalization repairs contradictory feasible blocked runtime output", () => {
  const normalized = normalizeAnalysisResult({
    status: "blocked",
    feasibility: "feasible",
    confidence: 0.9,
    productTarget: "public-app",
    repoTarget: "public-web",
    area: "payments",
    proposedFix: {},
    verificationPlan: {},
    questions: []
  });

  assert.equal(normalized.status, "proposal_ready");
  assert.equal(normalized.feasibility, "feasible");
});

test("analysis normalization routes blocking questions to human review", () => {
  const normalized = normalizeAnalysisResult({
    status: "proposal_ready",
    feasibility: "feasible",
    questions: [{ question: "Which tenant should be used?", blocking: true }]
  });

  assert.equal(normalized.status, "needs_human");
});

test("implementation normalization preserves runtime failure diagnostics", () => {
  const normalized = normalizeImplementationResult({
    status: "failed",
    summary: "runtime timed out",
    failureKind: "runtime_timeout",
    runtimeDiagnostics: {
      provider: "codex-cli",
      phase: "implementation",
      code: "AGENT_RUNTIME_TIMEOUT",
      message: "timeout",
      timeoutMs: 100,
      timedOut: true
    }
  });

  assert.equal(normalized.status, "failed");
  assert.equal(normalized.failureKind, "runtime_timeout");
  assert.equal(normalized.runtimeDiagnostics.code, "AGENT_RUNTIME_TIMEOUT");
  assert.equal(normalized.runtimeDiagnostics.timedOut, true);
});

test("codex timeout settings keep wrapper timeout below adapter timeout", () => {
  const settings = resolveCodexTimeoutSettings(
    {
      timeoutMs: 600000,
      timeoutGraceMs: 30000
    },
    {
      EXODIA_CODEX_TIMEOUT_MS: "600000"
    }
  );

  assert.equal(settings.adapterTimeoutMs, 600000);
  assert.equal(settings.wrapperTimeoutMs, 570000);
});

test("runtime process env only includes default and explicitly allowed keys", () => {
  const env = buildRuntimeProcessEnv({
    providerConfig: {
      env: {
        OPENAI_API_KEY: "from-config",
        AWS_SECRET_ACCESS_KEY: "must-not-leak"
      },
      envPassthrough: ["OPENAI_API_KEY"]
    },
    processEnv: {
      PATH: "system-path",
      OPENAI_API_KEY: "from-process",
      AWS_SECRET_ACCESS_KEY: "process-secret"
    },
    injectedEnv: {
      EXODIA_AGENT_RUNTIME_PHASE: "analysis"
    }
  });

  assert.equal(env.PATH, "system-path");
  assert.equal(env.OPENAI_API_KEY, "from-config");
  assert.equal(env.EXODIA_AGENT_RUNTIME_PHASE, "analysis");
  assert.equal(env.AWS_SECRET_ACCESS_KEY, undefined);
});

test("runtime working directory must stay inside the configured workspace", () => {
  const workspaceRoot = path.resolve("tests", "fixtures", "agent-context", "target-worktree");
  const allowedCwd = path.join(workspaceRoot, "src");

  assert.equal(
    resolveRuntimeWorkingDirectory({
      providerConfig: { workingDirectory: allowedCwd },
      workspaceRoot
    }),
    allowedCwd
  );

  assert.throws(
    () =>
      resolveRuntimeWorkingDirectory({
        providerConfig: { workingDirectory: path.dirname(workspaceRoot) },
        workspaceRoot
      }),
    /AGENT_RUNTIME_CWD_OUTSIDE_WORKSPACE/
  );
});
