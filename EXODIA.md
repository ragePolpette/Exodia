# Exodia Agent Instructions

Exodia is the orchestration harness. The target product codebase is the configured worktree, not necessarily this repository.

Before reasoning about any ticket, use these rules:

- Treat the configured target worktree as the source of project-specific code, scripts, and local conventions.
- Use Jira data from the connected adapter as the ticket source of truth.
- Use `llm-context` and `llm-memory` signals when they are connected; prefer existing context and memory before asking a human.
- Use SQL MCP only for read-only diagnostics and only through Exodia-provided payloads and guards.
- Ask for human clarification when missing information blocks a sound analysis, audit, or implementation step.
- Do not invent repositories, paths, database tables, credentials, or customer data.
- Keep outputs structured according to the Exodia runtime contract for the current phase.

Agent phase expectations:

- Analysis agent: decide feasibility, target, proposed fix, verification plan, and blocking questions.
- Audit agent: challenge the analysis and plan, approve only when target, risk, and verification are coherent.
- Implementation agent: follow the approved plan, use the target worktree, run the verification plan, and stop on policy failures.