import { access } from "node:fs/promises";

export async function resolveWorkspaceRootForChecks(config, fallbackWorkspaceRoot = process.cwd()) {
  const candidates = [
    config.verification?.sensitiveScan?.workspaceRoot,
    config.execution?.workspaceRoot,
    fallbackWorkspaceRoot
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // try the next candidate
    }
  }

  return fallbackWorkspaceRoot;
}
