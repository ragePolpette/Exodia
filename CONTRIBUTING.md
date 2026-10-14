# Contributing

## Workflow

1. Fork the repository or create a branch from `main`.
2. Use a descriptive branch name, for example `fix/short-summary` or `feat/short-summary`.
3. Keep changes scoped to one concern and read the relevant source and tests first.
4. Open a pull request against `main` and fill in the pull request template.
5. CI must pass before merge.

## Tests and Checks

Requirements: Node.js 22 or later.

```bash
npm ci
npm run lint
npm test
node src/cli.js audit --config ./config/harness.config.example.json
node src/cli.js review --config ./config/harness.config.example.json
```

`npm test` runs `node --test`. `npm run lint` runs ESLint with the flat config in `eslint.config.js`. Add or update tests for behavior changes. Run `audit` and `review` for changes that touch documentation, examples, or configuration.

## Repository Rules

- Never commit credentials, tokens, `.env` files, real local configs, run logs, memory stores, customer data, or generated transcripts.
- Real values belong in untracked files such as `config/local/*` and `EXODIA.md`, which are git-ignored.
- Example configs must keep placeholder values and safe defaults (dry run, no merge, no real pull requests).
- Do not weaken guard rails (allowlists, trust levels, redaction, hygiene scans) without discussing it in an issue first.
- Documentation is written in English.

Security issues should be reported as described in [SECURITY.md](SECURITY.md), not in public issues.
