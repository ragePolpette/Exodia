import { spawn } from "node:child_process";
import { AgentRuntimeAdapter } from "./agent-runtime-adapter.js";
import { AgentRuntimeInvocationError, buildRuntimeDiagnostics } from "./runtime-diagnostics.js";
import { buildRuntimeProcessEnv, resolveRuntimeWorkingDirectory } from "./runtime-process-policy.js";

export function buildPiRpcArgs(providerConfig = {}) {
  if (providerConfig.args?.length) {
    return [...providerConfig.args];
  }

  const args = providerConfig.cliPath ? [providerConfig.cliPath] : [];
  args.push("--mode", "rpc");
  if (providerConfig.provider) {
    args.push("--provider", providerConfig.provider);
  }
  if (providerConfig.model) {
    args.push("--model", providerConfig.model);
  }
  if (providerConfig.noSession) {
    args.push("--no-session");
  }
  if (providerConfig.noContextFiles) {
    args.push("--no-context-files");
  }
  if (providerConfig.noBuiltinTools) {
    args.push("--no-builtin-tools");
  }
  if (providerConfig.tools?.length) {
    args.push("--tools", providerConfig.tools.join(","));
  }
  if (!providerConfig.noSession && providerConfig.sessionDir) {
    args.push("--session-dir", providerConfig.sessionDir);
  }
  return args;
}

function stringifyForPrompt(value) {
  return JSON.stringify(value, null, 2);
}

export function resolvePiToolPolicy(phase, providerConfig = {}) {
  const phasePolicy = providerConfig.toolsByPhase?.[phase] ?? [];
  if (phasePolicy.length) {
    return phasePolicy;
  }
  if (providerConfig.tools?.length) {
    return providerConfig.tools;
  }

  if (phase === "implementation") {
    return [
      "workspace-write inside the configured target worktree only",
      "create or reuse a dedicated ticket branch",
      "run only verification commands supplied by Exodia or the target instructions",
      "do not push, merge, or touch external services unless Exodia explicitly provides that step"
    ];
  }

  return [
    "read-only workspace access",
    "inspect and search code only",
    "do not edit files",
    "do not create branches",
    "do not run destructive commands"
  ];
}

export function buildPiRuntimePrompt({ phase, provider, model, payload, requireStructuredOutput, toolPolicy = [] }) {
  return [
    "You are running inside Exodia, an agentic ticket harness.",
    "Return exactly one JSON object. Do not wrap it in Markdown. Do not include commentary outside JSON.",
    `Runtime phase: ${phase}. Provider: ${provider}. Model: ${model ?? ""}.`,
    `Structured output required: ${requireStructuredOutput ? "yes" : "no"}.`,
    toolPolicy.length ? `Tool/workspace policy: ${toolPolicy.join(", ")}.` : "",
    "Use the provided ticket, memory, context, MCP guidance, and worktree instructions before asking questions.",
    "If you need missing human information, return it in the questions array and mark it blocking when appropriate.",
    "Runtime payload:",
    stringifyForPrompt(payload)
  ].filter(Boolean).join("\n\n");
}

function tryParseJsonObject(text) {
  const trimmed = `${text ?? ""}`.trim();
  if (!trimmed) {
    throw new Error("Pi runtime returned an empty assistant message");
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      return JSON.parse(fenced[1].trim());
    }

    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    }

    throw new Error("Pi runtime assistant message did not contain a JSON object");
  }
}

function extractTextContent(content) {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }
      return part?.text ?? part?.content ?? "";
    })
    .filter(Boolean)
    .join("");
}

function extractAssistantTextFromMessage(message = {}) {
  return [
    message.text,
    message.message,
    extractTextContent(message.content),
    extractTextContent(message.parts)
  ]
    .map((value) => `${value ?? ""}`.trim())
    .find(Boolean) ?? "";
}

function extractAssistantText(messages = []) {
  const candidates = [...messages].reverse();
  for (const message of candidates) {
    const role = `${message?.role ?? message?.type ?? ""}`.toLowerCase();
    if (role && !role.includes("assistant")) {
      continue;
    }

    const text = extractAssistantTextFromMessage(message);
    if (text) {
      return text;
    }
  }

  return "";
}

function parseJsonlBuffer(buffer, onRecord) {
  const lines = buffer.split("\n");
  const rest = lines.pop() ?? "";
  for (const line of lines) {
    const trimmed = line.replace(/\r$/, "").trim();
    if (!trimmed) {
      continue;
    }
    onRecord(JSON.parse(trimmed));
  }
  return rest;
}

