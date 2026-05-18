import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { runHarness } from "../src/orchestration/run-harness.js";

async function createExecutionScenario(config) {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "exodia-implementation-runtime-"));
  const configPath = path.join(workspace, "harness.config.json");
  await writeFile(configPath, JSON.stringify(config, null, 2));
  return { workspace, configPath };
}

test("implementation runtime can loop verification before opening a pull request", async () => {
  const { configPath } = await createExecutionScenario({
    mode: "triage-and-execution",
    dryRun: true,
    memory: {
      backend: "file",
      filePath: "./memory.json"
    },
    agentRuntime: {
      enabled: true,
      provider: "codex-cli",
      artifactFile: "./agent-artifacts.json",
      implementationArtifactFile: "./implementation-artifacts.json",
      enabledPhases: ["implementation"],
      implementation: {
        maxVerificationLoops: 3
      },
      providers: {
        "codex-cli": {
          command: process.execPath,
          args: [
            "-e",
            "let data='';process.stdin.on('data',c=>data+=c);process.stdin.on('end',()=>{const req=JSON.parse(data);const payload=req.payload;const phase=req.phase; if(phase!=='implementation'){process.stdout.write(JSON.stringify({status:'blocked',summary:'unsupported phase'})); return;} const attempts=payload.previousAttempts??[]; const firstAttempt=attempts.length===0; process.stdout.write(JSON.stringify(firstAttempt ? {status:'failed',summary:'Targeted verification still fails on the first attempt',verificationResults:['npm test: auth flow still failing'],followUp:['Retry after tightening the auth token refresh guard']} : {status:'completed',summary:'Implementation converged after the verification retry',commitMessage:'feat(GEN-920): Harden auth token refresh flow',pullRequestTitle:'[GEN-920] Harden auth token refresh flow',changedFiles:['src/auth/refresh-token.js','tests/auth/refresh-token.test.js'],verificationResults:['npm test: auth flow passes','npm run lint: clean'],followUp:[]}));});"
          ],
          timeoutMs: 5000
        }
      }
    },
    execution: {
      enabled: true,
      dryRun: true,
      baseBranch: "main",
      allowRealPrs: false,
      allowMerge: false
    },
    mockTickets: [
      {
        key: "GEN-920",
        projectKey: "GEN",
        summary: "Customer login fails after refresh token rotation",
        contextMapping: {
          inScope: true,
          productTarget: "public-app",
          repoTarget: "public-web",
          area: "auth",
          feasibility: "feasible",
          confidence: 0.91,
          implementationHint: "Inspect refresh token handling"
        }
      }
    ]
  });

  const summary = await runHarness({
    configPath,
    modeOverride: "triage-and-execution",
    dryRunOverride: true
  });

  assert.equal(summary.execution.length, 1);
  assert.equal(summary.execution[0].status, "pr_opened");
  assert.equal(summary.execution[0].implementationStatus, "completed");
  assert.equal(summary.execution[0].implementationAttempts, 2);
  assert.deepEqual(summary.execution[0].verificationResults, [
    "npm test: auth flow passes",
    "npm run lint: clean"
  ]);
  assert.match(summary.execution[0].commitMessage, /^[a-z]+\(GEN-920\): /);
  assert.notEqual(
    summary.execution[0].commitMessage,
    "feat(GEN-920): Harden auth token refresh flow"
  );
  assert.match(summary.execution[0].pullRequestTitle, /^\[GEN-920\] /);
  assert.notEqual(
    summary.execution[0].pullRequestTitle,
    "[GEN-920] Harden auth token refresh flow"
  );
});

