#!/usr/bin/env node

import path from "node:path";
import process from "node:process";

import { handleBridgeRequest } from "./bridge-core.js";

function readJsonFromStdin() {
  return new Promise((resolve, reject) => {
    let buffer = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      buffer += chunk;
    });
    process.stdin.on("end", () => {
      try {
        resolve(JSON.parse(buffer));
      } catch (error) {
        reject(error);
      }
    });
    process.stdin.on("error", reject);
  });
}

function parseArgs(argv) {
  const options = {
    registryFile: path.resolve(process.cwd(), "config", "codex.mcp.reference.toml"),
    shadowMemoryFile: path.resolve(process.cwd(), "data", "mcp-memory-shadow.json")
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--registry" && argv[index + 1]) {
      options.registryFile = path.resolve(process.cwd(), argv[index + 1]);
      index += 1;
      continue;
    }

    if (value === "--shadow-memory-file" && argv[index + 1]) {
      options.shadowMemoryFile = path.resolve(process.cwd(), argv[index + 1]);
      index += 1;
    }
  }

  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const request = await readJsonFromStdin();
  const response = await handleBridgeRequest({
    ...options,
    request
  });
  process.stdout.write(JSON.stringify(response));
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
