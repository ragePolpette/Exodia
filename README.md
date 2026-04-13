# Malkuth

`Malkuth` is a local-first harness for triage, verification, human clarification, and controlled execution of technical work items.

It is built for environments where an agent should not jump directly from "ticket received" to "code changed" without policy checks, scoped execution rules, and a safe way to ask humans for missing context.

## Why It Stands Out

The best feature in the runtime is the human-in-the-loop clarification flow:

- an agent can ask a clarifying question on Slack and/or on the ticket itself
- the run pauses safely in `awaiting_response`
- the next run resumes from the first valid answer
- high-signal answers are distilled into memory and reused later

This makes the workflow much more realistic than a simple "ticket in, PR out" demo. The system is designed to stop when confidence is not high enough, ask, wait, resume, and remember.

A short transcript of that flow lives in [DEMO.md](./DEMO.md).

## What It Does

The runtime is built to:

1. read work items from a configured source
2. map the request to a product and repository target
3. reuse operational memory and optional semantic retrieval
4. verify payloads, changed paths, command preflight, and public hygiene
5. pause for human-in-the-loop clarification when confidence is not high enough
6. execute branch, commit, and pull request steps only when policy allows it

## Why It Exists

Many ticket-to-code automation flows are unsafe because they collapse triage, policy, and execution into one step.

`Malkuth` separates those concerns into explicit stages:

- triage
- verification
- execution
- reporting

The goal is not autonomous merge automation. The goal is a controlled local harness for serious engineering workflows.

It is not intended for deployment as a publicly exposed service.

## Human-In-The-Loop

Clarification requests can be routed to Slack, ticket comments, or both.

Typical flow:

1. the triage or verification step finds ambiguity
2. the runtime posts a question on Slack and/or on the ticket
3. the ticket is marked as waiting for input
4. the next run collects replies
5. the first valid answer wins
6. the run resumes from that answer
7. useful answers are captured into ticket memory and semantic memory

This behavior is implemented in the interaction layer under `src/interaction/`.

For a compact example of the full Slack -> answer -> resume -> memory loop, see [DEMO.md](./DEMO.md).

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
       -> bitbucket adapter (mock | mcp)
       -> optional SQL diagnostics
  -> Reports
       -> triage report
       -> execution report
       -> final report
       -> audit trail
```

Main areas:

- `src/orchestration/`: top-level run orchestration
- `src/adapters/`: runtime adapters and external integration boundaries
- `src/agents/`: triage, verification, and execution stages
- `src/interaction/`: deferred question/answer loop and transport routing
- `src/mcp/`: MCP bridge and registry/client glue
- `src/security/`: public hygiene scanning and redaction
- `src/logging/`: structured run logging
- `src/monitoring/`: local monitoring over run summaries and JSONL logs
- `src/scheduling/`: manual-first scheduling profiles with lock protection
- `src/reporting/`: final report generation
- `config/`: publishable example configurations plus local setup guidance

## Safety Model

Guard rails in the runtime include:

- `allowMerge` blocked by default
- `allowRealPrs` requiring explicit enablement
- trust-level separation between `mock`, `mcp-readonly`, and `mcp-write`
- allowlists for repositories, base branches, commands, and MCP actions
- public-hygiene scanning for sensitive strings and placeholder safety
- redaction across reports, logs, and semantic memory
- deferred human-in-the-loop interaction when confidence is insufficient

## Local Run

Requirements:

- Node.js 22+
- local configuration derived from the example files in `config/`

Install:

```bash
npm install
```

Common flows:

```bash
node src/cli.js triage --config ./config/harness.config.example.json --dry-run
node src/cli.js run --config ./config/harness.config.example.json --dry-run
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

Real values should stay in local untracked files such as:

- `config/local/harness.local.json`
- `config/local/harness.mcp.local.json`
- `config/local/harness.real.local.json`
- `config/codex.mcp.local.toml`

The repository is explicitly meant to stay free of:

- local paths
- real tenant identifiers
- real repository and branch names
- secret material
- real MCP bridge command lines

Do not use file `.env`.
Do not use file `.env.local`.
Pass credentials only through a PowerShell launcher or the local MCP dashboard.

## Recommended Ticket Shape

If you want the harness to work well, the incoming work item needs a clean shape.

A compact recommended template lives in [ticket-handoff-template.md](./harness-docs/ticket-handoff-template.md).

## Project Status

This repository is in active development. The current runtime already demonstrates the intended architecture and safety model, and it is strong enough to show serious engineering decisions around guard rails, memory, MCP integration, and human-in-the-loop recovery.

## Development Process

Built with AI-assisted workflows, while architecture, tradeoffs, integration, review, and validation were directed by the author.
