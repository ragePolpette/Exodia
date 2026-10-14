# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Security

- Interaction answers are accepted only from authors listed in `interaction.allowedResponders` (Jira account id, email, or display name). The list is empty by default, so no human answer or approval is accepted until it is configured.
- Candidate approvals require an anchored command: `/exodia approve` or `/exodia reject`, or the bare words `approve` and `reject` as the first word of the comment. Informal replies such as `ok`, `go`, `yes`, `no`, and the Italian keywords are no longer accepted.
- Responses with a missing or unparsable timestamp, or older than the question, are rejected instead of being treated as current.
- The accepted approver, timestamp, and source are stored in the workflow state (`approval.respondedBy`, `approval.respondedAt`, `approval.responseSource`) and listed in the final report.
- A clarification no longer clears every blocker: only blockers of type `needs_clarification` can be cleared. Product and repository targets coming from comments or from model output must belong to `targeting.rules`, `verification.allowedPathPrefixesByRepo`, or `execution.allowedRepositories`; otherwise the ticket is blocked.
- Model confidence can no longer raise the heuristic confidence (the lower value is used), and the model can no longer upgrade a low-confidence or blocked feasibility.
- Runtime prompts for Codex, Pi, and the HTTP providers delimit the ticket payload as untrusted data and instruct the model not to follow instructions found inside it.
- Path policy is deny by default: a repository without an `allowedPathPrefixesByRepo` entry rejects every changed path, and real execution is blocked before touching git.
- The Codex sandbox is selected per phase: `read-only` for analysis, audit, and implementation verification, `workspace-write` only for implementation in real execution. `EXODIA_CODEX_SANDBOX` can only force `read-only`. The Pi implementation tool policy is read-only outside real execution.
- Redaction now covers `sk-` API keys, `Bearer` and `Basic` credentials, AWS access keys, Atlassian and Bitbucket tokens, GitHub and Slack tokens, private keys, and email addresses. Runtime diagnostics (`message`, `args`, `stdoutTail`, `stderrTail`) are redacted before reaching artifacts, logs, and pull requests.
- The external MCP bridge no longer inherits the whole process environment; it receives the basic system variables plus `mcpBridge.envPassthrough`.
- The public hygiene scan always includes default secret patterns, even when the configuration passes empty pattern lists.

### Changed

- Worktree lifecycle in real execution: the Bitbucket bridge runs `git fetch`, aborts on a dirty worktree, and creates the ticket branch with `git checkout -B <branch> origin/<base>`. Blocked or failed tickets trigger `git reset --hard` and `git clean -fd` on the ticket worktree only; the bridge refuses to operate on the Exodia repository.
- Commits stage only the allowlisted paths (`git add -- <paths>`). When no allowlisted change exists the ticket fails and no empty pull request is opened.
- Execution never falls back to `process.cwd()`: `execution.workspaceRoot` or the Bitbucket adapter `workspaceRoot` is required, and bridge git actions require `payload.workspaceRoot`. A relative `execution.workspaceRoot` is now resolved from the config file directory.
- Dry-run skips the implementation phase unless the runtime is `mock` or `execution.dryRunImplementation` is `true`.
- New diff gate (`verification.diffGate`, default 25 files and 1000 changed lines). The `git diff --stat` is attached to execution results, the execution report, and the pull request description.
- Preflight commands run with a timeout (`preflightTimeoutMs` or per-command `timeoutMs`, default 300000 ms) and a bounded output buffer (`preflightMaxBufferBytes`, default 10 MB).
- `verification.allowedCommandPrefixes` defaults to `npm test`, `npm run lint`, and `node --test`. An empty allowlist now blocks real execution and any configured preflight command instead of allowing every command.
- Direct `run`, `triage`, and `execute` commands now use the run lock file (`scheduling.lockFile`); `--ignore-lock` bypasses it.
- MCP bridge retries apply only to read-only actions listed in `mcpBridge.retryableActions`; commits, pushes, pull requests, and comments are never retried. Bridge timeouts terminate the whole process tree on Windows.
- A failed or blocked ticket no longer stops the execution queue; the remaining tickets are processed and every outcome is reported. Unexpected errors in a single ticket are reported as `failed`.

### Fixed

- `withRunLock` no longer deletes a lock file owned by another run when the lock is already held.
- A failing run now always writes a summary (text and JSON) with status, error, and audit trail.
- JSON state files (memory, workflow, interactions, MCP shadow memory) are written atomically through a temporary file and rename.
- Repository overrides parsed from comments drop trailing punctuation.
- Porcelain status parsing in the bridge keeps leading status columns and both sides of renames.

### Tooling

- Added ESLint with a minimal flat config (`npm run lint`), executed in CI before the test suite.
- `package-lock.json` updated with the development dependencies; CI keeps using `npm ci`.
