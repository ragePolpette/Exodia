# Local Configuration

I file tracciati in `config/` sono esempi pubblicabili. Non devono contenere tenant, path locali, repo interni, branch reali o segreti.

Per l'uso reale crea file locali non tracciati, per esempio:

- `config/local/harness.local.json`
- `config/local/harness.mcp.local.json`
- `config/local/harness.real.local.json`
- `config/codex.mcp.local.toml`

Regola imperativa:

- non usare file `.env`
- non salvare chiavi o token dentro il repository
- l'autenticazione va passata al lancio del `.ps1` oppure gestita dalla dashboard locale in `C:\Users\Gianmarco\Urgewalt\Yetzirah\mcp-dashboard`

## Cosa personalizzare localmente

Compila localmente questi campi:

- `adapters.jira.mcp.cloudId`
- `adapters.jira.mcp.jql` o `filterId`
- `adapters.llmContext.mcp.workspaceRoot`
- `adapters.llmContext.mcp.projectId`
- `adapters.llmMemory.mcp.namespace`
- `adapters.llmSqlDb.mcp.namespace`
- `adapters.llmSqlDb.mcp.operations.recordRun.enabled`
- `adapters.llmSqlDb.mcp.operations.recordRun.server`
- `adapters.llmSqlDb.mcp.operations.recordRun.database`
- `adapters.llmSqlDb.mcp.operations.recordRun.sql`
- `adapters.llmSqlDb.mcp.targets.prod.action`
- `adapters.llmSqlDb.mcp.targets.prod.maxRows`
- `adapters.llmSqlDb.mcp.targets.dev.action`
- `adapters.llmSqlDb.mcp.targets.dev.maxRows`
- `adapters.bitbucket.mcp.repository`
- `adapters.bitbucket.mcp.project`
- `adapters.bitbucket.mcp.workspaceRoot`
- `execution.trustLevel`
- `execution.baseBranch`
- `execution.allowedRepositories`
- `execution.allowedBaseBranches`
- `execution.workspaceRoot`
- `targeting.unknownTarget`
- `targeting.rules`
- `targeting.rules[*].area`
- `targeting.rules[*].inScope`
- `targeting.rules[*].feasibility`
- `targeting.rules[*].implementationHint`
- `verification.allowedPathPrefixesByRepo`
- `verification.preflightCommands`
- `verification.allowedCommandPrefixes`
- `verification.sensitiveScan.forbiddenLiteralPatterns`
- `verification.sensitiveScan.forbiddenRegexPatterns`
- `verification.sensitiveScan.workspaceRoot`
- `security.redaction`
- `mcpBridge.command`
- `mcpBridge.args`
- `mcpBridge.allowedActionsByServer`

## Regola pratica

Nel repository tieni solo placeholder generici come:

- `your-site.atlassian.net`
- `YOUR_PROJECT`
- `your-repository`
- `main`
- `C:\\path\\to\\your\\workspace`
- `your-harness-namespace`
- `targeting.rules[*].aliases`

Tutti i valori reali devono stare nei file locali ignorati da git.

Per chiavi e token:

- non creare `.env`
- non creare `.env.local`
- non documentare workflow basati su file env
- usa solo bootstrap PowerShell o dashboard locale per iniettare le credenziali nel processo

## Trust levels execution

Usa solo questi livelli:

- `mock`: nessuna azione reale su bridge o repo
- `mcp-readonly`: bridge MCP attivo ma execution reale disabilitata
- `mcp-write`: branch, commit e PR reali consentiti solo insieme a `allowRealPrs = true`

## Nota SQL MCP

Le query diagnostiche usano target espliciti:

- `targets.prod` per sola lettura anonimizzata
- `targets.dev` per lettura o test di supporto

La persistenza del run log non e` implicita:

- abilita `adapters.llmSqlDb.mcp.operations.recordRun.enabled` solo se hai un target scrivibile locale
- definisci `adapters.llmSqlDb.mcp.operations.recordRun.sql` nel file locale
- non usare il target `prod` per scritture
