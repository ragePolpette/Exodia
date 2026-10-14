import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir, access } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { handleBridgeRequest, parsePorcelainZ } from "../src/mcp/bridge-core.js";

const execFileAsync = promisify(execFile);
const exodiaRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function git(cwd, args) {
  const { stdout } = await execFileAsync("git", args, { cwd, windowsHide: true });
  return stdout.trim();
}

async function createWorktreeFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "exodia-bridge-worktree-"));
  const origin = path.join(root, "origin.git");
  const seed = path.join(root, "seed");
  const worktree = path.join(root, "worktree");
  const registryFile = path.join(root, "registry.toml");

  await git(root, ["init", "--bare", "--initial-branch=main", origin]);
  await mkdir(seed);
  await git(seed, ["init", "--initial-branch=main"]);
  await git(seed, ["config", "user.email", "exodia@example.invalid"]);
  await git(seed, ["config", "user.name", "Exodia Test"]);
  await mkdir(path.join(seed, "src"));
  await writeFile(path.join(seed, "src", "app.js"), "export const value = 1;\n");
  await writeFile(path.join(seed, "README.md"), "seed\n");
  await git(seed, ["add", "-A"]);
  await git(seed, ["commit", "-m", "seed"]);
  await git(seed, ["remote", "add", "origin", origin]);
  await git(seed, ["push", "origin", "main"]);
  await git(root, ["clone", origin, worktree]);
  await git(worktree, ["config", "user.email", "exodia@example.invalid"]);
  await git(worktree, ["config", "user.name", "Exodia Test"]);
  await writeFile(registryFile, "[mcp_servers.llm_bitbucket_mcp]\ncommand = \"node\"\n");

  const request = (action, payload) =>
    handleBridgeRequest({
      registryFile,
      request: { server: "llm_bitbucket_mcp", action, payload }
    });

  return { root, seed, worktree, request };
}

test("createBranch fetches and resets the ticket branch onto origin/base", async () => {
  const { seed, worktree, request } = await createWorktreeFixture();
  await writeFile(path.join(seed, "src", "app.js"), "export const value = 2;\n");
  await git(seed, ["commit", "-am", "upstream change"]);
  await git(seed, ["push", "origin", "main"]);
  const upstreamHead = await git(seed, ["rev-parse", "HEAD"]);

  await request("createBranch", { workspaceRoot: worktree, branchName: "fix/GEN-1-demo", baseBranch: "main" });

  assert.equal(await git(worktree, ["rev-parse", "--abbrev-ref", "HEAD"]), "fix/GEN-1-demo");
  assert.equal(await git(worktree, ["rev-parse", "HEAD"]), upstreamHead);
});

test("createBranch and checkoutBranch abort when the ticket worktree is dirty", async () => {
  const { worktree, request } = await createWorktreeFixture();
  await writeFile(path.join(worktree, "src", "stray.js"), "leftover\n");

  await assert.rejects(
    request("createBranch", { workspaceRoot: worktree, branchName: "fix/GEN-2-demo", baseBranch: "main" }),
    /uncommitted changes/
  );
  await assert.rejects(
    request("checkoutBranch", { workspaceRoot: worktree, branchName: "main" }),
    /uncommitted changes/
  );
  assert.equal(await git(worktree, ["rev-parse", "--abbrev-ref", "HEAD"]), "main");
});

test("createCommit stages only allowlisted paths and leaves the rest untouched", async () => {
  const { worktree, request } = await createWorktreeFixture();
  await request("createBranch", { workspaceRoot: worktree, branchName: "fix/GEN-3-demo", baseBranch: "main" });
  await writeFile(path.join(worktree, "src", "app.js"), "export const value = 3;\n");
  await writeFile(path.join(worktree, "README.md"), "changed outside allowlist\n");
  await writeFile(path.join(worktree, ".env"), "SECRET=1\n");

  const result = await request("createCommit", {
    workspaceRoot: worktree,
    commitMessage: "fix(GEN-3): demo",
    allowedPaths: ["src"]
  });

  assert.equal(result.skipped, undefined);
  assert.deepEqual(result.committedPaths, ["src/app.js"]);
  assert.deepEqual(result.ignoredPaths.sort(), [".env", "README.md"]);
  assert.equal(await git(worktree, ["show", "--name-only", "--format=", "HEAD"]), "src/app.js");
});

test("createCommit reports skipped when no allowlisted change exists", async () => {
  const { worktree, request } = await createWorktreeFixture();
  await writeFile(path.join(worktree, "README.md"), "changed outside allowlist\n");

  const result = await request("createCommit", {
    workspaceRoot: worktree,
    commitMessage: "fix(GEN-4): nothing",
    allowedPaths: ["src"]
  });

  assert.equal(result.skipped, true);
  assert.equal(await git(worktree, ["rev-list", "--count", "HEAD"]), "1");
});

test("createCommit refuses an empty allowlist", async () => {
  const { worktree, request } = await createWorktreeFixture();
  await writeFile(path.join(worktree, "src", "app.js"), "export const value = 5;\n");

  await assert.rejects(
    request("createCommit", { workspaceRoot: worktree, commitMessage: "x", allowedPaths: [] }),
    /non-empty allowedPaths/
  );
});

test("resetWorkspace discards tracked and untracked changes in the ticket worktree", async () => {
  const { worktree, request } = await createWorktreeFixture();
  await writeFile(path.join(worktree, "src", "app.js"), "broken\n");
  await writeFile(path.join(worktree, "src", "new-file.js"), "new\n");

  await request("resetWorkspace", { workspaceRoot: worktree, branchName: "fix/GEN-6-demo" });

  assert.equal(await git(worktree, ["status", "--porcelain"]), "");
  assert.equal(await readFile(path.join(worktree, "src", "app.js"), "utf8"), "export const value = 1;\n");
  await assert.rejects(access(path.join(worktree, "src", "new-file.js")));
});

test("worktree git actions never fall back to the current directory", async () => {
  const { request } = await createWorktreeFixture();
  for (const action of ["createBranch", "checkoutBranch", "createCommit", "pushBranch", "resetWorkspace"]) {
    await assert.rejects(
      request(action, { branchName: "fix/GEN-7-demo", baseBranch: "main", allowedPaths: ["src"] }),
      /requires payload\.workspaceRoot/
    );
  }
});

test("worktree git actions refuse to operate on the Exodia repository", async () => {
  const { request } = await createWorktreeFixture();
  await assert.rejects(
    request("resetWorkspace", { workspaceRoot: exodiaRoot }),
    /Exodia repository itself/
  );
});

test("parsePorcelainZ keeps both sides of a rename", () => {
  assert.deepEqual(parsePorcelainZ("R  src/new.js\0src/old.js\0?? docs/a b.md\0"), [
    "src/new.js",
    "src/old.js",
    "docs/a b.md"
  ]);
});
