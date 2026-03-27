# Malkuth

Malkuth e` un harness locale per triage, verifica ed execution controllata di ticket tecnici.

Il progetto e` pensato per:

- uso personale o di team in workstation controllate
- integrazione locale con adapter `mock` o `mcp`
- portfolio tecnico pubblico, senza valori sensibili nel repository

Il progetto non e` pensato per:

- deploy pubblico come servizio esposto
- utilizzo out-of-the-box contro tenant o repository reali
- eseguire merge automatici o azioni irreversibili senza policy locali esplicite

## Scopo

Il flow coperto dal tool e` questo:

1. leggere ticket da una sorgente configurata
2. mappare il ticket verso target prodotto e codebase
3. riusare memoria operativa e memoria semantica opzionale
4. verificare policy, payload, path, comandi e hygiene pubblica
5. eseguire branch, commit e PR solo se il trust level e la config locale lo consentono

## Architettura

Diagramma logico:

```text
Ticket source
  -> Jira adapter (mock | mcp)
  -> TriageAgent
       -> llm-context adapter
       -> ticket memory file
       -> llm-memory adapter
       -> optional SQL diagnostics
  -> VerificationAgent
       -> payload checks
       -> path policy
       -> command preflight
       -> public hygiene scan
  -> ExecutionAgent
       -> bitbucket adapter (mock | mcp)
       -> optional SQL diagnostics
  -> Reports
       -> triage report
       -> execution report
       -> final report
       -> audit trail
```

Struttura principale:

- `src/orchestration/run-harness.js`: orchestration centrale del run
- `src/adapters/`: adapter runtime, separati tra blocchi generici e enterprise-oriented
- `src/agents/`: `TriageAgent`, `VerificationAgent`, `ExecutionAgent`
- `src/mcp/`: bridge MCP, registry parsing e client wrapper
- `src/security/`: scanner public hygiene e redaction
- `src/reporting/`: report finale strutturato
- `config/`: example pubblicabili e guida alla config locale

## Sicurezza

Guardrail attivi nel runtime:

- `allowMerge` resta bloccato
- `allowRealPrs` deve essere esplicitamente abilitato
- `trustLevel` distingue `mock`, `mcp-readonly`, `mcp-write`
- allowlist per repository, branch base, comandi e action MCP
- scanner su stringhe sensibili e placeholder safety degli example
- redaction su report, log e memoria semantica

Non-obiettivi:

- deploy automatico
- merge automatico
- ticket closing automatico
- memorizzazione nel repo di tenant, cloudId, path locali, namespace reali o segreti

## Quick Start

Prerequisiti:

- Node.js 22+
- config locale derivata dagli example in `config/`

Installazione:

```bash
npm install
```

Triage mock:

```bash
node src/cli.js triage --config ./config/harness.config.example.json --dry-run
```

Run completo mock:

```bash
node src/cli.js run --config ./config/harness.config.example.json --dry-run
```

Audit pubblico:

```bash
node src/cli.js audit --config ./config/harness.config.example.json
```

Review finale di publish-readiness:

```bash
node src/cli.js review --config ./config/harness.config.example.json
```

Report finale:

```bash
node src/cli.js execute --config ./config/harness.config.example.json --dry-run --report final
```

## Configurazione Locale

Gli example tracciati sono pubblicabili:

- `config/harness.config.example.json`
- `config/harness.config.mcp.example.json`
- `config/harness.config.real.example.json`
- `config/harness.config.triage.codex-local.example.json`

I valori reali devono stare in file locali non tracciati, per esempio:

- `config/local/harness.local.json`
- `config/local/harness.mcp.local.json`
- `config/local/harness.real.local.json`
- `config/codex.mcp.local.toml`

Guida dettagliata:

- `config/LOCAL_CONFIGURATION.md`

Valori da tenere sempre fuori repo:

- path locali
- repository e branch reali
- cloudId, tenant, namespace
- SQL di persistenza del run log
- command line del bridge MCP reale

Autenticazione locale:

- non usare file `.env`
- non usare `.env.local`
- passa le chiavi al lancio del `.ps1`
- oppure gestiscile dalla dashboard locale `C:\Users\Gianmarco\Urgewalt\Yetzirah\mcp-dashboard`

## Workflow Enterprise Locale

Flow consigliato:

1. configura gli adapter reali in file locali non tracciati
2. usa `mcp-readonly` per validare il triage e la verification
3. abilita `mcp-write` solo sul repository consentito e sul branch base consentito
4. lascia `allowMerge = false`
5. usa il report finale e l'audit trail come output del run

## Esempio End-To-End

Esempio di flusso:

1. Jira adapter legge un ticket aperto
2. `TriageAgent` assegna `productTarget`, `repoTarget`, fattibilita` e hint
3. `VerificationAgent` controlla confidenza, naming, path cambiati, preflight e hygiene
4. `ExecutionAgent` crea branch, commit e PR solo se il verdetto e` `approved`
5. il run produce `triageReport`, `executionReport`, `finalReport` e `auditTrail`

## Comandi

```bash
node src/cli.js --help
node src/cli.js triage --config ./config/harness.config.example.json --dry-run
node src/cli.js run --config ./config/harness.config.example.json --dry-run
node src/cli.js execute --config ./config/harness.config.real.example.json --real-run --report execution
node src/cli.js audit --config ./config/harness.config.example.json
node src/cli.js review --config ./config/harness.config.example.json
node --test
```

## Stato

Attuale direzione del progetto:

- runtime locale strutturato
- verification gate introdotto
- bridge MCP indurito con retry, timeout e failure mode testabili
- config sensibile esternalizzata
- final report e audit trail disponibili

Verifica completa e pubblicazione finale restano separate e vanno eseguite alla fine del batch di sviluppo.
