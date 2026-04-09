# Prompt Adaptation Notes

Regole canoniche per interpretare i ticket nel workspace gestito da `Malkuth`.

## Product Targets

- `legacy`
  - Trigger lessicale: `legacy-suite`, `classic-asp`
  - Significato: backend legacy + frontend Classic ASP
  - Percorso tipico: `api/` + root `.asp`

- `webportal`
  - Trigger lessicale: `webportal`, `portal-web`
  - Significato: area `public-web/` del prodotto principale
  - Includi di default: `public-web/` rilevante per il ticket
  - Escludi di default: area `shared-lib`, librerie `SharedLib`, librerie `FinanceBot`, UI/JS `shared-lib`

- `financebot`
  - Trigger lessicale: `financebot`
  - Significato: dominio contabile dedicato
  - Includi di default: `public-web/`, librerie `SharedLib`, librerie `FinanceBot`, UI/JS FinanceBot

## Precedence Rules

1. Se il ticket cita `financebot`, il target e` `financebot`.
2. Se il ticket cita `legacy-suite` o `classic-asp`, il target e` `legacy`.
3. Se il ticket cita `webportal` o `portal-web`, il target e` `webportal`.
4. Se il ticket non e` esplicito, usare gli indizi del dominio e fermarsi in `feasible_low_confidence` se il mapping non e` univoco.

## Guardrail

- Non usare `legacy` come etichetta ombrello per tutto il workspace.
- Distinguere sempre `product_target` da `repo_target`.
- Non inferire `financebot` per semplice vicinanza terminologica a contabilita` o prima nota senza segnali concreti.
- Quando il ticket e` ambiguo tra `legacy` e `webportal`, non passare direttamente all'execution.
