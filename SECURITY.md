# Security Policy

## Scope

Exodia is a local-first orchestration harness. It is not intended for deployment as a publicly exposed service. This policy covers the code in this repository: the harness, its adapters, the agent runtime wrappers, redaction, public hygiene scanning, and the example configurations.

## Threat Model

Exodia reads ticket content, loads context and memory, and can run a coding runtime that edits a target worktree and opens pull requests. The main risks it tries to control are:

- unintended write actions: real pull requests require `allowRealPrs`, merging is blocked by default (`allowMerge`), and trust levels separate `mock`, `mcp-readonly`, and `mcp-write`
- writes outside the intended target: execution is limited by allowlists for repositories and base branches and by the configured worktree
- leakage of secrets or private data: reports, logs, and memory payloads are redacted, and public hygiene scans check tracked files and example configs
- untrusted ticket content steering the agent: proposals are audited and verified (payload checks, path policy, command preflight) before execution, and the harness stops for human clarification when confidence is low

Credentials are expected to come from the launcher environment, an MCP dashboard, or a secret manager. They must not be stored in repository files. Do not use `.env` or `.env.local` files.

## Reporting a Vulnerability

Please report vulnerabilities privately through GitHub Security Advisories: use the "Report a vulnerability" button under the Security tab of https://github.com/ragePolpette/Exodia. If that is not available, open a minimal issue that asks for a private contact channel and does not include details.

Include the affected file or component, steps to reproduce, and the impact you observed. Do not include real credentials or customer data in a report.

## Not Covered

- vulnerabilities in third-party coding runtimes, model providers, MCP servers, Jira, Bitbucket, or Slack
- misconfiguration of local untracked configs, for example enabling real execution with a broad allowlist
- exposing Exodia as a network service, which is not a supported deployment
- findings that require an attacker to already control the host or its environment variables
- issues in dependencies without a demonstrated impact on Exodia
