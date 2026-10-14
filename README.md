# Exodia

[![CI](https://github.com/ragePolpette/Exodia/actions/workflows/ci.yml/badge.svg)](https://github.com/ragePolpette/Exodia/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Node.js >=22](https://img.shields.io/badge/node-%3E%3D22-339933.svg)

`Exodia` is a local-first orchestration harness for turning technical work items into reviewed, policy-gated engineering actions.

It is not a coding model and it is not a public SaaS service. It is not intended for deployment as a publicly exposed service. Exodia owns the workflow around the model: ticket intake, context loading, memory, clarification, verification, branch hygiene, commit and pull request creation, audit trails, and safe stopping conditions. Coding runtimes such as Codex, OpenAI, Claude, OpenRouter, Ollama, or LM Studio are interchangeable workers behind that control plane.

## Overview

Most ticket-to-code demos collapse the whole job into one risky step: read a ticket, edit files, open a pull request. Exodia splits that into explicit stages.

The stages are:

1. read the ticket from the configured source
2. map it to a target product and repository
3. load connected context, memory, and optional SQL diagnostics
4. produce a structured implementation proposal
5. audit the proposal before any write action
6. execute only inside the configured target worktree
7. verify the implementation evidence
8. commit, push, and open a pull request only when policy allows it
9. report what happened through structured logs and final summaries

The strongest workflow feature is the human-in-the-loop resume loop. When confidence is too low, Exodia can ask a focused question through the configured interaction transports, including Slack or ticket comments, persist the run as waiting for input, resume on a later run from the first valid answer, and store useful answers into memory.

## Capabilities

- Jira-style ticket intake through mock or MCP adapters
- target routing by project key, scope aliases, and configured repository rules
- provider-agnostic agent runtime with structured contracts for analysis, audit, implementation, and implementation verification
- MCP-ready integrations for Jira, context retrieval, memory, SQL diagnostics, and Bitbucket
- controlled execution with allowlisted repositories, base branches, commands, and trust levels
- target worktree hygiene before branch creation
- skip memory for tickets that were already rejected or require human review
- Bitbucket pull request creation and best-effort ticket comments after PR creation
- public hygiene scans, redaction, and publish-readiness checks
- deferred interaction tracking for human clarification loops, accepted only from configured `interaction.allowedResponders`
- per-phase runtime sandbox, diff gate, and allowlisted commit staging before any pull request
- structured run logging, final reports, and local monitoring
- scheduling profiles and direct `run`, `triage`, and `execute` commands with lock-file protection (`--ignore-lock` to bypass)

## Architecture

```text
Ticket source
  -> Jira adapter (mock | mcp)
  -> TriageAgent
       -> llm-context adapter
       -> ticket memory
       -> llm-memory adapter
       -> optional SQL diagnostics
       -> optional human clarification request
  -> VerificationAgent
       -> payload checks
       -> path policy
       -> command preflight
       -> public hygiene scan
       -> optional human clarification request
  -> ExecutionAgent
       -> target worktree preparation
       -> implementation runtime
       -> implementation verification
       -> Bitbucket adapter (mock | mcp)
       -> optional ticket comment
  -> Reports
       -> triage report
       -> execution report
       -> final report
       -> audit trail
```

Main areas:

- `src/orchestration/`: top-level run orchestration
- `src/agents/`: triage, verification, execution, and implementation verification stages
- `src/agent-runtime/`: provider adapters and runtime process policy
- `src/adapters/`: external integration boundaries
- `src/interaction/`: deferred question and answer loop
- `src/mcp/`: MCP bridge and client glue
- `src/security/`: redaction and public hygiene scanning
- `src/logging/`: structured run logging
- `src/monitoring/`: local run summary and JSONL log monitoring
- `src/scheduling/`: manual scheduling profiles with lock protection
- `src/reporting/`: final report rendering
- `config/`: publishable example configurations only

## Security

Exodia is designed to stop rather than improvise when the workflow is ambiguous or unsafe.

Guard rails include:

- dry-run first configuration examples
- `allowMerge` blocked by default
- `allowRealPrs` requiring explicit enablement
- trust-level separation between `mock`, `mcp-readonly`, and `mcp-write`
- allowlists for repositories and base branches
- target worktree preparation before creating or reusing a ticket branch: fetch, dirty check, and `checkout -B <branch> origin/<base>`
- automatic `git reset --hard` and `git clean -fd` of the ticket worktree (never of the Exodia repository) when a ticket is blocked or fails after branch creation
- commits stage only the paths allowed by `verification.allowedPathPrefixesByRepo`; a ticket without allowed changes fails instead of opening an empty pull request
- no-op detection when an implementation produces no changed files
- diff gate with configurable file and line limits, and a `git diff --stat` in reports and pull requests
- read-only runtime sandbox for every phase except real implementation
- ticket content delimited as untrusted data in every runtime prompt
- human approvals and clarifications accepted only from `interaction.allowedResponders`
- runtime process timeout cleanup, with process tree termination on Windows
- public hygiene scanning for sensitive strings and unsafe example values
- redaction across reports, logs, and memory payloads
- deferred human clarification when confidence is insufficient
- public-safe documentation and example configuration defaults

This repository must stay free of real credentials, local runtime configs, run logs, customer data, and private operational handoffs. See [SECURITY.md](SECURITY.md) for scope and reporting.

## Human Approval and Authorized Responders

Interaction answers coming from Jira comments or Slack threads are only accepted when their author is listed in `interaction.allowedResponders`. Entries are matched case-insensitively against the Jira `accountId`, the email address, or the display name (Slack user ids work the same way). An empty list, which is the default, means that nobody can approve or answer through the interaction channels.

```json
"interaction": {
  "enabled": true,
  "allowedResponders": ["557058:00000000-0000-0000-0000-000000000000", "release-lead@example.invalid"]
}
```

Additional rules:

- candidate approvals require an explicit command at the start of the comment: `/exodia approve` or `/exodia reject`. The bare words `approve` and `reject` are also accepted when they are the first word of the comment. Informal replies such as `ok`, `go`, `yes`, or `no` are ignored.
- clarifications can be prefixed with `/exodia answer`; the prefix is removed before the answer is used.
- responses with a missing or unparsable timestamp, or written before the question was posted, are rejected.
- the accepted author, timestamp, and source are stored in the workflow state (`approval.respondedBy`, `approval.respondedAt`, `approval.responseSource`) and listed under `Human approvals` in the final report.
- a clarification can only clear blockers of type `needs_clarification`. Product or repository targets suggested by a comment, or by the model, must exist in `targeting.rules`, `verification.allowedPathPrefixesByRepo`, or `execution.allowedRepositories`; otherwise the ticket is blocked.
- the confidence reported by a model never raises the heuristic confidence; the lower value is used.

## Worktree Lifecycle and Diff Gate

In real execution Exodia prepares the ticket worktree through the Bitbucket bridge:

1. `git fetch origin <base>` and a dirty check; the run aborts when the worktree has uncommitted changes
2. `git checkout -B <ticket-branch> origin/<base>`
3. implementation and verification inside that worktree
4. preflight: public hygiene scan, path policy, diff gate, and allowlisted commands
5. commit of the allowlisted paths only, then push and pull request

When a ticket is blocked or fails after the branch was created, the bridge runs `git reset --hard` and `git clean -fd` in the ticket worktree. The bridge refuses to run these operations on the Exodia repository and never falls back to the current directory: `execution.workspaceRoot` (or the Bitbucket adapter `workspaceRoot`) is required. A relative `execution.workspaceRoot` is resolved from the config file directory.

Path policy is deny by default: when `verification.allowedPathPrefixesByRepo` has no entry for the target repository (and no `default` entry), real execution is blocked and every changed path is rejected.

Diff gate and preflight settings:

```json
"verification": {
  "allowedPathPrefixesByRepo": { "core-app": ["src", "tests"] },
  "allowedCommandPrefixes": [["npm", "test"], ["npm", "run", "lint"]],
  "preflightCommands": [{ "label": "unit-tests", "command": "npm", "args": ["test"], "timeoutMs": 300000 }],
  "preflightTimeoutMs": 300000,
  "preflightMaxBufferBytes": 10485760,
  "diffGate": { "enabled": true, "maxFiles": 25, "maxChangedLines": 1000 }
}
```

- `allowedCommandPrefixes` must be non-empty for real execution and whenever preflight commands are configured. The default allows `npm test`, `npm run lint`, and `node --test`.
- each preflight command is killed after `timeoutMs` (default `preflightTimeoutMs`) and blocked when its output exceeds `preflightMaxBufferBytes`.
- the diff gate counts tracked and untracked changes; the resulting `git diff --stat` is attached to the execution result, the execution report, and the pull request description.

In dry-run, the implementation phase is skipped unless the runtime is `mock` or `execution.dryRunImplementation` is set to `true`, so a dry-run never edits the checked out base branch by default.

## Quick Start

Requirements:

- Node.js 22+
- PowerShell, only when using `scripts/run-exodia.ps1`
- a local config derived from one of the example files under `config/`

Install dependencies:

```bash
npm ci
```

Run the test suite:

```bash
npm test
```

Run the safe mock harness:

```bash
npm run dry-run
```

Useful direct commands:

```bash
node src/cli.js --help
node src/cli.js triage --config ./config/harness.config.example.json --dry-run
node src/cli.js run --config ./config/harness.config.example.json --dry-run
node src/cli.js execute --config ./config/harness.config.example.json --dry-run --report execution
node src/cli.js audit --config ./config/harness.config.example.json
node src/cli.js review --config ./config/harness.config.example.json
node src/cli.js questions --config ./config/harness.config.example.json
node src/cli.js monitor --config ./config/harness.config.example.json --limit 20
node src/cli.js schedule-run --config ./config/harness.config.example.json --profile triage
```

## EXODIA.md

`EXODIA.md` is the per-worktree instruction file that tells the Exodia agent how to operate inside a specific target product repository. Without it, the agent has no rules for naming branches, committing, or validating its own output.

It lives in the **target product worktree** (not in this repository). It is git-ignored here because it contains local paths and product-specific conventions.

Create it by copying the provided example:

```bash
cp EXODIA.md.example EXODIA.md
```

Then edit `EXODIA.md` to match your target worktree conventions: branch naming rules, commit message format, and what counts as a valid implementation for that product. `EXODIA.md.example` shows the expected structure.

## Configuration

Publishable example configs:

- `config/harness.config.example.json`
- `config/harness.config.mcp.example.json`
- `config/harness.config.real.example.json`
- `config/harness.config.triage.codex-local.example.json`
- `config/harness.config.pi.example.json`
- `config/codex.mcp.reference.toml`

Real values belong only in untracked local files, for example:

- `config/local/harness.local.json`
- `config/local/harness.mcp.local.json`
- `config/local/harness.real.local.json`
- `config/codex.mcp.local.toml`
- `EXODIA.md`

The ignored runtime data area is `data/`.

Do not use file `.env`. Do not use file `.env.local`.
Pass credentials through your launcher session, MCP dashboard, secret manager, or a deliberately scoped local process environment.

## Agent Runtime Providers

Exodia keeps coding runtimes behind a small structured contract.

Supported provider adapters include:

- `codex-cli`
- `openai`
- `claude`
- `openrouter`
- `ollama`
- `lmstudio`
- `pi`
- `mock`

The `codex-cli` provider expects a local command that:

1. reads one JSON envelope from stdin
2. returns one JSON object on stdout
3. uses `EXODIA_AGENT_RUNTIME_PHASE` to distinguish `analysis`, `audit`, `implementation`, and `implementation_verification`

For a local Codex-driven setup, configure `agentRuntime.provider = "codex-cli"` in an untracked config and point `agentRuntime.providers["codex-cli"].command` to your wrapper.

This repository includes a wrapper at `scripts/agent-runtime-codex-wrapper.mjs`.

The `codex-cli` provider only forwards a fixed allowlist of environment variables to the wrapper: the basic system variables, `CODEX_HOME`, `OPENAI_API_KEY`, and `EXODIA_CODEX_COMMAND`, `EXODIA_CODEX_MODEL`, `EXODIA_CODEX_PROFILE`, `EXODIA_CODEX_SANDBOX`, `EXODIA_CODEX_TIMEOUT_MS`, `EXODIA_CODEX_KEEP_TEMP`, `EXODIA_CODEX_USE_OSS`, `EXODIA_CODEX_LOCAL_PROVIDER`. Values in `agentRuntime.providers["codex-cli"].env` are applied only for keys in that list. Other providers, such as `pi`, accept an explicit `envPassthrough` list.

The Codex sandbox is chosen per phase:

- `analysis`, `audit`, and `implementation_verification` always run with `--sandbox read-only`
- `implementation` runs with `--sandbox workspace-write` only in real execution, and `read-only` in dry-run
- `EXODIA_CODEX_SANDBOX` can only force `read-only`; any other value is ignored

Recommended local wiring:

- `command = "node"`
- `args = ["./scripts/agent-runtime-codex-wrapper.mjs"]`
- `env.EXODIA_CODEX_COMMAND = "codex"`
- optional `env.EXODIA_CODEX_MODEL`
- optional `env.EXODIA_CODEX_USE_OSS = "true"`
- optional `env.EXODIA_CODEX_LOCAL_PROVIDER = "ollama"` or `"lmstudio"`

For direct API runs, switch the untracked config to the desired provider and set credentials outside repository files.

### MCP Bridge Environment and Retries

The external MCP bridge (`mcpBridge.mode = "external"`) no longer inherits the full process environment. It receives the basic system variables plus the names listed in `mcpBridge.envPassthrough`, so list there the variables your MCP servers need (for example their access tokens). Retries (`mcpBridge.retries`) apply only to the read-only actions listed in `mcpBridge.retryableActions`; write actions such as commits, pushes, pull requests, and comments are never retried.

For local HTTP-compatible runs:

- `ollama` defaults to `http://127.0.0.1:11434/v1`
- `lmstudio` defaults to `http://127.0.0.1:1234/v1`
- both expect a running local server and a configured model name
- keep local test token limits conservative so slow local models do not stall the whole run

## Development

Treat this repository as the harness, not as the target product. The target product worktree is supplied by configuration and can be somewhere else entirely.

```bash
npm ci
npm run lint
npm test
node src/cli.js audit --config ./config/harness.config.example.json
node src/cli.js review --config ./config/harness.config.example.json
```

`npm test` runs the Node.js built-in test runner (`node --test`). `npm run lint` runs ESLint with the flat config in `eslint.config.js`; CI runs both. `audit` and `review` check public hygiene and publish readiness. Contribution rules are in [CONTRIBUTING.md](CONTRIBUTING.md).

Before changing Exodia itself:

1. Check repository state with `git status --short --branch`.
2. Read the relevant source and tests before editing.
3. Keep changes scoped to the harness behavior being improved.
4. Use example configs for publishable defaults and local configs for real paths or credentials.
5. Do not commit run artifacts, memory stores, local handoffs, customer-specific notes, or generated LLM transcripts.
6. Run `npm test` after behavior changes.
7. Run `review` before publishing-facing changes.

When working on a target ticket through Exodia:

1. Confirm the configured target worktree, base branch, allowed repository, and trust level.
2. Let Exodia read ticket, context, memory, and diagnostics through its adapters.
3. Require a structured analysis and audit before implementation.
4. Prefer stopping for human clarification over patching from weak assumptions.
5. Let Exodia own branch naming, commit creation, push, pull request creation, ticket comments, memory, and reporting.

For real execution, use an untracked config and verify these fields before running:

- `execution.enabled`
- `execution.dryRun`
- `execution.trustLevel`
- `execution.baseBranch`
- `execution.allowedRepositories`
- `execution.allowedBaseBranches`
- `execution.workspaceRoot`
- `adapters.bitbucket.mcp.workspaceRoot`
- `agentRuntime.providers.*.workingDirectory`
- `verification.allowedPathPrefixesByRepo`
- `verification.allowedCommandPrefixes`
- `verification.diffGate`
- `interaction.allowedResponders`
- `mcpBridge.envPassthrough`

### Publishing Hygiene

Keep publishable commits and examples generic. Ticket IDs can be used as opaque placeholders, but customer names, local paths, private URLs, database identifiers, credentials, pasted ticket payloads, run logs, and generated transcripts do not belong in this repository.

## Project Status

Exodia is in active development and is not published as an installable package (`private: true` in `package.json`). The current runtime covers local ticket triage, policy-gated implementation, MCP-backed context, human clarification, and structured reporting.

The next planned direction is unattended operation: recurring runs that first drain actionable pull request follow-up work, then move to new ticket intake only when the existing review queue is clear. This is not implemented yet.

Built with AI-assisted workflows, while architecture, tradeoffs, integration choices, review, and validation are directed by the author.

## License

MIT. See [LICENSE](LICENSE).
