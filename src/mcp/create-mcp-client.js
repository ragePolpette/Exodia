import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";

function createClientError(code, message, cause) {
  const error = new Error(`[${code}] ${message}`);
  error.code = code;
  error.cause = cause;
  return error;
}

function delay(timeout) {
  return new Promise((resolve) => {
    setTimeout(resolve, timeout);
  });
}

class FixtureMcpClient {
  constructor({ fixtures = {}, fixtureFile = "", allowedActionsByServer = {} } = {}) {
    this.fixtures = fixtures;
    this.fixtureFile = fixtureFile;
    this.allowedActionsByServer = allowedActionsByServer;
    this.cache = null;
  }

  assertAllowed(server, action) {
    const allowed = this.allowedActionsByServer?.[server];
    if (!Array.isArray(allowed) || allowed.length === 0) {
      return;
    }

    if (!allowed.includes(action)) {
      throw new Error(`MCP action ${server}.${action} is not allowed by bridge policy`);
    }
  }

  async loadFixtures() {
    if (this.cache) {
      return this.cache;
    }

    if (this.fixtureFile) {
      const raw = await readFile(this.fixtureFile, "utf8");
      this.cache = JSON.parse(raw);
      return this.cache;
    }

    this.cache = this.fixtures;
    return this.cache;
  }

  async request({ server, action, payload }) {
    this.assertAllowed(server, action);
    const fixtures = await this.loadFixtures();
    const baseKey = `${server}.${action}`;
    const phaseKey = payload?.phase ? `${baseKey}.${payload.phase}` : null;
    const key = phaseKey && phaseKey in fixtures ? phaseKey : baseKey;
    if (!(key in fixtures)) {
      throw createClientError("MCP_FIXTURE_MISSING", `Missing MCP fixture response for ${key}`);
    }

    return fixtures[key];
  }
}

class ExternalCommandMcpClient {
  constructor({
    command = "",
    args = [],
    allowedActionsByServer = {},
    timeoutMs = 30000,
    retries = 0,
    retryDelayMs = 250
  } = {}) {
    this.command = command;
    this.args = args;
    this.allowedActionsByServer = allowedActionsByServer;
    this.timeoutMs = timeoutMs;
    this.retries = retries;
    this.retryDelayMs = retryDelayMs;
  }

  assertAllowed(server, action) {
    const allowed = this.allowedActionsByServer?.[server];
    if (!Array.isArray(allowed) || allowed.length === 0) {
      return;
    }

    if (!allowed.includes(action)) {
      throw new Error(`MCP action ${server}.${action} is not allowed by bridge policy`);
    }
  }

  async request(request) {
    if (!this.command) {
      throw createClientError("MCP_BRIDGE_NOT_CONFIGURED", "MCP external command bridge is not configured");
    }

    this.assertAllowed(request.server, request.action);

    let lastError = null;
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      try {
        return await this.executeRequest(request);
      } catch (error) {
        lastError = error;
        if (attempt >= this.retries || !["MCP_BRIDGE_TIMEOUT", "MCP_BRIDGE_FAILED"].includes(error.code)) {
          throw error;
        }

        await delay(this.retryDelayMs);
      }
    }

    throw lastError;
  }

  async executeRequest(request) {
    return new Promise((resolve, reject) => {
      const child = spawn(this.command, this.args, {
        stdio: ["pipe", "pipe", "pipe"]
      });

      let stdout = "";
      let stderr = "";
      const timeoutHandle = setTimeout(() => {
        child.kill();
        reject(
          createClientError(
            "MCP_BRIDGE_TIMEOUT",
            `MCP bridge timed out after ${this.timeoutMs}ms for ${request.server}.${request.action}`
          )
        );
      }, this.timeoutMs);

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", (error) => {
        clearTimeout(timeoutHandle);
        reject(createClientError("MCP_BRIDGE_FAILED", error.message, error));
      });
      child.on("close", (code) => {
        clearTimeout(timeoutHandle);
        if (code !== 0) {
          reject(createClientError("MCP_BRIDGE_FAILED", `MCP bridge failed (${code}): ${stderr || stdout}`));
          return;
        }

        try {
          resolve(JSON.parse(stdout));
        } catch (error) {
          reject(createClientError("MCP_BRIDGE_INVALID_RESPONSE", error.message, error));
        }
      });

      child.stdin.write(JSON.stringify(request));
      child.stdin.end();
    });
  }
}

export function createMcpClient(config = {}) {
  if (config.mode === "fixture") {
    return new FixtureMcpClient(config);
  }

  if (config.mode === "external") {
    return new ExternalCommandMcpClient(config);
  }

  throw createClientError("MCP_BRIDGE_MODE_UNSUPPORTED", `Unsupported MCP bridge mode: ${config.mode}`);
}
