# Human-In-The-Loop Demo

This is the shortest useful demo of what makes `Exodia` different from a generic ticket-to-PR pipeline.

## Scenario

A ticket is ambiguous. The agent can map the issue to more than one plausible target, so it does not guess.

## Step 1: the run stops safely

```text
Exodia Triage Report
Mode: triage-only
Dry run: true
Tickets loaded: 1
Interactions: pending=1 resolved=0

- WEB-342: awaiting_input | confidence=0.61 | product=unknown | repo=UNKNOWN
  reason: awaiting human clarification (int-2026-04-14-001) on slack+ticket
  hint: Which repository owns the invoice validation flow: public-web or automation-suite?
```

## Step 2: the agent asks on Slack

```text
[Exodia][Interaction int-2026-04-14-001] Clarification required for WEB-342
Phase: triage
Question: Which repository owns the invoice validation flow: public-web or automation-suite?
Why: llm-context found conflicting evidence across two targets

Reply here or on the configured ticket thread. The first valid answer wins.
```

## Step 3: a human answers

```text
public-web. The failure is in the public invoice form validation, not in the automation flow.
```

## Step 4: the next run resumes

```text
Exodia Final Report
Mode: triage-and-execution
Dry run: true
Tickets loaded: 1
Interactions: pending=0 resolved=1

Triage counts:
- feasible: 1

Verification counts:
- approved: 1

Audit trail:
- interaction: interaction state synchronized
- triage: triage completed
- verification: verification completed
- execution: execution completed
```

## Step 5: the answer is remembered

The raw answer stays in the interaction store.

The useful part is distilled into memory:

- `product_target=public-app`
- `repo_target=public-web`
- clarification source: `slack`
- clarification summary: `public invoice form validation lives in public-web`

That means the next similar ticket does not start from zero.

## Why This Matters

The interesting part is not that the system can open a PR.

The interesting part is that it can:

- stop when confidence is too low
- ask for clarification on a real collaboration channel
- resume deterministically on the next run
- turn the answer into reusable memory
