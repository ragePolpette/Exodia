# BpoPilot Ticket Harness

Harness autonomo per orchestrare triage ed execution di ticket BpoPilot con Codex come motore operativo, con bootstrap centralizzato degli adapter e supporto sia `mock` sia `mcp`. Il triage puo` lavorare in modalita` mock o MCP e l'execution puo` usare `llm-bitbucket-mcp` solo quando la config lo consente esplicitamente.

## Obiettivo

Il progetto separa:

- orchestrazione generale del run
- `Triage Agent`
- `Execution Agent`
- contratti agent e memory
- adapter MCP

Il bootstrap corrente non richiede ticket reali, non apre PR reali sui repository business e mantiene `allowMerge = false`.

## Struttura Finale

```text
bpopilot-ticket-harness/
├─ config/
│  ├─ harness.config.example.json
│  ├─ harness.config.mcp.example.json
│  └─ harness.config.real.example.json
├─ .git/
├─ data/
│  └─ memory.json
├─ src/
│  ├─ adapters/
│  │  ├─ bitbucket-adapter.js
│  │  ├─ bitbucket-mcp-adapter.js
│  │  ├─ bootstrap-adapters.js
│  │  ├─ jira-adapter.js
│  │  ├─ jira-mcp-adapter.js
│  │  ├─ llm-context-adapter.js
│  │  ├─ llm-context-mcp-adapter.js
│  │  ├─ llm-memory-adapter.js
│  │  ├─ llm-memory-mcp-adapter.js
│  │  ├─ llm-sql-db-adapter.js
│  │  └─ llm-sql-db-mcp-adapter.js
│  ├─ agents/
│  │  ├─ execution-agent.js
│  │  └─ triage-agent.js
│  ├─ config/
│  │  └─ load-config.js
│  ├─ contracts/
│  │  ├─ harness-contracts.js
│  │  └─ memory-record.js
│  ├─ execution/
│  │  ├─ execution-service.js
│  │  └─ render-execution-report.js
│  ├─ logging/
│  │  └─ logger.js
│  ├─ memory/
│  │  └─ file-memory-store.js
│  ├─ mcp/
│  │  └─ create-mcp-client.js
│  ├─ orchestration/
│  │  └─ run-harness.js
│  ├─ prompts/
│  │  ├─ execution-agent.md
│  │  ├─ load-prompt.js
│  │  └─ triage-agent.md
│  └─ triage/
│     ├─ render-triage-report.js
│     └─ triage-service.js
└─ tests/
   ├─ adapter-bootstrap.test.js
   ├─ dry-run.test.js
   ├─ execution-flow.test.js
   ├─ resume-flow.test.js
   ├─ sql-db-diagnostics.test.js
   ├─ triage-flow.test.js
   └─ triage-mcp-mode.test.js
```

## Architettura Operativa

- [run-harness.js](C:/Users/Gianmarco/Urgewalt/Malkuth/bpopilot-ticket-harness/src/orchestration/run-harness.js): entrypoint centrale. Carica config, usa la factory di bootstrap degli adapter, lancia triage e opzionalmente execution.
- [bootstrap-adapters.js](C:/Users/Gianmarco/Urgewalt/Malkuth/bpopilot-ticket-harness/src/adapters/bootstrap-adapters.js): registry centrale che seleziona adapter `mock` o `mcp` in base alla config.
- [triage-agent.js](C:/Users/Gianmarco/Urgewalt/Malkuth/bpopilot-ticket-harness/src/agents/triage-agent.js): legge memoria esistente, usa `llm-context` come fonte primaria per il mapping ticket -> codebase e salva decisioni persistenti.
- [create-mcp-client.js](C:/Users/Gianmarco/Urgewalt/Malkuth/bpopilot-ticket-harness/src/mcp/create-mcp-client.js): bridge MCP generico, con modalita` `fixture` per test e `external` per integrazione reale.
- [execution-agent.js](C:/Users/Gianmarco/Urgewalt/Malkuth/bpopilot-ticket-harness/src/agents/execution-agent.js): esegue flow mock o reale via `llm-bitbucket-mcp`, con guardrail su `enabled`, `dryRun`, `allowRealPrs` e anti-merge.
- [memory-record.js](C:/Users/Gianmarco/Urgewalt/Malkuth/bpopilot-ticket-harness/src/contracts/memory-record.js): contratto persistente del ticket memory layer.
- [logger.js](C:/Users/Gianmarco/Urgewalt/Malkuth/bpopilot-ticket-harness/src/logging/logger.js): logging minimale a livelli `silent`, `error`, `info`, `debug`.

## Contratto Memoria

Per ogni ticket il memory layer persistente conserva:

- `ticket_key`
- `project_key`
- `repo_target`
- `status_decision`
- `confidence`
- `short_reason`
- `implementation_hint`
- `branch_name`
- `pr_url`
- `last_outcome`
- `recheck_conditions`

Stati ammessi di triage:

- `skipped_out_of_scope`
- `skipped_already_rejected`
- `skipped_already_in_progress`
- `not_feasible`
- `feasible`
- `feasible_low_confidence`
- `blocked`

## Modalita' Adapter

Ogni adapter supporta una configurazione esplicita:

- `kind: "mock"` per bootstrap, test e dry-run sicuri
- `kind: "mcp"` per registrare il bridge verso l'MCP reale

In questo STEP 4:

- gli adapter `mock` restano disponibili per bootstrap e test
- Jira, `llm-context` e `llm-memory` hanno un path `mcp` reale via bridge configurabile
- `llm-sql-db-mcp` e` disponibile come supporto diagnostico opzionale
- il fallback file/mock resta esplicito in config

