# Exodia

`Exodia` is a local-first orchestration harness for turning technical work items into reviewed, policy-gated engineering actions.

It is not a coding model and it is not a public SaaS service. It is not intended for deployment as a publicly exposed service. Exodia owns the workflow around the model: ticket intake, context loading, memory, clarification, verification, branch hygiene, commit and pull request creation, audit trails, and safe stopping conditions. Coding runtimes such as Codex, OpenAI, Claude, OpenRouter, Ollama, or LM Studio are interchangeable workers behind that control plane.

## What Makes It Different

Most ticket-to-code demos collapse the whole job into one risky step: read a ticket, edit files, open a pull request.

Exodia splits that into explicit stages:

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

## Current Capabilities

- Jira-style ticket intake through mock or MCP adapters
- target routing by project key, scope aliases, and configured repository rules
- provider-agnostic agent runtime with structured contracts for analysis, audit, implementation, and implementation verification
- MCP-ready integrations for Jira, context retrieval, memory, SQL diagnostics, and Bitbucket
- controlled execution with allowlisted repositories, base branches, commands, and trust levels
- target worktree hygiene before branch creation
- skip memory for tickets that were already rejected or require human review
- Bitbucket pull request creation and best-effort ticket comments after PR creation
- public hygiene scans, redaction, and publish-readiness checks
- deferred interaction tracking for human clarification loops
- structured run logging, final reports, and local monitoring
- scheduling profiles with lock-file protection for manual or unattended runs

Planned follow-up work is tracked outside this public-safe README until it is implemented. In particular, PR-review follow-up modes should be documented here only after the runtime supports them end to end.

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

## Safety Model

Exodia is designed to stop rather than improvise when the workflow is ambiguous or unsafe.

Guard rails include:

- dry-run first configuration examples
- `allowMerge` blocked by default
- `allowRealPrs` requiring explicit enablement
- trust-level separation between `mock`, `mcp-readonly`, and `mcp-write`
- allowlists for repositories and base branches
- target worktree preparation before creating or reusing a ticket branch
- no-op detection when an implementation produces no changed files
- runtime process timeout cleanup
- public hygiene scanning for sensitive strings and unsafe example values
- redaction across reports, logs, and memory payloads
- deferred human clarification when confidence is insufficient
- commit and secret policy hooks for newly initialized repositories

This repository must stay free of real credentials, local runtime configs, run logs, customer data, and private operational handoffs.

## Local Setup

Requirements:

- Node.js 22+
- PowerShell when using the provided helper scripts
- a local config derived from one of the example files under `config/`

Install dependencies:

```bash
npm install
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

Do not use file `.env`.
Do not use file `.env.local`.
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

Recommended local wiring:

- `command = "node"`
- `args = ["./scripts/agent-runtime-codex-wrapper.mjs"]`
- `env.EXODIA_CODEX_COMMAND = "codex"`
- optional `env.EXODIA_CODEX_MODEL`
- optional `env.EXODIA_CODEX_USE_OSS = "true"`
- optional `env.EXODIA_CODEX_LOCAL_PROVIDER = "ollama"` or `"lmstudio"`

For direct API runs, switch the untracked config to the desired provider and set credentials outside repository files.

For local HTTP-compatible runs:

- `ollama` defaults to `http://127.0.0.1:11434/v1`
- `lmstudio` defaults to `http://127.0.0.1:1234/v1`
- both expect a running local server and a configured model name
- keep local test token limits conservative so slow local models do not stall the whole run

## Working On Exodia

Treat this repository as the harness, not as the target product. The target product worktree is supplied by configuration and can be somewhere else entirely.

Before changing Exodia itself:

1. Check repository state with `git status --short --branch`.
2. Read the relevant source and tests before editing.
3. Keep changes scoped to the harness behavior being improved.
4. Use example configs for publishable defaults and local configs for real paths or credentials.
5. Do not commit run artifacts, memory stores, local handoffs, customer-specific notes, or generated LLM transcripts.
6. Run `npm test` after behavior changes.
7. Run `node src/cli.js review --config ./config/harness.config.example.json` before publishing-facing changes.

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

## Repository Policy Hooks

This repository includes policy helpers for commit message and secret hygiene:

- `.githooks/commit-msg`
- `.githooks/pre-commit`
- `policy/COMMIT_AND_SECRET_POLICY.example.md`
- `scripts/install-git-policy-hooks.ps1`

Install the template hooks for future repositories:

```powershell
.\scripts\install-git-policy-hooks.ps1
```

The policy is intentionally strict about commit text. Ticket IDs are acceptable as opaque identifiers; customer names, local paths, private URLs, database identifiers, and pasted ticket payloads are not.

## Project Status

Exodia is in active development. The current runtime is already useful for controlled local ticket triage, policy-gated implementation, MCP-backed context, human clarification, structured reporting, and private engineering automation.

The next major product direction is unattended operation: recurring runs that first drain actionable pull request follow-up work, then move to new ticket intake only when the existing review queue is clear.

## Development Process

Built with AI-assisted workflows, while architecture, tradeoffs, integration choices, review, and validation are directed by the author.
