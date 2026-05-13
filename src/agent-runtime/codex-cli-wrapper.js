import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

function inferJsonType(example) {
  if (Array.isArray(example)) {
    return {
      type: "array",
      items: example.length > 0 ? inferJsonType(example[0]) : {}
    };
  }

  if (example && typeof example === "object") {
    const properties = {};
    const required = [];
    for (const [key, value] of Object.entries(example)) {
      properties[key] = inferJsonType(value);
      required.push(key);
    }

    return {
      type: "object",
      properties,
      required,
      additionalProperties: false
    };
  }

  if (typeof example === "number") {
    return { type: "number" };
  }

  if (typeof example === "boolean") {
    return { type: "boolean" };
  }

  return { type: "string" };
}

export function buildPhaseOutputExample(phase) {
  switch (phase) {
    case "analysis":
      return {
        status: "proposal_ready",
        summary: "Short analysis summary",
        feasibility: "feasible",
        confidence: 0.8,
        productTarget: "public-app",
        repoTarget: "public-web",
        area: "public-experience",
        proposedFix: {
          summary: "Short fix summary",
          steps: ["step"],
          risks: ["risk"],
          assumptions: ["assumption"]
        },
        verificationPlan: {
          summary: "How to verify the fix",
          checks: ["check"],
          successCriteria: ["criterion"],
          maxVerificationLoops: 2
        },
        questions: [
          {
            reason: "missing_information",
            question: "Clarify the missing detail",
            blocking: true
          }
        ]
      };
    case "audit":
      return {
        verdict: "approved",
        summary: "Short audit summary",
        confidence: 0.8,
        issues: ["issue"],
        refinementRequests: ["specific refinement request"],
        questions: [
          {
            reason: "missing_information",
            question: "Clarify the missing detail",
            blocking: true
          }
        ]
      };
    case "implementation":
      return {
        status: "completed",
        summary: "Short implementation summary",
        branchName: "feat/gen-100-example-change",
        commitMessage: "fix: short summary",
        pullRequestTitle: "fix: short summary",
        changedFiles: ["src/example.js"],
        verificationResults: ["test command summary"],
        verificationPlan: {
          summary: "Verification summary",
          checks: ["check"],
          successCriteria: ["criterion"],
          maxVerificationLoops: 2
        },
        questions: [
          {
            reason: "missing_information",
            question: "Clarify the missing detail",
            blocking: true
          }
        ],
        followUp: ["follow-up note"]
      };
    default:
      throw new Error(`Unsupported Exodia Codex wrapper phase: ${phase}`);
  }
}

export function buildPhaseOutputSchema(phase) {
  const example = buildPhaseOutputExample(phase);
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    ...inferJsonType(example)
  };
}

export function buildCodexExecPrompt(envelope) {
  return [
    "You are the agent runtime behind Exodia.",
    "Return exactly one JSON object matching the provided schema.",
    "Do not use markdown fences or explanatory prose.",
    "Work only from the input payload and the repository context available in the working directory.",
    "",
    "Status rules:",
    "- analysis.status must be proposal_ready when the ticket is actionable and no blocking question is needed.",
    "- analysis.status must be needs_human when a human answer is required before deciding or implementing.",
    "- analysis.status must be blocked only when the ticket cannot progress in this run.",
    "- Do not return status blocked together with feasibility feasible unless there is a concrete blocking reason.",
    "",
    JSON.stringify(envelope, null, 2)
  ].join("\n");
}

export function buildCodexExecArgs({
  phase,
  cwd,
  model,
  outputSchemaPath,
  outputLastMessagePath,
  sandbox = "read-only",
  profile = "",
  useOss = false,
  localProvider = ""
}) {
  const args = [
    "exec",
    "--skip-git-repo-check",
    "--color",
    "never",
    "--sandbox",
    sandbox,
    "--output-schema",
    outputSchemaPath,
    "--output-last-message",
    outputLastMessagePath,
    "-C",
    cwd
  ];

  if (profile) {
    args.push("--profile", profile);
  }

  if (model) {
    args.push("--model", model);
  }

  if (useOss) {
    args.push("--oss");
    if (localProvider) {
      args.push("--local-provider", localProvider);
    }
  }

  args.push("-");
  return args;
}

function runCommand({ command, args, cwd, env, stdin, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const isWindowsCmdLauncher =
      process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
    const child = spawn(command, args, {
      cwd,
      env,
      shell: isWindowsCmdLauncher,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });

    let settled = false;
    const stdout = [];
    const stderr = [];
    const timeout = setTimeout(() => {
      child.kill();
      if (!settled) {
        settled = true;
        reject(new Error(`codex wrapper timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(error);
      }
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      if (code !== 0) {
        reject(
          new Error(
            Buffer.concat(stderr).toString("utf8").trim() ||
              Buffer.concat(stdout).toString("utf8").trim() ||
              `codex exec exited with code ${code}`
          )
        );
        return;
      }

      resolve({
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8")
      });
    });

    child.stdin.write(stdin);
    child.stdin.end();
  });
}

export async function runCodexExec(envelope, options = {}) {
  const phase = envelope.phase ?? process.env.EXODIA_AGENT_RUNTIME_PHASE ?? "analysis";
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "exodia-codex-wrapper-"));
  const schemaPath = path.join(tempDir, `${phase}.schema.json`);
  const outputPath = path.join(tempDir, `${phase}.output.json`);
  const prompt = buildCodexExecPrompt(envelope);
  const cwd = options.cwd || process.cwd();
  const command = options.command || process.env.EXODIA_CODEX_COMMAND || "codex";
  const model = options.model ?? process.env.EXODIA_CODEX_MODEL ?? "";
  const sandbox = options.sandbox ?? process.env.EXODIA_CODEX_SANDBOX ?? "read-only";
  const profile = options.profile ?? process.env.EXODIA_CODEX_PROFILE ?? "";
  const useOss =
    options.useOss ??
    /^(1|true|yes)$/i.test(process.env.EXODIA_CODEX_USE_OSS ?? "");
  const localProvider = options.localProvider ?? process.env.EXODIA_CODEX_LOCAL_PROVIDER ?? "";
  const timeoutMs = Number(options.timeoutMs ?? process.env.EXODIA_CODEX_TIMEOUT_MS ?? 300000) || 300000;

  try {
    await writeFile(schemaPath, JSON.stringify(buildPhaseOutputSchema(phase), null, 2), "utf8");
    const args = buildCodexExecArgs({
      phase,
      cwd,
      model,
      outputSchemaPath: schemaPath,
      outputLastMessagePath: outputPath,
      sandbox,
      profile,
      useOss,
      localProvider
    });

    await runCommand({
      command,
      args,
      cwd,
      env: process.env,
      stdin: prompt,
      timeoutMs
    });

    const output = await readFile(outputPath, "utf8");
    return JSON.parse(output);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
