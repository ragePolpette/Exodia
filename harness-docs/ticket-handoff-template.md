# Support Ticket Template

Short template for helpdesk and first-line support.

Goal:

- make the ticket readable by a human on first pass
- give Exodia enough data to recover the company by VAT number
- point Exodia to the page where the bug usually happens
- include one concrete case that can be checked in code or DB

## Required Rules

- always include `PI`
- include `Ragione sociale` whenever available
- always include `URL pagina`
- always include one concrete example such as document number, record id, or date range
- if the issue is numeric, always include `Valore attuale` and `Valore atteso`
- avoid vague text like `non funziona` or `totale errato` without an example

## Recommended Template

```md
## Descrizione

### Cliente
Ragione sociale:
PI:
Telefono:

### Contesto
URL pagina:
Modulo/Funzione:

### Problema segnalato
Descrizione breve e concreta del problema.

### Caso concreto
Documento / numero:
Data / periodo:
Valore attuale:
Valore atteso:

### Passi o condizioni per vederlo
1. ...
2. ...
3. ...

### Impatto
Perche' il problema e' rilevante per il cliente.

### Allegati o evidenze
Screenshot / export / file / note aggiuntive.
```

## Why This Works For Exodia

- `PI` lets Exodia recover the company id through DB lookup
- `Ragione sociale` helps disambiguate when the VAT lookup is not enough
- `URL pagina` usually identifies the module where the bug happens
- `Documento / numero` gives a concrete repro anchor
- `Valore attuale` and `Valore atteso` make numeric bugs auditable

## Example

```md
## Descrizione

### Cliente
Ragione sociale: SYSTEMCART GROUP S.R.L.
PI: 01835620897
Telefono: 3397600810

### Contesto
URL pagina: https://new.bitimpresa.it/contabilita.aspx
Modulo/Funzione: Partitario / Scheda cliente

### Problema segnalato
Nel partitario la fattura n. 8 viene mostrata con importo intero, senza considerare lo sconto di fine documento.

### Caso concreto
Documento / numero: Fattura n. 8
Data / periodo: [se noto]
Valore attuale: importo intero
Valore atteso: importo al netto dello sconto di fine documento di 1387,14 euro

### Passi o condizioni per vederlo
1. Aprire la scheda cliente.
2. Aprire il partitario del cliente.
3. Verificare la fattura n. 8.

### Impatto
La scheda cliente risulta errata perche' riporta un importo non corretto.

### Allegati o evidenze
[eventuali screenshot o export]
```

## Anti-Pattern

- `non funziona`
- `totale sbagliato`
- `errore in contabilita`
- ticket senza `PI`
- ticket senza `URL pagina`
- ticket senza caso concreto