export function runPiRpcCommand({ command, args, cwd, env, prompt, timeoutMs, provider = "pi", phase = "", model = "" }) {
  return new Promise((resolve, reject) => {
    const startedAt = new Date().toISOString();
    const child = spawn(command, args, {
      cwd,
      env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });

    const stderrChunks = [];
    let stdoutBuffer = "";
    let settled = false;
    let timeoutHandle = null;
    let lastAssistantText = "";
    const buildError = (message, code, extras = {}) =>
      new AgentRuntimeInvocationError(message, {
        code,
        diagnostics: buildRuntimeDiagnostics({
          provider,
          phase,
          model,
          code,
          message,
          command,
          args,
          cwd,
          timeoutMs,
          stdout: stdoutBuffer,
          stderr: Buffer.concat(stderrChunks).toString("utf8"),
          startedAt,
          endedAt: new Date().toISOString(),
          ...extras
        })
      });

    const finalize = (callback) => (value) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      child.kill();
      callback(value);
    };

    const resolveOnce = finalize(resolve);
    const rejectOnce = finalize(reject);

    const handleRecord = (record) => {
      if (record.type === "response" && record.success === false) {
        rejectOnce(
          buildError(record.error ?? `${record.command ?? "Pi RPC command"} failed`, "PI_RPC_FAILED", {
            metadata: {
              command: record.command ?? ""
            }
          })
        );
        return;
      }

      if (record.type === "message_end" && record.message) {
        lastAssistantText = extractAssistantTextFromMessage(record.message) || lastAssistantText;
      }

      if (record.type === "turn_end" && record.message) {
        lastAssistantText = extractAssistantTextFromMessage(record.message) || lastAssistantText;
      }

      if (record.type === "agent_end") {
        const text = extractAssistantText(record.messages) || lastAssistantText;
        resolveOnce(tryParseJsonObject(text));
      }
    };

    child.stdout.on("data", (chunk) => {
      try {
        stdoutBuffer = parseJsonlBuffer(stdoutBuffer + chunk.toString("utf8"), handleRecord);
      } catch (error) {
        rejectOnce(buildError(error.message, "PI_RPC_INVALID_JSONL"));
      }
    });
    child.stderr.on("data", (chunk) => stderrChunks.push(chunk));
    child.on("error", (error) => rejectOnce(buildError(error.message, "PI_RPC_SUBPROCESS_ERROR")));
    child.on("close", (code) => {
      if (settled) {
        return;
      }

      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
      rejectOnce(
        buildError(stderr || `Pi RPC process exited before agent_end with code ${code}`, "PI_RPC_EXITED_EARLY", {
          metadata: { exitCode: code }
        })
      );
    });

    if (timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        rejectOnce(
          buildError(`Pi RPC process timed out after ${timeoutMs}ms`, "PI_RPC_TIMEOUT", {
            timedOut: true
          })
        );
      }, timeoutMs);
    }

    child.stdin.write(`${JSON.stringify({ id: "exodia-prompt", type: "prompt", message: prompt })}\n`);
  });
}

export class PiAgentRuntimeAdapter extends AgentRuntimeAdapter {
  resolveModel() {
    return this.getProviderConfig().model || this.config.model || "";
  }

  async invoke(phase, input) {
    const providerConfig = this.getProviderConfig();
    const cwd = resolveRuntimeWorkingDirectory({
      providerConfig,
      workspaceRoot: this.config.workspaceRoot,
      fallbackCwd: process.cwd()
    });
    const prompt = buildPiRuntimePrompt({
      phase,
      provider: this.provider,
      model: this.model,
      requireStructuredOutput: this.config.requireStructuredOutput,
      toolPolicy: resolvePiToolPolicy(phase, providerConfig),
      payload: input
    });

    return runPiRpcCommand({
      command: providerConfig.command,
      args: buildPiRpcArgs(providerConfig),
      cwd,
      env: buildRuntimeProcessEnv({
        providerConfig,
        injectedEnv: {
          EXODIA_AGENT_RUNTIME_PROVIDER: this.provider,
          EXODIA_AGENT_RUNTIME_PHASE: phase,
          EXODIA_AGENT_RUNTIME_MODEL: this.model ?? "",
          EXODIA_AGENT_RUNTIME_WORKSPACE_ROOT: this.config.workspaceRoot || process.cwd()
        }
      }),
      prompt,
      timeoutMs: providerConfig.timeoutMs ?? 300000,
      provider: this.provider,
      phase,
      model: this.model
    });
  }
}
