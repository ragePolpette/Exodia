# Prompt Adaptation Notes

Regole canoniche per interpretare i ticket nel monorepo `Bpopilot`.

## Product Targets

- `legacy`
  - Trigger lessicale: `bpo`, `bpopilot`
  - Significato: backend legacy + frontend Classic ASP
  - Percorso tipico: `api/` + root `.asp`

- `fatturhello`
  - Trigger lessicale: `fatturhello`, `yeti`
  - Significato: area `pubblico/` del prodotto principale
  - Includi di default: `pubblico/` rilevante per il ticket
  - Escludi di default: area `bpofh`, librerie `BpoFH`, librerie `Fiscobot`, UI/JS `bpofh`

- `fiscobot`
  - Trigger lessicale: `fiscobot`
  - Significato: dominio contabile dedicato
  - Includi di default: `pubblico/`, librerie `BpoFH`, librerie `Fiscobot`, UI/JS Fiscobot

## Precedence Rules

1. Se il ticket cita `fiscobot`, il target e` `fiscobot`.
2. Se il ticket cita `bpo` o `bpopilot`, il target e` `legacy`.
3. Se il ticket cita `fatturhello` o `yeti`, il target e` `fatturhello`.
4. Se il ticket non e` esplicito, usare gli indizi del dominio e fermarsi in `feasible_low_confidence` se il mapping non e` univoco.

## Guardrail

- Non usare `BpoPilot` come etichetta ombrello per tutto il monorepo.
- Distinguere sempre `product_target` da `repo_target`.
- Non inferire `fiscobot` per semplice vicinanza terminologica a contabilita` o prima nota senza segnali concreti.
- Quando il ticket e` ambiguo tra `legacy` e `fatturhello`, non passare direttamente all'execution.
