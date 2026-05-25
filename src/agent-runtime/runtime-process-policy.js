import path from "node:path";

const defaultProcessEnvKeys = [
  "PATH",
  "Path",
  "PATHEXT",
  "SystemRoot",
  "WINDIR",
  "ComSpec",
  "TEMP",
  "TMP",
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA"
];

function unique(values = []) {
  return [...new Set(values.map((value) => `${value ?? ""}`.trim()).filter(Boolean))];
}

function pickEnv(source = {}, allowedKeys = []) {
  const env = {};
  for (const key of allowedKeys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      env[key] = source[key];
    }
  }
  return env;
}

function isPathInside(basePath, candidatePath) {
  const relativePath = path.relative(basePath, candidatePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

export function buildRuntimeProcessEnv({ providerConfig = {}, injectedEnv = {}, processEnv = process.env } = {}) {
  const allowedKeys = unique([
    ...defaultProcessEnvKeys,
    ...(providerConfig.envPassthrough ?? [])
  ]);

  return {
    ...pickEnv(processEnv, allowedKeys),
    ...pickEnv(providerConfig.env, allowedKeys),
    ...injectedEnv
  };
}

export function resolveRuntimeWorkingDirectory({
  providerConfig = {},
  workspaceRoot = "",
  fallbackCwd = process.cwd()
} = {}) {
  const root = path.resolve(workspaceRoot || fallbackCwd);
  const cwd = path.resolve(providerConfig.workingDirectory || root);

  if (!isPathInside(root, cwd)) {
    throw new Error(`AGENT_RUNTIME_CWD_OUTSIDE_WORKSPACE: ${cwd} is outside ${root}`);
  }

  return cwd;
}
