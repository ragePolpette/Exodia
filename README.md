# Malkuth

Harness locale e local-first per orchestrare triage ed execution controllata di ticket tecnici con bootstrap centralizzato degli adapter e supporto sia `mock` sia `mcp`.

Il progetto e` pensato per:

- uso personale e di team in ambiente enterprise
- portfolio tecnico pubblico su GitHub una volta ripulito dai riferimenti sensibili
- esecuzione da workstation o ambiente locale controllato

Il progetto non e` pensato per:

- deploy pubblico come servizio esposto
- funzionamento out-of-the-box con tenant, repository o tool aziendali reali
- includere nel repository chiavi, tenant, path locali o naming sensibili

## Posizionamento

Malkuth e` un local-first ticket automation harness. Il suo scopo e`:

- raccogliere ticket da una sorgente configurata
- fare triage e mappatura verso il codebase corretto
- riusare memoria operativa locale e memoria semantica opzionale
- applicare guardrail prima di branch, commit e PR
- mantenere le integrazioni reali dietro config esplicite e locali

## Architettura Logica

Il progetto separa:

- orchestrazione generale del run
- `Triage Agent`
- `Execution Agent`
- storico ticket operativo su file
- memoria semantica opzionale via `llm-memory`
- contratti agent e memory
- adapter MCP

Il bootstrap corrente non richiede ticket reali, non apre PR reali per default e mantiene `allowMerge = false`.

## Sicurezza E Portfolio

Direzione del progetto:

- il repository pubblico deve restare privo di valori sensibili o specifici dell'azienda
- ogni integrazione reale deve essere reindirizzabile tramite config locale fuori repo
- le azioni irreversibili devono restare bloccate da guardrail espliciti

Nota sullo stato attuale:

- il codice e la documentazione contengono ancora alcuni esempi e naming di dominio
- questi riferimenti verranno progressivamente spostati in config nelle milestone successive
- questo step allinea il framing del progetto, non conclude ancora la completa sanitizzazione del dominio

## Struttura Finale

```text
Malkuth/
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
│  │  ├─ bridge-core.js
│  │  ├─ create-mcp-client.js
│  │  └─ run-bridge.js
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

- [run-harness.js](C:/Users/Gianmarco/Urgewalt/Malkuth/src/orchestration/run-harness.js): entrypoint centrale. Carica config, usa la factory di bootstrap degli adapter, lancia triage e opzionalmente execution.
- [bootstrap-adapters.js](C:/Users/Gianmarco/Urgewalt/Malkuth/src/adapters/bootstrap-adapters.js): registry centrale che seleziona adapter `mock` o `mcp` in base alla config.
- [triage-agent.js](C:/Users/Gianmarco/Urgewalt/Malkuth/src/agents/triage-agent.js): legge memoria esistente, usa `llm_context` come fonte primaria per il mapping ticket -> codebase e salva decisioni persistenti.
- [create-mcp-client.js](C:/Users/Gianmarco/Urgewalt/Malkuth/src/mcp/create-mcp-client.js): bridge MCP generico, con modalita` `fixture` per test e `external` per integrazione reale.
- [run-bridge.js](C:/Users/Gianmarco/Urgewalt/Malkuth/src/mcp/run-bridge.js): bridge MCP `stdio` reale che legge un registry TOML dei server MCP e inoltra le action del harness ai tool reali.
- [execution-agent.js](C:/Users/Gianmarco/Urgewalt/Malkuth/src/agents/execution-agent.js): esegue flow mock o reale via `llm_bitbucket_mcp`, con guardrail su `enabled`, `dryRun`, `allowRealPrs`, anti-merge e riuso di PR gia` aperte.
- [memory-record.js](C:/Users/Gianmarco/Urgewalt/Malkuth/src/contracts/memory-record.js): contratto persistente del ticket memory layer.
- [logger.js](C:/Users/Gianmarco/Urgewalt/Malkuth/src/logging/logger.js): logging minimale a livelli `silent`, `error`, `info`, `debug`.

## Contratto Memoria

Per ogni ticket lo storico operativo persistente su file conserva:

- `ticket_key`
- `project_key`
- `product_target`
- `repo_target`
- `status_decision`
- `confidence`
- `short_reason`
- `implementation_hint`
- `branch_name`
- `pr_url`
- `last_outcome`
- `recheck_conditions`

`llm-memory` non e` la fonte autorevole di questo storico. Quando attivo, serve solo a salvare concetti e inferenze riutilizzabili tra run.

