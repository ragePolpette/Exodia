import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { runHarness } from "../src/orchestration/run-harness.js";

async function createAuditScenario(config) {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "exodia-audit-runtime-"));
  const configPath = path.join(workspace, "harness.config.json");
  await writeFile(configPath, JSON.stringify(config, null, 2));
  return { workspace, configPath };
}

test("audit runtime can refine an analysis proposal before approving verification", async () => {
  const { configPath } = await createAuditScenario({
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
      enabledPhases: ["analysis", "audit"],
      audit: {
        maxRefinementIterations: 2
      },
      providers: {
        "codex-cli": {
          command: process.execPath,
          args: [
            "-e",
            "let data='';process.stdin.on('data',c=>data+=c);process.stdin.on('end',()=>{const req=JSON.parse(data);const phase=req.phase;const payload=req.payload; if(phase==='analysis'){const refined=(payload.auditFeedback?.refinementRequests?.length??0)>0; process.stdout.write(JSON.stringify({status:'proposal_ready',summary: refined ? 'Refined analysis' : 'Initial analysis',feasibility:'feasible',confidence: refined ? 0.93 : 0.81,productTarget:'public-app',repoTarget:'public-web',area:'portal',proposedFix:{summary: refined ? 'Refined portal fix' : 'Initial portal fix',steps:[refined ? 'Refined step' : 'Initial step']},verificationPlan:{summary:'Run portal verification',checks:['npm test'],successCriteria:['portal bug fixed']}})); return;} if(phase==='audit'){const steps=payload.proposal?.proposedFix?.steps??[]; const refined=steps.includes('Refined step'); process.stdout.write(JSON.stringify(refined ? {verdict:'approved',summary:'Audit approves refined plan',confidence:0.9,issues:[],refinementRequests:[],questions:[]} : {verdict:'needs_refinement',summary:'Add a more concrete implementation step',confidence:0.66,issues:['Plan is underspecified'],refinementRequests:['Refine the concrete implementation step'],questions:[]})); return;} process.stdout.write(JSON.stringify({status:'blocked',summary:'unsupported phase'}));});"
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
        key: "GEN-910",
        projectKey: "GEN",
        summary: "Portal login fails after reset",
        contextMapping: {
          inScope: true,
          productTarget: "public-app",
          repoTarget: "public-web",
          area: "auth",
          feasibility: "feasible",
          confidence: 0.84,
          implementationHint: "Inspect auth flow"
        }
      }
    ]
  });

  const summary = await runHarness({
    configPath,
    modeOverride: "triage-and-execution",
    dryRunOverride: true
  });

  assert.equal(summary.verification.length, 1);
  assert.equal(summary.verification[0].status, "approved");
  assert.equal(summary.verification[0].auditVerdict, "approved");
  assert.equal(summary.verification[0].refinementIterations, 1);
  assert.equal(summary.verification[0].refinedDecision.product_target, "public-app");
  assert.equal(summary.execution.length, 1);
  assert.equal(summary.execution[0].status, "pr_opened");
});
