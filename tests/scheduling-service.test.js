import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { resolveScheduleProfile, withRunLock } from "../src/scheduling/scheduling-service.js";

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
  const workspace = await mkdtemp(path.join(os.tmpdir(), "malkuth-lock-"));
  const lockFile = path.join(workspace, "run.lock");

  await mkdir(path.dirname(lockFile), { recursive: true });
  await writeFile(lockFile, "{}");

  await assert.rejects(
    () => withRunLock(lockFile, async () => {}),
    /holding the lock file/i
  );
});

test("withRunLock acquires and releases the lock around the callback", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "malkuth-lock-cycle-"));
  const lockFile = path.join(workspace, "run.lock");
  let executed = false;

  await withRunLock(lockFile, async () => {
    executed = true;
  });

  assert.equal(executed, true);
});