Stati ammessi di triage:

- `skipped_out_of_scope`
- `skipped_already_rejected`
- `skipped_already_in_progress`
- `not_feasible`
- `feasible`
- `feasible_low_confidence`
- `blocked`

Target prodotto ammessi:

- `legacy`
- `fatturhello`
- `fiscobot`
- `unknown`

Regole canoniche di classificazione:

- `bpo` o `bpopilot` => `legacy`
- `fatturhello` o `yeti` => `fatturhello`
- `fiscobot` => `fiscobot`

## Modalita' Adapter

Ogni adapter supporta una configurazione esplicita:

- `kind: "mock"` per bootstrap, test e dry-run sicuri
- `kind: "mcp"` per registrare il bridge verso l'MCP reale

In questo STEP 4:

- gli adapter `mock` restano disponibili per bootstrap e test
- Jira, `llm_context` e `llm_memory` hanno un path `mcp` reale via bridge configurabile
- `llm_db_prod_mcp` / `llm_db_dev_mcp` sono disponibili come supporto diagnostico opzionale
- il fallback file/mock resta esplicito in config
- i ticket reali possono arrivare anche fuori template: il harness prova a estrarre `partita IVA`, `url`, `telefono` e un `productTarget` implicito dal testo
- la config DB MCP descrive la topologia reale: `split` con server distinti o `unified` con un solo MCP che espone sia `prod` sia `dev`

## MCP Previsti

Il progetto e` strutturato per integrare questi MCP:

- Jira/Confluence tramite server `atlassian_rovo_mcp` e [jira-adapter.js](C:/Users/Gianmarco/Urgewalt/Malkuth/src/adapters/jira-adapter.js)
- `llm_context` tramite [llm-context-adapter.js](C:/Users/Gianmarco/Urgewalt/Malkuth/src/adapters/llm-context-adapter.js)
- `llm_memory` tramite [llm-memory-adapter.js](C:/Users/Gianmarco/Urgewalt/Malkuth/src/adapters/llm-memory-adapter.js) come memoria semantica opzionale
- `llm_db_prod_mcp` / `llm_db_dev_mcp` tramite [llm-sql-db-adapter.js](C:/Users/Gianmarco/Urgewalt/Malkuth/src/adapters/llm-sql-db-adapter.js)
- `llm_bitbucket_mcp` tramite [bitbucket-adapter.js](C:/Users/Gianmarco/Urgewalt/Malkuth/src/adapters/bitbucket-adapter.js)

Durante il bootstrap:

- la modalita' `mock` e' operativa
- la modalita' `mcp` per Jira, `llm_context` e `llm_memory` e' operativa tramite bridge
- `llm_db_prod_mcp` / `llm_db_dev_mcp` sono disponibili ma solo su richiesta diagnostica
- `llm_bitbucket_mcp` e` integrato sia in modalita` mock sia in modalita` MCP
- il layer SQL supporta una distinzione logica `prod` / `dev` per usare prod in sola lettura e dev per verifiche tecniche compatibili con lo schema

## Quick Start Mock

1. usa [harness.config.example.json](C:/Users/Gianmarco/Urgewalt/Malkuth/config/harness.config.example.json)
2. esegui solo triage:

```bash
node src/cli.js triage --config ./config/harness.config.example.json --dry-run
```

