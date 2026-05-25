# Commit And Secret Policy

This repository must not expose customer data, credentials, internal URLs, local paths, or operational incident details in commits, tracked files, pull request text, or generated documentation.

## Commit Message Rules

Commit messages must be technical and generic.

Allowed examples:

```text
fix(GEN-1234): correct purchase document price source
feat(runtime): add pull request follow-up mode
test(partitario): cover final discount total calculation
```

Forbidden examples:

```text
fix: customer <customer name> invoice <number> has wrong amount
fix: partita IVA <vat number> missing in export
fix: reproduce on <internal private url>
fix: local <absolute filesystem path> issue for client
```

Rules:

- Do not include customer names.
- Do not include fiscal codes, VAT numbers, phone numbers, email addresses, or addresses.
- Do not include internal URLs, private Bitbucket/GitHub links, Jira payload excerpts, or database identifiers.
- Do not include local filesystem paths.
- Do not paste ticket descriptions into commit messages.
- Use ticket IDs only as opaque identifiers.

## Tracked File Rules

Do not commit:

- real `.env`, `.toml`, `.json`, `.config`, or `.ps1` files containing local paths or credentials
- run logs, summaries, memory stores, transcripts, artifacts, or generated LLM output
- customer-specific markdown handoffs
- screenshots or exports containing business data
- database connection strings, DSNs, API keys, OAuth tokens, PATs, cookies, JWTs, SSH keys, or certificates

Only publish:

- generic examples
- redacted templates
- source code
- tests with fake data

## Required Workflow

Before publishing a repository:

1. Delete old remote repositories if commit history exposed sensitive information.
2. Create a new repository from a clean working tree.
3. Start with a fresh Git history.
4. Install the commit and pre-commit hooks.
5. Run a secret/content scan.
6. Push only to a private repository unless a separate public-readiness review approves public visibility.
