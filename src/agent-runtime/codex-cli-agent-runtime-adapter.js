import { spawn } from "node:child_process";
import { AgentRuntimeAdapter } from "./agent-runtime-adapter.js";

function runJsonCommand({ command, args, cwd, env, input, timeoutMs }) {
  return new Promise((resolve, reject) => {
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

    child.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk) => stderrChunks.push(chunk));
    child.on("error", rejectOnce);

    child.on("close", (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString("utf8").trim();
      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();

      if (code !== 0) {
        rejectOnce(new Error(stderr || stdout || `agent runtime subprocess exited with code ${code}`));
        return;
      }

      try {
        resolveOnce(JSON.parse(stdout || "{}"));
      } catch (error) {
        rejectOnce(new Error(`agent runtime subprocess did not return valid JSON: ${error.message}`));
      }
    });

    if (timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        child.kill();
        rejectOnce(new Error(`agent runtime subprocess timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    }

    child.stdin.write(JSON.stringify(input));
    child.stdin.end();
  });
}

export class CodexCliAgentRuntimeAdapter extends AgentRuntimeAdapter {
  async invoke(phase, input) {
    const providerConfig = this.getProviderConfig();
    return runJsonCommand({
      command: providerConfig.command,
      args: providerConfig.args ?? [],
      cwd: providerConfig.workingDirectory || process.cwd(),
      env: {
        ...process.env,
        ...(providerConfig.env ?? {}),
        EXODIA_AGENT_RUNTIME_PROVIDER: this.provider,
        EXODIA_AGENT_RUNTIME_PHASE: phase,
        EXODIA_AGENT_RUNTIME_MODEL: this.model ?? ""
      },
      input: {
        phase,
        provider: this.provider,
        model: this.model,
        requireStructuredOutput: this.config.requireStructuredOutput,
        payload: input
      },
      timeoutMs: providerConfig.timeoutMs ?? 120000
    });
  }
}
