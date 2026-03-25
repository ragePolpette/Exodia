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

- [ ] spostare fuori dal codice tutti i path locali
- [ ] spostare fuori dal codice tutti i cloudId, tenant e URL specifici
- [ ] spostare fuori dal codice tutti i nomi repo, project key e branch base
- [ ] spostare fuori dal codice namespace e naming operativi specifici
- [ ] creare config example generici e pubblicabili
- [ ] introdurre file locali ignorati da git per le config reali
- [ ] aggiornare `.gitignore` per config locali e segreti
- [ ] documentare chiaramente cosa va creato localmente fuori repo

## Milestone 3 - Generalizzazione del modello dominio

- [ ] rimuovere dal codice le inferenze hardcoded basate su naming prodotto attuale
- [ ] introdurre `targetRules` e sinonimi caricati da config
- [ ] rendere configurabili repo target, aree e policy di mapping
- [ ] rendere i prompt agent neutrali rispetto al dominio aziendale
- [ ] rendere i test indipendenti dai nomi prodotto attuali dove non strettamente necessario

## Milestone 4 - Hardening sicurezza e public hygiene

- [ ] aggiungere scanner interno per riferimenti sensibili nel repo
- [ ] bloccare path, URL, tenant, namespace e valori vietati prima del commit o della PR
- [ ] aggiungere controllo su file example per evitare leakage di dati reali
- [ ] aggiungere redaction policy per report, log e memoria semantica
- [ ] aggiungere allowlist esplicita per action MCP e comandi eseguibili
- [ ] rivedere i prompt per evitare output che suggeriscano operazioni non consentite

## Milestone 5 - Hardening bridge MCP

- [ ] completare il wiring reale delle operazioni oggi ancora stub
- [ ] completare o rimuovere i path dichiarati ma non implementati
- [ ] aggiungere timeout, error taxonomy e retry policy chiari
- [ ] separare meglio adapter generici da adapter enterprise-specific
- [ ] aggiungere test sui failure mode del bridge

## Milestone 6 - Governance execution

- [ ] rendere configurabili policy di `allowRealPrs`, `allowMerge`, repo consentiti e branch consentiti
- [ ] impedire qualunque merge automatico se non espressamente autorizzato da policy locale
- [ ] introdurre livelli di trust per `mock`, `mcp-readonly`, `mcp-write`
- [ ] aggiungere report finale strutturato per ogni run
- [ ] aggiungere audit trail minimale ma leggibile

## Milestone 7 - Documentazione finale portfolio-safe

- [ ] riscrivere README con esempio generico e neutro
- [ ] aggiungere sezione architettura con diagramma logico testuale
- [ ] aggiungere sezione sicurezza e non-obiettivi
- [ ] aggiungere quick start solo locale e non deploy
- [ ] aggiungere guida per configurazione enterprise fuori repo
- [ ] aggiungere esempio di flusso completo triage -> verification -> execution

## Milestone 8 - Review finale prima della pubblicazione

- [ ] rieseguire `node --test`
- [ ] eseguire audit finale su stringhe sensibili residue
- [ ] verificare che tutti gli example siano generici
- [ ] verificare che nessun file tracciato punti a tenant o path reali
- [ ] verificare che il progetto non sia presentato come servizio deployabile
- [ ] verificare che questo file sia aggiornato e coerente con lo stato reale

## Log avanzamento

- [x] roadmap iniziale creata
- [x] milestone 0 completata: identita` progetto e framing portfolio-safe allineati
- [x] milestone 1 avviata: verification gate introdotto tra triage ed execution
- [x] milestone 1 completata: verification gate, preflight path policy e command checks attivi
- [x] sviluppo milestone operative avviato
