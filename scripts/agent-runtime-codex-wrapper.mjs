#!/usr/bin/env node
import { runCodexExec } from "../src/agent-runtime/codex-cli-wrapper.js";
import { buildImplementationFailureFromError } from "../src/agent-runtime/runtime-diagnostics.js";

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const raw = await readStdin();
const envelope = raw.trim() ? JSON.parse(raw) : {};
try {
  const result = await runCodexExec(envelope, {
    cwd: process.env.EXODIA_AGENT_RUNTIME_WORKSPACE_ROOT || process.cwd()
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  if ((envelope.phase ?? process.env.EXODIA_AGENT_RUNTIME_PHASE) !== "implementation") {
    throw error;
  }

  const failure = buildImplementationFailureFromError(error, {
    provider: envelope.provider ?? process.env.EXODIA_AGENT_RUNTIME_PROVIDER ?? "codex-cli",
    phase: "implementation",
    model: envelope.model ?? process.env.EXODIA_AGENT_RUNTIME_MODEL ?? ""
  });
  process.stdout.write(`${JSON.stringify(failure)}\n`);
}