test("implementation verification runtime can request changes before Exodia opens a pull request", async () => {
  const { configPath } = await createExecutionScenario({
    mode: "triage-and-execution",
    dryRun: true,
    memory: {
      backend: "file",
      filePath: "./memory.json"
    },
    agentRuntime: {
      enabled: true,
      provider: "codex-cli",
      artifactFile: "./agent-artifacts.json",
      implementationArtifactFile: "./implementation-artifacts.json",
      enabledPhases: ["implementation", "implementation_verification"],
      implementation: {
        maxVerificationLoops: 3
      },
      providers: {
        "codex-cli": {
          command: process.execPath,
          args: [
            "-e",
            "let data='';process.stdin.on('data',c=>data+=c);process.stdin.on('end',()=>{const req=JSON.parse(data);const payload=req.payload;const phase=req.phase;const attempts=payload.previousAttempts??[]; if(phase==='implementation'){const n=attempts.length+1; process.stdout.write(JSON.stringify({status:'completed',summary:'Patch attempt '+n,changedFiles:['src/auth/refresh-token.js'],verificationResults:['targeted check attempt '+n],verificationPlan:{summary:'verify auth refresh',checks:['targeted check'],successCriteria:['auth refresh passes'],maxVerificationLoops:3},questions:[],followUp:[]})); return;} if(phase==='implementation_verification'){const first=attempts.length===1; process.stdout.write(JSON.stringify(first ? {status:'needs_changes',summary:'The first patch misses token rotation cleanup',confidence:0.7,issues:['Add cleanup for stale refresh tokens'],verificationResults:['review found missing cleanup'],followUp:['Update stale-token cleanup path'],questions:[]} : {status:'passed',summary:'Patch satisfies the ticket and verification evidence',confidence:0.88,issues:[],verificationResults:['review passed'],followUp:[],questions:[]})); return;} process.stdout.write(JSON.stringify({status:'blocked',summary:'unsupported phase'}));});"
          ],
          timeoutMs: 5000
        }
      }
    },
    execution: {
      enabled: true,
      dryRun: true,
      baseBranch: "main",
      allowRealPrs: false,
      allowMerge: false
    },
    mockTickets: [
      {
        key: "GEN-922",
        projectKey: "GEN",
        summary: "Refresh token cleanup misses stale rotations",
        contextMapping: {
          inScope: true,
          productTarget: "public-app",
          repoTarget: "public-web",
          area: "auth",
          feasibility: "feasible",
          confidence: 0.91,
          implementationHint: "Inspect refresh token cleanup"
        }
      }
    ]
  });

  const summary = await runHarness({
    configPath,
    modeOverride: "triage-and-execution",
    dryRunOverride: true
  });

  assert.equal(summary.execution.length, 1);
  assert.equal(summary.execution[0].status, "pr_opened");
  assert.equal(summary.execution[0].implementationStatus, "completed");
  assert.equal(summary.execution[0].implementationAttempts, 2);
  assert.equal(summary.execution[0].implementationVerificationStatus, "passed");
  assert.equal(
    summary.execution[0].implementationVerificationSummary,
    "Patch satisfies the ticket and verification evidence"
  );
});

test("implementation runtime timeout is recorded as structured failure without opening a pull request", async () => {
  const { workspace, configPath } = await createExecutionScenario({
    mode: "triage-and-execution",
    dryRun: true,
    memory: {
      backend: "file",
      filePath: "./memory.json"
    },
    agentRuntime: {
      enabled: true,
      provider: "codex-cli",
      artifactFile: "./agent-artifacts.json",
      implementationArtifactFile: "./implementation-artifacts.json",
      enabledPhases: ["implementation"],
      implementation: {
        maxVerificationLoops: 3
      },
      providers: {
        "codex-cli": {
          command: process.execPath,
          args: ["-e", "setTimeout(()=>{}, 2000);"],
          timeoutMs: 50
        }
      }
    },
    execution: {
      enabled: true,
      dryRun: true,
      baseBranch: "main",
      allowRealPrs: false,
      allowMerge: false
    },
    mockTickets: [
      {
        key: "GEN-921",
        projectKey: "GEN",
        summary: "Customer login times out after refresh token rotation",
        contextMapping: {
          inScope: true,
          productTarget: "public-app",
          repoTarget: "public-web",
          area: "auth",
          feasibility: "feasible",
          confidence: 0.91,
          implementationHint: "Inspect refresh token timeout handling"
        }
      }
    ]
  });

  const summary = await runHarness({
    configPath,
    modeOverride: "triage-and-execution",
    dryRunOverride: true
  });

  assert.equal(summary.execution.length, 1);
  assert.equal(summary.execution[0].status, "failed");
  assert.equal(summary.execution[0].implementationStatus, "failed");
  assert.equal(summary.execution[0].failureKind, "runtime_timeout");
  assert.equal(summary.execution[0].implementationAttempts, 1);
  assert.equal(summary.execution[0].pullRequestUrl, "");
  assert.equal(summary.execution[0].runtimeDiagnostics.code, "AGENT_RUNTIME_TIMEOUT");

  const artifacts = JSON.parse(await readFile(path.join(workspace, "implementation-artifacts.json"), "utf8"));
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].ticketKey, "GEN-921");
  assert.equal(artifacts[0].failureKind, "runtime_timeout");
  assert.equal(artifacts[0].runtimeDiagnostics.code, "AGENT_RUNTIME_TIMEOUT");
});
