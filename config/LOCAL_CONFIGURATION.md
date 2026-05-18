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
- `interaction.enabled`
- `interaction.mode`
- `interaction.storeFile`
- `interaction.destinations`
- `interaction.allowedPhases`
- `interaction.maxQuestionsPerTicket`
- `interaction.captureToSemanticMemory`
- `interaction.captureToTicketMemory`
- `interaction.transports.slack.server`
- `interaction.transports.slack.postAction`
- `interaction.transports.slack.collectRepliesAction`
- `interaction.transports.slack.channel`
- `interaction.transports.slack.channelsByPhase`
- `interaction.transports.ticket.commentPrefix`
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
- `logging.level`
- `logging.includeTimestamp`
- `logging.file.enabled`
- `logging.file.rootDir`
- `scheduling.enabled`
- `scheduling.lockFile`
- `scheduling.profiles`
- `workflow.enabled`
- `workflow.stateFile`
- `workflow.humanApprovalPolicy`

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

## Human-In-The-Loop

Il loop domanda/risposta e` configurabile per destinazione:

- `slack`
- `ticket`
- `both`

Regole operative:

- il run crea la domanda e salva uno stato `awaiting_response`
- il ticket resta fermo finche' non arriva una risposta valida
- non c'e` polling continuo: la risposta viene verificata al run successivo
- se `slack` e `ticket` sono entrambi attivi, la prima risposta vince
- se Slack risolve prima, eventuali risposte successive nel ticket vengono ignorate
- le risposte con valore funzionale vengono distillate in memoria semantica e nel resume del ticket

Candidate approval:

- `workflow.humanApprovalPolicy = "skip"` non blocca i candidati plausibili
- `workflow.humanApprovalPolicy = "always"` ferma ogni candidato plausibile in `awaiting_human_approval`
- `workflow.humanApprovalPolicy = "on_low_confidence"` chiede approvazione solo per candidati a bassa confidenza
- abilita `candidate_approval` in `interaction.allowedPhases` se vuoi ricevere la domanda su Slack/ticket

Per Slack:

- usa un MCP server/config locale dedicato
- non salvare token nel repo
- passa auth solo via `.ps1` o dashboard locale

Per Jira ticket comments:

- abilita nel bridge le action `addTicketComment` e `listTicketComments`
- usa il cloudId locale non tracciato

## Agent Runtime

The agentic flow uses a provider-agnostic `agentRuntime` section. Exodia owns branch, commit, push and PR; runtimes only analyze, audit, edit files, or review implementation evidence.

Local fields to set when you want live agents instead of heuristics:

- `agentRuntime.enabled`
- `agentRuntime.provider`
- `agentRuntime.enabledPhases`
- `agentRuntime.artifactFile`
- `agentRuntime.implementationArtifactFile`
- `agentRuntime.humanConfirmationPolicy`
- `agentRuntime.audit.maxRefinementIterations`
- `agentRuntime.implementation.maxVerificationLoops`
- `agentRuntime.providers["codex-cli"].command`
- `agentRuntime.providers["codex-cli"].args`
- `agentRuntime.providers["codex-cli"].workingDirectory`
- `agentRuntime.providers["codex-cli"].timeoutMs`
- `agentRuntime.providers["codex-cli"].env`
- `agentRuntime.providers.openai.model`
- `agentRuntime.providers.openai.baseUrl`
- `agentRuntime.providers.openai.apiKeyEnvVar`
- `agentRuntime.providers.openai.timeoutMs`
- `agentRuntime.providers.openai.maxTokens`
- `agentRuntime.providers.ollama.model`
- `agentRuntime.providers.ollama.baseUrl`
- `agentRuntime.providers.ollama.timeoutMs`
- `agentRuntime.providers.ollama.maxTokens`
- `agentRuntime.providers.lmstudio.model`
- `agentRuntime.providers.lmstudio.baseUrl`
- `agentRuntime.providers.lmstudio.timeoutMs`
- `agentRuntime.providers.lmstudio.maxTokens`

Useful phases:

- `analysis`: ticket feasibility, target and fix proposal
- `audit`: independent review of the proposal
- `implementation`: code edits only, no Git release actions
- `implementation_verification`: read-only LLM review of the diff and verification evidence

`codex-cli` is the recommended local test provider.

Wrapper contract:

- read one JSON request from stdin
- emit one JSON response on stdout
- no markdown, no prose wrappers
- branch on `EXODIA_AGENT_RUNTIME_PHASE`

Keep provider credentials and wrapper paths only in local untracked config.

Ready local wrapper:

- `command = "node"`
- `args = ["./scripts/agent-runtime-codex-wrapper.mjs"]`

Useful codex wrapper env keys:

- `EXODIA_CODEX_COMMAND = codex`
- `EXODIA_CODEX_MODEL = <optional model>`
- `EXODIA_CODEX_PROFILE = <optional codex profile>`
- `EXODIA_CODEX_SANDBOX = read-only | workspace-write`
- `EXODIA_CODEX_USE_OSS = true | false`
- `EXODIA_CODEX_LOCAL_PROVIDER = ollama | lmstudio`
- `EXODIA_CODEX_TIMEOUT_MS = <milliseconds>`

Recommended local profile split:

- `config/local/harness.agent.codex.local.json`
- `config/local/harness.agent.openai.local.json`
- `config/local/harness.agent.ollama.local.json`

For `ollama`:

- keep `agentRuntime.provider = "ollama"`
- keep the default `baseUrl = "http://127.0.0.1:11434/v1"` unless your daemon listens elsewhere
- set `agentRuntime.providers.ollama.model` to an installed local model such as `qwen3-coder:30b`
- keep `agentRuntime.providers.ollama.maxTokens` conservative during local tests
- start the local server before the run, otherwise the agent runtime will fail fast and invalidate the run

## Logging Locale

Il logging locale supporta:

- console redatta
- file JSONL per evento
- summary testuale e JSON per run

Regole pratiche:

- usa `logging.file.enabled = true` solo su workstation controllate
- tieni `logging.file.rootDir` fuori da cartelle sync/pubbliche
- i log passano comunque dalla redaction centrale prima della scrittura

Monitoring locale:

- usa `node src/cli.js monitor --config <config> --limit 20`
- il comando legge i summary JSON e i JSONL sotto `logging.file.rootDir`
- se trova run con errori loggati, esce con `exit code 1`

## Scheduling Manual-First

Lo scheduling iniziale e` intenzionalmente manuale:

- definisci i profili in `scheduling.profiles`
- usa il wrapper `scripts/run-exodia.ps1`
- il lock file evita doppie esecuzioni accidentali

Esempi:

- `pwsh -File .\scripts\run-exodia.ps1 -Profile triage`
- `pwsh -File .\scripts\run-exodia.ps1 -Profile execute-readonly`

Regole pratiche:

- usa `execute-write` solo in config locali controllate
- non mettere auth o parametri sensibili nello script tracciato
- se il lock resta orfano, rimuovilo solo dopo avere verificato che nessun run sia ancora attivo

## Nota SQL MCP

Le query diagnostiche usano target espliciti:

- `targets.prod` per sola lettura anonimizzata
- `targets.dev` per lettura o test di supporto

La persistenza del run log non e` implicita:

- abilita `adapters.llmSqlDb.mcp.operations.recordRun.enabled` solo se hai un target scrivibile locale
- definisci `adapters.llmSqlDb.mcp.operations.recordRun.sql` nel file locale
- non usare il target `prod` per scritture

