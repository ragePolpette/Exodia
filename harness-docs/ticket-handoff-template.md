# Technical Ticket Template

Compact template for a clean support -> engineering handoff.

## Rules

- use one primary target only
- keep the title descriptive and action-oriented
- include exact repro steps
- include at least one identifying record, document, or user reference when possible
- avoid long narrative text and screenshots without context

## Recommended Template

```md
Title: [TARGET] action + object + visible effect

Target: legacy | public-app | automation-bot | unknown
Environment: production | staging | local
Functional area: ...

Problem:
- one sentence describing what is failing

Steps to reproduce:
1. ...
2. ...
3. ...

Expected:
- ...

Actual:
- ...

Useful identifiers:
- user:
- account / tenant / workspace:
- record id / document id / protocol:

Evidence:
- error message:
- endpoint / page / workflow:
- sample payload or input:

Constraints:
- urgency:
- impact:
- notes:
```

## Good Example

```md
Title: [public-app] customer profile save rejects VAT update

Target: public-app
Environment: production
Functional area: customer profile

Problem:
- updating the VAT number fails when saving the customer profile

Steps to reproduce:
1. open customer profile 10244
2. change the VAT number
3. press save

Expected:
- the new VAT number is stored

Actual:
- the form shows a generic save error and restores the previous value

Useful identifiers:
- user: mario.rossi
- account / tenant / workspace: studio-rossi
- record id / document id / protocol: customer 10244

Evidence:
- error message: "save failed"
- endpoint / page / workflow: public customer profile form
- sample payload or input: VAT IT01234567890

Constraints:
- urgency: medium
- impact: billing data cannot be updated
- notes: issue appears isolated to the public profile flow
```

## Anti-Pattern

- `it does not work`
- `customer error`
- `fix invoices`
- ticket without target, repro steps, or identifying data
