import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { resolveScheduleProfile, withRunLock } from "../src/scheduling/scheduling-service.js";

const execFileAsync = promisify(execFile);
const cliPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "cli.js");

test("resolveScheduleProfile returns the configured manual profile", () => {
  const profile = resolveScheduleProfile(
    {
      profiles: {
        triage: {
          command: "triage",
          dryRun: true,
          executionEnabled: false,
          report: "default"
        }
      }
    },
    "triage"
  );

  assert.equal(profile.name, "triage");
  assert.equal(profile.command, "triage");
  assert.equal(profile.dryRun, true);
  assert.equal(profile.executionEnabled, false);
});

test("withRunLock prevents concurrent runs when the lock file already exists", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "exodia-lock-"));
  const lockFile = path.join(workspace, "run.lock");

  await mkdir(path.dirname(lockFile), { recursive: true });
  await writeFile(lockFile, "{}");

  await assert.rejects(
    () => withRunLock(lockFile, async () => {}),
    /holding the lock file/i
  );
});

test("withRunLock acquires and releases the lock around the callback", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "exodia-lock-cycle-"));
  const lockFile = path.join(workspace, "run.lock");
  let executed = false;

  await withRunLock(lockFile, async () => {
    executed = true;
  });

  assert.equal(executed, true);
});

test("withRunLock does not delete a lock file held by another run", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "exodia-lock-foreign-"));
  const lockFile = path.join(workspace, "run.lock");
  await writeFile(lockFile, JSON.stringify({ pid: 999999 }));

  await assert.rejects(() => withRunLock(lockFile, async () => {}), /holding the lock file/i);

  assert.equal(await readFile(lockFile, "utf8"), JSON.stringify({ pid: 999999 }));
});

test("withRunLock releases the lock when the callback throws", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "exodia-lock-throw-"));
  const lockFile = path.join(workspace, "run.lock");

  await assert.rejects(() => withRunLock(lockFile, async () => {
    throw new Error("boom");
  }), /boom/);
  await withRunLock(lockFile, async () => {});
});

for (const command of ["run", "triage", "execute"]) {
  test(`cli ${command} refuses to start while another run holds the lock`, async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), `exodia-cli-lock-${command}-`));
    const configPath = path.join(workspace, "harness.config.json");
    const lockFile = path.join(workspace, "run.lock");
    await writeFile(
      configPath,
      JSON.stringify({ mode: "triage-only", memory: { filePath: "./memory.json" }, scheduling: { lockFile: "./run.lock" } })
    );
    await writeFile(lockFile, "{}");

    const result = await execFileAsync(process.execPath, [cliPath, command, "--config", configPath, "--dry-run"], {
      cwd: workspace
    }).catch((error) => error);

    assert.equal(result.code, 1);
    assert.match(result.stderr, /holding the lock file/);
    assert.equal(await readFile(lockFile, "utf8"), "{}");
  });
}

test("cli run acquires and releases the run lock", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "exodia-cli-lock-release-"));
  const configPath = path.join(workspace, "harness.config.json");
  await writeFile(
    configPath,
    JSON.stringify({ mode: "triage-only", memory: { filePath: "./memory.json" }, scheduling: { lockFile: "./run.lock" } })
  );

  await execFileAsync(process.execPath, [cliPath, "triage", "--config", configPath, "--dry-run"], { cwd: workspace });

  await assert.rejects(readFile(path.join(workspace, "run.lock"), "utf8"), /ENOENT/);
});