## MCP Previsti

Il progetto e` strutturato per integrare questi MCP:

- Jira ufficiale tramite [jira-adapter.js](C:/Users/Gianmarco/Urgewalt/Malkuth/bpopilot-ticket-harness/src/adapters/jira-adapter.js)
- `llm-context` tramite [llm-context-adapter.js](C:/Users/Gianmarco/Urgewalt/Malkuth/bpopilot-ticket-harness/src/adapters/llm-context-adapter.js)
- `llm-memory` tramite [llm-memory-adapter.js](C:/Users/Gianmarco/Urgewalt/Malkuth/bpopilot-ticket-harness/src/adapters/llm-memory-adapter.js)
- `llm-sql-db-mcp` tramite [llm-sql-db-adapter.js](C:/Users/Gianmarco/Urgewalt/Malkuth/bpopilot-ticket-harness/src/adapters/llm-sql-db-adapter.js)
- `llm-bitbucket-mcp` tramite [bitbucket-adapter.js](C:/Users/Gianmarco/Urgewalt/Malkuth/bpopilot-ticket-harness/src/adapters/bitbucket-adapter.js)

Durante il bootstrap:

- la modalita' `mock` e' operativa
- la modalita' `mcp` per Jira, `llm-context` e `llm-memory` e' operativa tramite bridge
- `llm-sql-db-mcp` e` disponibile ma solo su richiesta diagnostica
- `llm-bitbucket-mcp` e` integrato sia in modalita` mock sia in modalita` MCP

## Quick Start Mock

1. usa [harness.config.example.json](C:/Users/Gianmarco/Urgewalt/Malkuth/bpopilot-ticket-harness/config/harness.config.example.json)
2. esegui solo triage:

```bash
node src/cli.js triage --config ./config/harness.config.example.json --dry-run
```

3. esegui triage + execution mock:

```bash
node src/cli.js run --config ./config/harness.config.example.json --dry-run
```

## Quick Start MCP Reale Controllato

1. parti da [harness.config.mcp.example.json](C:/Users/Gianmarco/Urgewalt/Malkuth/bpopilot-ticket-harness/config/harness.config.mcp.example.json) per triage MCP
2. parti da [harness.config.real.example.json](C:/Users/Gianmarco/Urgewalt/Malkuth/bpopilot-ticket-harness/config/harness.config.real.example.json) per execution MCP reale controllata
3. configura `mcpBridge.command` e `mcpBridge.args`
4. verifica che `execution.allowMerge = false`
5. usa `--real-run` solo quando vuoi davvero disattivare il dry-run

Triage MCP:

```bash
node src/cli.js triage --config ./config/harness.config.mcp.example.json --dry-run
```

Execution MCP reale controllata:

```bash
node src/cli.js execute --config ./config/harness.config.real.example.json --real-run --report execution
```

## Config Example

Il file di esempio e` [harness.config.example.json](C:/Users/Gianmarco/Urgewalt/Malkuth/bpopilot-ticket-harness/config/harness.config.example.json).

Esempio separato per triage MCP:

- [harness.config.mcp.example.json](C:/Users/Gianmarco/Urgewalt/Malkuth/bpopilot-ticket-harness/config/harness.config.mcp.example.json)
- [harness.config.real.example.json](C:/Users/Gianmarco/Urgewalt/Malkuth/bpopilot-ticket-harness/config/harness.config.real.example.json)

Campi principali:

- `mode`: `triage-only` oppure `triage-and-execution`
- `dryRun`: forza esecuzione sicura
- `memory.filePath`: path del backend locale compatibile/mockabile
- `adapters.<name>.kind`: `mock` oppure `mcp`
- `adapters.<name>.mock`: parametri della modalita' fake/mock
- `adapters.<name>.mcp`: parametri preparatori per l'integrazione reale
- `execution.baseBranch`: branch base, richiesto `BPOFH`
- `execution.enabled`: attiva o disattiva la fase di execution
- `execution.dryRun`: se `true`, blocca ogni azione reale anche con adapter MCP
- `execution.allowRealPrs`: deve restare `false` nel bootstrap
- `execution.allowMerge`: deve restare `false`
- `execution.workspaceRoot`: workspace locale configurabile per git/checkout
- `adapters.llmSqlDb.mcp.enabled`: abilita il bridge DB solo quando serve
- `adapters.llmSqlDb.mcp.namespace`: namespace diagnostico del harness
- `mcpBridge.mode`: `fixture` oppure `external`
- `mcpBridge.fixtureFile` o `mcpBridge.fixtures`: per test e bootstrap controllato
- `mcpBridge.command` e `mcpBridge.args`: bridge reale per i server MCP
- `logging.level`: `silent`, `error`, `info`, `debug`
- `mockTickets`: dataset locale per bootstrap e test