3. esegui triage + execution mock:

```bash
node src/cli.js run --config ./config/harness.config.example.json --dry-run
```

## Quick Start MCP Reale Controllato

1. parti da [harness.config.mcp.example.json](C:/Users/Gianmarco/Urgewalt/Malkuth/config/harness.config.mcp.example.json) per triage MCP
2. parti da [harness.config.real.example.json](C:/Users/Gianmarco/Urgewalt/Malkuth/config/harness.config.real.example.json) per execution MCP reale controllata
3. configura `mcpBridge.command` e `mcpBridge.args`, oppure usa [harness.config.triage.codex-local.example.json](C:/Users/Gianmarco/Urgewalt/Malkuth/config/harness.config.triage.codex-local.example.json) con [codex.mcp.reference.toml](C:/Users/Gianmarco/Urgewalt/Malkuth/config/codex.mcp.reference.toml)
4. verifica che `execution.allowMerge = false`
5. usa `--real-run` solo quando vuoi davvero disattivare il dry-run

Triage MCP:

```bash
node src/cli.js triage --config ./config/harness.config.mcp.example.json --dry-run
```

Triage MCP con i server locali del tuo Codex:

```bash
node src/cli.js triage --config ./config/harness.config.triage.codex-local.example.json --dry-run
```

Execution MCP reale controllata:

```bash
node src/cli.js execute --config ./config/harness.config.real.example.json --real-run --report execution
```

## Config Example

Il file di esempio e` [harness.config.example.json](C:/Users/Gianmarco/Urgewalt/Malkuth/config/harness.config.example.json).

Esempio separato per triage MCP:

- [harness.config.mcp.example.json](C:/Users/Gianmarco/Urgewalt/Malkuth/config/harness.config.mcp.example.json)
- [harness.config.real.example.json](C:/Users/Gianmarco/Urgewalt/Malkuth/config/harness.config.real.example.json)
- [harness.config.triage.codex-local.example.json](C:/Users/Gianmarco/Urgewalt/Malkuth/config/harness.config.triage.codex-local.example.json)

Campi principali:

- `mode`: `triage-only` oppure `triage-and-execution`
- `dryRun`: forza esecuzione sicura
- `memory.filePath`: path dello storico ticket operativo locale
- `mockTickets[].productTarget`: target canonico del ticket quando noto in input
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
- `adapters.llmSqlDb.mcp.topology`: `split` oppure `unified`
- `adapters.llmSqlDb.mcp.operations.recordRun.server`: server usato per registrare il run del harness
- `adapters.llmSqlDb.mcp.targets.prod.server`: server MCP usato per diagnostica `prod`
- `adapters.llmSqlDb.mcp.targets.prod.database`: nome logico o reale del database `prod`
- `adapters.llmSqlDb.mcp.targets.prod.access`: uso atteso, tipicamente `read-only`
- `adapters.llmSqlDb.mcp.targets.dev.server`: server MCP usato per diagnostica `dev`
- `adapters.llmSqlDb.mcp.targets.dev.database`: nome logico o reale del database `dev`
- `adapters.llmSqlDb.mcp.targets.dev.access`: uso atteso, tipicamente `schema-and-tests`
- `adapters.llmSqlDb.mcp.defaultDatabase`: `prod` o `dev`, default consigliato `prod`
- `adapters.llmSqlDb.mcp.namespace`: namespace diagnostico del harness
- `adapters.bitbucket.mcp.operations.findOpenPullRequest.action`: operation di lookup PR esistente
- `adapters.bitbucket.mcp.operations.findOpenPullRequest.enabled`: abilita o disabilita il check PR gia` aperta
- `adapters.bitbucket.mcp.operations.createBranch.action`: operation per creare il branch
- `adapters.bitbucket.mcp.operations.checkoutBranch.action`: operation per checkout locale del branch
- `adapters.bitbucket.mcp.operations.createCommit.action`: operation per creare il commit
- `adapters.bitbucket.mcp.operations.openPullRequest.action`: operation per aprire la PR
- `mcpBridge.mode`: `fixture` oppure `external`
- `mcpBridge.fixtureFile` o `mcpBridge.fixtures`: per test e bootstrap controllato
- `mcpBridge.command` e `mcpBridge.args`: bridge reale per i server MCP
- `config/codex.mcp.reference.toml`: registry dei server MCP locali copiato dal tuo Codex
- `logging.level`: `silent`, `error`, `info`, `debug`
- `mockTickets`: dataset locale per bootstrap e test

