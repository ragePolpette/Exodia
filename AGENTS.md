# AGENTS.md (Malkuth)

## Scope
- Valido solo dentro `Malkuth/`.

## Workflow minimo
- Leggi prima `README.md` e poi i file sotto `src/`, `config/` o `tests/` rilevanti al task.
- Tratta questo repo come harness operativo locale, non come sandbox usa-e-getta.

## Dependency Policy
- Se modifichi `package.json` o `package-lock.json`, esegui `node C:\Users\Gianmarco\Urgewalt\dependency-policy\dependency-policy-check.mjs --repo . --mode auto` prima di chiudere il task.
- Se il check fallisce, il task non va considerato concluso senza eccezione approvata in `C:\Users\Gianmarco\Urgewalt\SECURITY_EXCEPTIONS.md`.
- Se non tocchi manifest o lockfile dipendenze, questo check non è obbligatorio.

## Chiusura task
- Se hai toccato manifest o lockfile dipendenze, nel riepilogo finale devi riportare esplicitamente quale comando di dependency-policy hai eseguito e se è passato o fallito.
- Non dichiarare il task concluso omettendo un risultato dependency-policy fallito.