## Comandi Principali

Richiede Node.js 22+.

Solo triage:

```bash
node src/cli.js triage --config ./config/harness.config.example.json --dry-run
```

Solo triage in modalita` MCP:

```bash
node src/cli.js triage --config ./config/harness.config.mcp.example.json --dry-run
```

Triage + execution:

```bash
node src/cli.js run --config ./config/harness.config.example.json --dry-run
```

Execution report esplicito:

```bash
node src/cli.js execute --config ./config/harness.config.example.json --dry-run --report execution
```

Execution reale controllata:

```bash
node src/cli.js execute --config ./config/harness.config.real.example.json --real-run --report execution
```

Per consentire davvero branch/commit/PR via MCP servono tutte queste condizioni:

- `adapters.bitbucket.kind = "mcp"`
- `execution.enabled = true`
- `execution.dryRun = false`
- `execution.allowRealPrs = true`
- `execution.allowMerge = false`

Resume con memoria esistente:

```bash
node src/cli.js triage --config ./config/harness.config.example.json --dry-run
```

Il resume usa [memory.json](C:/Users/Gianmarco/Urgewalt/Malkuth/bpopilot-ticket-harness/data/memory.json) per evitare rivalutazioni inutili e loop sui ticket gia` rifiutati, bloccati o gia` in lavorazione.

Help CLI:

```bash
node src/cli.js --help
```

Test:

```bash
node --test
```

## Esempi Pratici

Scenario 1, solo triage:

- legge ticket mock
- usa `llm-context` mock per decidere scope e fattibilita`
- produce un triage report leggibile

Scenario 1b, triage MCP:

- legge ticket da Jira tramite JQL o filtro configurato
- usa `llm-context` via bridge MCP come fonte primaria
- usa `llm-memory` come memoria primaria se configurato con `kind: "mcp"`
- ripiega sul file store solo se `llmMemory.kind = "mock"`
- usa `llm-sql-db-mcp` solo se il ticket richiede una query diagnostica

Scenario 2, triage + execution:

- seleziona ticket `feasible`
- crea branch `{ticketkey-lowercase}-{breve-spiegazione-kebab-case}`
- fa checkout del branch
- crea un commit mock chiaro
- apre una PR mock obbligatoria
- non esegue mai merge

Scenario 2c, execution MCP reale controllata:

- usa `llm-bitbucket-mcp` per creare branch da `BPOFH`
- fa checkout nel `workspaceRoot` configurato
- crea commit e apre PR
- parte solo se `execution.dryRun = false` e `execution.allowRealPrs = true`
- si blocca subito se la config non e` coerente
- usa `llm-sql-db-mcp` solo per diagnosi puntuali prima di procedere

Scenario 2b, registry pronto per MCP:

- la config puo' dichiarare `kind: "mcp"` per Jira, `llm-context`, `llm-memory`, `llm-sql-db-mcp`, `llm-bitbucket-mcp`
- l'orchestratore non istanzia piu' adapter hardcoded
- il wiring reale resta rinviato agli step successivi

Scenario 3, resume:

- trova memoria gia` popolata
- evita rivalutazione di ticket `not_feasible`, `blocked`, `pr_opened`, `implemented` senza nuove `recheck_conditions`

## Vincoli e Guardrail

- niente deploy
- niente merge automatici
- niente chiusura ticket automatica
- niente dipendenza obbligatoria da ticket reali durante il bootstrap
- niente PR reali sui repository business durante lo sviluppo dell'harness
- niente execution reale finche' la config non lo abilita esplicitamente negli step successivi
- `--real-run` da solo non basta: servono anche adapter `mcp` coerenti e `execution.allowRealPrs = true`
- `llm-sql-db-mcp` resta opzionale e on-demand

## Readiness Review

Stato attuale:

- harness pronto per un primo utilizzo reale controllato
- mock e MCP convivono nello stesso progetto
- il resume con memoria esistente e` verificato con test dedicato
- i guardrail bloccano i path reali incoerenti

Rischi residui:

- il bridge MCP `external` dipende dalla qualita` del comando integrato nel tuo ambiente
- i prompt attuali sono buoni prompt operativi, ma non ancora i prompt definitivi che inserirai tu
- il DB diagnostico non ha ancora una policy di query whitelist o governance piu` fine

## Limiti Residui

- i prompt agent sono maturi ma ancora non sono i prompt finali che inserirai tu
- il DB e` usato solo on-demand, senza policy diagnostiche sofisticate
- nessuna modifica reale a repository business
- nessuna apertura PR reale per default
- logging minimale, non ancora strutturato in sink esterni

## Miglioramenti Consigliati

- sostituire i prompt maturi correnti con i prompt reali definitivi dei due agenti
- affinare le policy di uso diagnostico del DB per ridurre rumore e query inutili
- aggiungere policy piu` fini per resume, retry e rate limiting
- aggiungere audit log strutturato per ogni run
- aggiungere fixture piu` ricche per ticket mock complessi
