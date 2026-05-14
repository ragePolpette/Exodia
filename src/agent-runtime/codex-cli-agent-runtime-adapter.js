import { spawn } from "node:child_process";
import { AgentRuntimeAdapter } from "./agent-runtime-adapter.js";
import { AgentRuntimeInvocationError, buildRuntimeDiagnostics } from "./runtime-diagnostics.js";

function pickEnv(source = {}, allowedKeys = []) {
  const env = {};
  for (const key of allowedKeys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      env[key] = source[key];
    }
  }
  return env;
}

export function resolveCodexTimeoutSettings(providerConfig = {}, env = {}) {
  const adapterTimeoutMs = Math.max(1000, Number(providerConfig.timeoutMs ?? 120000) || 120000);
  const timeoutGraceMs = Math.max(1000, Number(providerConfig.timeoutGraceMs ?? 30000) || 30000);
  const maxWrapperTimeoutMs =
    adapterTimeoutMs > timeoutGraceMs + 1000
      ? adapterTimeoutMs - timeoutGraceMs
      : adapterTimeoutMs;
  const configuredWrapperTimeoutMs =
    Number(providerConfig.wrapperTimeoutMs ?? env.EXODIA_CODEX_TIMEOUT_MS ?? 0) || 0;
  const wrapperTimeoutMs = Math.max(
    1000,
    Math.min(configuredWrapperTimeoutMs || maxWrapperTimeoutMs, maxWrapperTimeoutMs)
  );

  return {
    adapterTimeoutMs,
    wrapperTimeoutMs,
    timeoutGraceMs
  };
}

function runJsonCommand({ command, args, cwd, env, input, timeoutMs, provider, phase, model }) {
  return new Promise((resolve, reject) => {
    const startedAt = new Date().toISOString();
    const child = spawn(command, args, {
      cwd,
      env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });

    const stdoutChunks = [];
    const stderrChunks = [];
    let settled = false;
    let timeoutHandle = null;

    const finalize = (callback) => (value) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      callback(value);
    };

    const resolveOnce = finalize(resolve);
    const rejectOnce = finalize(reject);
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
          stdout: Buffer.concat(stdoutChunks).toString("utf8"),
          stderr: Buffer.concat(stderrChunks).toString("utf8"),
          startedAt,
          endedAt: new Date().toISOString(),
          ...extras
        })
      });

    child.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk) => stderrChunks.push(chunk));
    child.on("error", (error) => {
      rejectOnce(buildError(error.message, "AGENT_RUNTIME_SUBPROCESS_ERROR"));
    });

    child.on("close", (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString("utf8").trim();
      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();

      if (code !== 0) {
        rejectOnce(
          buildError(
            stderr || stdout || `agent runtime subprocess exited with code ${code}`,
            "AGENT_RUNTIME_SUBPROCESS_FAILED",
            { metadata: { exitCode: code } }
          )
        );
        return;
      }

      try {
        resolveOnce(JSON.parse(stdout || "{}"));
      } catch (error) {
        rejectOnce(
          buildError(
            `agent runtime subprocess did not return valid JSON: ${error.message}`,
            "AGENT_RUNTIME_INVALID_JSON"
          )
        );
      }
    });

    if (timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        child.kill();
        rejectOnce(
          buildError(`agent runtime subprocess timed out after ${timeoutMs}ms`, "AGENT_RUNTIME_TIMEOUT", {
            timedOut: true
          })
        );
      }, timeoutMs);
    }

    child.stdin.write(JSON.stringify(input));
    child.stdin.end();
  });
}

export class CodexCliAgentRuntimeAdapter extends AgentRuntimeAdapter {
  async invoke(phase, input) {
    const providerConfig = this.getProviderConfig();
    const allowedEnv = providerConfig.envPassthrough ?? [];
    const baseEnv = {
      ...pickEnv(process.env, allowedEnv),
      ...pickEnv(providerConfig.env, allowedEnv)
    };
    const timeouts = resolveCodexTimeoutSettings(providerConfig, baseEnv);
    const childEnv = {
      ...baseEnv,
      EXODIA_CODEX_TIMEOUT_MS: `${timeouts.wrapperTimeoutMs}`,
      EXODIA_AGENT_RUNTIME_PROVIDER: this.provider,
      EXODIA_AGENT_RUNTIME_PHASE: phase,
      EXODIA_AGENT_RUNTIME_MODEL: this.model ?? "",
      EXODIA_AGENT_RUNTIME_WORKSPACE_ROOT: this.config.workspaceRoot || process.cwd()
    };
    return runJsonCommand({
      command: providerConfig.command,
      args: providerConfig.args ?? [],
      cwd: providerConfig.workingDirectory || this.config.workspaceRoot || process.cwd(),
      env: childEnv,
      input: {
        phase,
        provider: this.provider,
        model: this.model,
        requireStructuredOutput: this.config.requireStructuredOutput,
        payload: input
      },
      timeoutMs: timeouts.adapterTimeoutMs,
      provider: this.provider,
      phase,
      model: this.model
    });
  }
}
