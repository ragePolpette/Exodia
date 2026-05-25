import { mkdir, open, rm } from "node:fs/promises";
import path from "node:path";

const supportedScheduledCommands = new Set(["run", "triage", "execute"]);

function ensureObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function normalizeSchedulingConfig(config = {}) {
  const profiles = ensureObject(config.profiles);
  return {
    enabled: config.enabled ?? true,
    lockFile: config.lockFile ?? "./data/run.lock",
    profiles
  };
}

export function resolveScheduleProfile(schedulingConfig = {}, profileName = "") {
  const normalizedName = `${profileName ?? ""}`.trim();
  if (!normalizedName) {
    throw new Error("Scheduled run requires a profile name");
  }

  const profile = schedulingConfig.profiles?.[normalizedName];
  if (!profile) {
    throw new Error(`Unknown scheduling profile: ${normalizedName}`);
  }

  const command = `${profile.command ?? "run"}`.trim();
  if (!supportedScheduledCommands.has(command)) {
    throw new Error(`Unsupported scheduling command: ${command}`);
  }

  return {
    name: normalizedName,
    command,
    dryRun: profile.dryRun,
    executionEnabled: profile.executionEnabled,
    report: profile.report
  };
}

export async function withRunLock(lockFile, callback) {
  const resolvedLockFile = path.resolve(lockFile);
  await mkdir(path.dirname(resolvedLockFile), { recursive: true });

  let handle = null;
  try {
    handle = await open(resolvedLockFile, "wx");
    await handle.writeFile(
      JSON.stringify(
        {
          pid: process.pid,
          acquiredAt: new Date().toISOString()
        },
        null,
        2
      ),
      "utf8"
    );
    await handle.close();
    handle = null;

    return await callback();
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(`Another run is already holding the lock file: ${resolvedLockFile}`);
    }

    throw error;
  } finally {
    try {
      if (handle) {
        await handle.close();
      }
      await rm(resolvedLockFile, { force: true });
    } catch {
      // ignore lock cleanup failures
    }
  }
}