Per i dataset mock conviene valorizzare sempre entrambi:

- `productTarget`
- `contextMapping.productTarget`

cosi' il triage non dipende dall'inferenza semantica dei testi di esempio.

Per il DB MCP ci sono due modalita' equivalenti:

- `topology: "split"`: `targets.prod.server` e `targets.dev.server` puntano a due MCP diversi
- `topology: "unified"`: `targets.prod.server` e `targets.dev.server` possono puntare allo stesso MCP, lasciando alla config la distinzione dei target

Il codice del harness non deve assumere quale delle due topologie sia attiva.

Per i ticket reali passati da assistenza al tecnico, usare il template in [ticket-handoff-template.md](C:/Users/Gianmarco/Urgewalt/Malkuth/harness-docs/ticket-handoff-template.md) e rendere sempre esplicito il target `legacy`, `fatturhello` o `fiscobot`.

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

Il resume usa [memory.json](C:/Users/Gianmarco/Urgewalt/Malkuth/data/memory.json) come storico ticket operativo per evitare rivalutazioni inutili e loop sui ticket gia` rifiutati, bloccati o gia` in lavorazione.

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
- usa `llm_context` mock per decidere scope e fattibilita`
- produce un triage report leggibile

Scenario 1b, triage MCP:

- legge ticket da Jira tramite JQL o filtro configurato
- usa `llm_context` via bridge MCP come fonte primaria
- usa `llm_memory` come memoria primaria se configurato con `kind: "mcp"`
- ripiega sul file store solo se `llmMemory.kind = "mock"`
- usa `llm_db_prod_mcp` / `llm_db_dev_mcp` solo se il ticket richiede una query diagnostica

Scenario 2, triage + execution:

- seleziona ticket `feasible`
- crea branch `{ticketkey-lowercase}-{breve-spiegazione-kebab-case}`
- fa checkout del branch
- crea un commit mock chiaro
- apre una PR mock obbligatoria
- non esegue mai merge

Scenario 2c, execution MCP reale controllata:

- usa `llm_bitbucket_mcp` per creare branch da `BPOFH`
- controlla prima se esiste gia` una PR aperta per il branch previsto
- fa checkout nel `workspaceRoot` configurato
- crea commit e apre PR
- parte solo se `execution.dryRun = false` e `execution.allowRealPrs = true`
- si blocca subito se la config non e` coerente
- usa `llm_db_prod_mcp` / `llm_db_dev_mcp` solo per diagnosi puntuali prima di procedere

Scenario 2b, registry pronto per MCP:

- la config puo' dichiarare `kind: "mcp"` per Jira, `llm_context`, `llm_memory`, DB MCP e `llm_bitbucket_mcp`
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
- i DB MCP restano opzionali e on-demand

## Template Ticket

Per rendere i ticket facilmente implementabili:

- indicare sempre il `Target`
- descrivere il problema in una frase
- aggiungere 3-5 passi di riproduzione
- separare `Atteso` e `Attuale`
- includere almeno un identificativo concreto: partita IVA azienda, studio se presente, utente, id record, numero documento o protocollo

Template pronto all'uso:

- [ticket-handoff-template.md](C:/Users/Gianmarco/Urgewalt/Malkuth/harness-docs/ticket-handoff-template.md)

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
