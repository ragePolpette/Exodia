# Local Configuration

I file tracciati in `config/` sono esempi pubblicabili. Non devono contenere tenant, path locali, repo interni, branch reali o segreti.

Per l'uso reale crea file locali non tracciati, per esempio:

- `config/local/harness.local.json`
- `config/local/harness.mcp.local.json`
- `config/local/harness.real.local.json`
- `config/codex.mcp.local.toml`
- `.env.local`

## Cosa personalizzare localmente

Compila localmente questi campi:

- `adapters.jira.mcp.cloudId`
- `adapters.jira.mcp.jql` o `filterId`
- `adapters.llmContext.mcp.workspaceRoot`
- `adapters.llmContext.mcp.projectId`
- `adapters.llmMemory.mcp.namespace`
- `adapters.llmSqlDb.mcp.namespace`
- `adapters.bitbucket.mcp.repository`
- `adapters.bitbucket.mcp.project`
- `adapters.bitbucket.mcp.workspaceRoot`
- `execution.baseBranch`
- `execution.workspaceRoot`
- `verification.allowedPathPrefixesByRepo`
- `verification.preflightCommands`
- `mcpBridge.command`
- `mcpBridge.args`

## Regola pratica

Nel repository tieni solo placeholder generici come:

- `your-site.atlassian.net`
- `YOUR_PROJECT`
- `your-repository`
- `main`
- `C:\\path\\to\\your\\workspace`
- `your-harness-namespace`

Tutti i valori reali devono stare nei file locali ignorati da git.
