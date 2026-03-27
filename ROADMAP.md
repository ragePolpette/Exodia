# Malkuth Roadmap

Questo file e` la checklist operativa del progetto.

Obiettivo del tool:
- harness locale e sicuro per triage, verifica ed execution controllata di ticket tecnici
- utilizzabile da me e da colleghi in ambiente enterprise
- presentabile come portfolio pubblico su GitHub
- non deployabile pubblicamente come servizio esposto

Vincoli permanenti:
- nessuna chiave, tenant, cloudId, path locale, repo aziendale o naming sensibile deve restare hardcoded nel repo pubblico
- ogni integrazione reale deve passare da config locale fuori repo
- merge, deploy, chiusura ticket e azioni irreversibili devono restare sotto guardrail espliciti

## Workflow operativo

Per ogni milestone o sottostep:

- [ ] creare branch dedicato `feat/...` o `refactor/...`
- [ ] implementare solo lo scope previsto dallo step
- [ ] eseguire `node --test`
- [ ] aggiornare questo file marcando i punti completati
- [ ] commit con messaggio chiaro
- [ ] push del branch
- [ ] aprire PR
- [ ] fare merge solo dopo verifica finale dello step

## Milestone 0 - Allineamento identita` progetto

- [x] rinominare il progetto in modo neutro e portfolio-safe in `package.json`, CLI, report e README
- [x] rimuovere dal README il framing troppo legato a prodotti o repository interni
- [x] definire nel README il posizionamento corretto: local-first ticket automation harness
- [x] separare chiaramente uso interno, portfolio pubblico e limiti di sicurezza

## Milestone 1 - Verification Agent

- [x] introdurre `VerificationAgent` tra triage ed execution
- [x] definire contratto di output del verification step: `approved | blocked | needs_review`
- [x] verificare coerenza ticket -> product target -> repo target
- [x] bloccare execution su mapping ambiguo o su evidenza insufficiente
- [x] verificare che branch, commit message e PR payload siano conformi alle policy
- [x] verificare che il diff resti entro path consentiti
- [x] eseguire comandi di verifica configurabili prima di aprire PR
- [x] aggiungere test dedicati per il nuovo agente e per i blocchi attesi

## Milestone 2 - Externalizzazione completa della config sensibile

- [x] spostare fuori dal codice tutti i path locali
- [x] spostare fuori dal codice tutti i cloudId, tenant e URL specifici
- [x] spostare fuori dal codice tutti i nomi repo, project key e branch base
- [x] spostare fuori dal codice namespace e naming operativi specifici
- [x] creare config example generici e pubblicabili
- [x] introdurre file locali ignorati da git per le config reali
- [x] aggiornare `.gitignore` per config locali e segreti
- [x] documentare chiaramente cosa va creato localmente fuori repo

## Milestone 3 - Generalizzazione del modello dominio

- [x] rimuovere dal codice le inferenze hardcoded basate su naming prodotto attuale
- [x] introdurre `targetRules` e sinonimi caricati da config
- [x] rendere configurabili repo target, aree e policy di mapping
- [x] rendere i prompt agent neutrali rispetto al dominio aziendale
- [x] rendere i test indipendenti dai nomi prodotto attuali dove non strettamente necessario

## Milestone 4 - Hardening sicurezza e public hygiene

- [x] aggiungere scanner interno per riferimenti sensibili nel repo
- [x] bloccare path, URL, tenant, namespace e valori vietati prima del commit o della PR
- [x] aggiungere controllo su file example per evitare leakage di dati reali
- [x] aggiungere redaction policy per report, log e memoria semantica
- [x] aggiungere allowlist esplicita per action MCP e comandi eseguibili
- [x] rivedere i prompt per evitare output che suggeriscano operazioni non consentite

## Milestone 5 - Hardening bridge MCP

- [x] completare il wiring reale delle operazioni oggi ancora stub
- [x] completare o rimuovere i path dichiarati ma non implementati
- [x] aggiungere timeout, error taxonomy e retry policy chiari
- [x] separare meglio adapter generici da adapter enterprise-specific
- [x] aggiungere test sui failure mode del bridge

## Milestone 6 - Governance execution

- [x] rendere configurabili policy di `allowRealPrs`, `allowMerge`, repo consentiti e branch consentiti
- [x] impedire qualunque merge automatico se non espressamente autorizzato da policy locale
- [x] introdurre livelli di trust per `mock`, `mcp-readonly`, `mcp-write`
- [x] aggiungere report finale strutturato per ogni run
- [x] aggiungere audit trail minimale ma leggibile

## Milestone 7 - Documentazione finale portfolio-safe

- [x] riscrivere README con esempio generico e neutro
- [x] aggiungere sezione architettura con diagramma logico testuale
- [x] aggiungere sezione sicurezza e non-obiettivi
- [x] aggiungere quick start solo locale e non deploy
- [x] aggiungere guida per configurazione enterprise fuori repo
- [x] aggiungere esempio di flusso completo triage -> verification -> execution

## Milestone 8 - Review finale prima della pubblicazione

- [x] rieseguire `node --test`
- [x] eseguire audit finale su stringhe sensibili residue
- [x] verificare che tutti gli example siano generici
- [x] verificare che nessun file tracciato punti a tenant o path reali
- [x] verificare che il progetto non sia presentato come servizio deployabile
- [x] verificare che questo file sia aggiornato e coerente con lo stato reale

## Log avanzamento

- [x] roadmap iniziale creata
- [x] milestone 0 completata: identita` progetto e framing portfolio-safe allineati
- [x] milestone 1 avviata: verification gate introdotto tra triage ed execution
- [x] milestone 1 completata: verification gate, preflight path policy e command checks attivi
- [x] milestone 2 completata: config sensibile esterna al repo e example sanificati
- [x] milestone 3 avviata: target rules e sinonimi spostati in config runtime
- [x] milestone 3 completata: mapping config-driven, prompt neutrali e test ripuliti dal dominio superfluo
- [x] milestone 4 completata: scanner, allowlist e redaction pubblica attivi nel runtime
- [x] milestone 5 avviata: path Jira filter, error taxonomy e retry del bridge allineati
- [x] milestone 5 completata: sql bridge reale, adapter bootstrap separato e failure mode coperti
- [x] milestone 6 completata: trust levels, execution policy e final report governati dal runtime
- [x] milestone 7 completata: README riallineato al runtime locale e portfolio-safe
- [x] tooling finale aggiunto: comando `review` per publish-readiness e policy `.env`
- [x] milestone 8 completata: test, audit e review finale tutti verdi
- [x] sviluppo milestone operative avviato
