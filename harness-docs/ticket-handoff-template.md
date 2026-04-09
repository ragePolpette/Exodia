# Ticket Handoff Template

Template compatto per il passaggio assistenza -> tecnico.

## Regole

- usare sempre un solo target principale
- se il ticket parla di `legacy-suite` o `classic-asp`, il target e` `legacy`
- se il ticket parla di `webportal` o `portal-web`, il target e` `webportal`
- se il ticket parla di `financebot`, il target e` `financebot`
- evitare testo narrativo lungo e screenshot senza contesto

## Template Compatto

```md
Titolo: [TARGET] azione + oggetto + effetto

Target: legacy | webportal | financebot
Ambiente: produzione
Partita IVA azienda: ...
Studio: ... (se presente)
Area funzionale: ...

Problema:
- cosa non funziona in una frase

Passi per riprodurre:
1. ...
2. ...
3. ...

Atteso:
- ...

Attuale:
- ...

Dati utili:
- utente:
- partita IVA azienda:
- studio:
- id record / numero documento / protocollo:

Evidenza:
- messaggio errore:
- endpoint/pagina:
- allegato o esempio input:

Vincoli:
- urgenza:
- impatto:
- note operative:
```

## Esempio Buono

```md
Titolo: [webportal] salvataggio anagrafica cliente blocca modifica PEC

Target: webportal
Ambiente: produzione
Partita IVA azienda: 01234567890
Studio: Studio Rossi
Area funzionale: anagrafica clienti

Problema:
- la modifica PEC non viene salvata dalla scheda cliente

Passi per riprodurre:
1. aprire cliente 10244
2. modificare la PEC
3. premere salva

Atteso:
- la nuova PEC viene salvata

Attuale:
- compare errore generico e il valore precedente resta invariato

Dati utili:
- utente: mario.rossi
- partita IVA azienda: 01234567890
- studio: Studio Rossi
- id record / numero documento / protocollo: cliente 10244

Evidenza:
- messaggio errore: "errore durante il salvataggio"
- endpoint/pagina: portal-web anagrafica cliente
- allegato o esempio input: PEC prova@test.it

Vincoli:
- urgenza: media
- impatto: il cliente non puo aggiornare i dati di fatturazione
- note operative: non riguarda shared-lib o financebot
```

## Anti-Pattern

- `non va`
- `errore cliente`
- `sistemare fatture`
- ticket senza target, senza passi e senza dato identificativo
