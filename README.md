# Binnacle — Alarm Console

A single-screen alarm management console built around a real
industrial standard, [ISA-18.2](https://www.isa.org/standards-and-publications/isa-standards/isa-standards-committees/isa18)
("Management of Alarm Systems for the Process Industries"), rather
than an invented "alerts panel" simplification.

A binnacle is the housing that holds a ship's compass and keeps it
steady and legible for the helmsman — a deliberate name for a console
whose whole job is to keep an operator's situational awareness intact
under exactly the conditions (an alarm flood, a shift change, a
nuisance alarm firing every few minutes) that most naive
implementations lose it.

This is stage 1 of a three-stage project. Stage 1 (this repo, as it
stands) is complete and shippable on its own. Stages 2 and 3 are
deliberately not started yet — see [Project scope and roadmap](#project-scope-and-roadmap).

## What this actually does

- Models the full ISA-18.2 alarm lifecycle as a **pure reducer**
  (`src/alarms/lifecycle.ts`): `UNACK → ACKED`, the `RTN_UNACK` state
  most naive implementations miss entirely (a condition that cleared
  but was never acknowledged while active still needs an operator to
  acknowledge that it happened), operator-driven `SHELVED` (with a
  reason and an expiry), system-driven flood `SUPPRESSED` (low
  priority only — high and critical alarms are never auto-suppressed,
  by construction, not by convention), and terminal `CLEARED`.
- The reducer never reads the real clock — every transition is driven
  by a caller-supplied `now`, including a periodic `TICK` event for
  time-based transitions like shelf expiry. That's what makes it
  provable: `src/alarms/lifecycle.properties.test.ts` uses
  [fast-check](https://fast-check.dev/) to generate thousands of
  random operator-action sequences and assert, on every single one,
  that a shelved alarm which re-trips always surfaces immediately
  (regardless of remaining shelf time) and that flood suppression
  never touches a high or critical alarm. That is a stronger claim
  than "I wrote tests for my UI" — it's "no input sequence can violate
  this invariant," checked by generation and shrinking, not just by
  the handful of examples in `lifecycle.test.ts`.
- A virtualized alarm list (`react-window`) so the board stays
  responsive under a real flood, with every row action
  (Acknowledge / Clear / Shelve / Unshelve) as a plain, labeled
  `<button>` — the list is keyboard-operable by construction, not as
  an afterthought.
- A flood banner (`<output>`, carrying an implicit `status` ARIA role)
  that's visible independent of any one alarm row, so an operator
  sees the flood condition even if the alarms involved have scrolled
  out of view.
- An inline (non-modal) shelve form, chosen deliberately over a
  dialog to avoid focus-trap complexity for a low-frequency action.

## What's synthetic

There is no real plant, PLC, or SCADA system behind this. The "Demo
controls" at the bottom of the console and `src/sim/simulator.ts` are
**entirely synthetic**, invented tag names and a deliberately bursty
timing model built only so a reviewer can see the flood-suppression
and shelving behavior on screen without waiting on a live feed. None
of it should be mistaken for real industrial data. The WebSocket
server (`server/`) that would eventually replace this with a
simulated — still not real, but at least decoupled — event stream has
not been built yet (see roadmap below).

## Scope: what this deliberately does not do

Stated plainly, not hidden in a comment:

- No audit journal. A real ISA-18.2 system logs every state
  transition for compliance review; this reducer retires a cleared
  `SUPPRESSED` alarm directly rather than keeping a permanent record.
- No alarm rationalization workflow (the process of deciding, per
  tag, what its priority and setpoints should be) — priorities here
  are assigned at raise time by whatever raises the alarm.
- No multi-operator / shift-handover model. The console assumes one
  operator viewing one board.
- No persistence. Refreshing the page loses all alarm state — there
  is no backend yet to persist it to.

## Running it

```sh
npm install
npm run dev      # local dev server
npm run test     # vitest: unit + property-based + component tests
npm run lint      # oxlint, incl. native jsx-a11y and vitest plugins
npm run build     # tsc -b && vite build
```

## Project scope and roadmap

This is stage 1 of a three-stage project, built in that order
deliberately so each stage leaves a complete, shippable console
rather than a half-finished one:

1. **Alarm console** (this repo, as it stands) — the ISA-18.2
   lifecycle, virtualized UI, accessibility, CI, and this scope
   writeup.
2. **Mode-confusion-safe autonomy handoff panel** (not started) —
   modeling the operator/automation handoff with
   [XState](https://stately.ai/docs/xstate) and the same
   property-based verification technique established here, proving
   invariants like "the UI can never simultaneously imply automatic
   and manual control." Mode confusion is a real, named contributing
   factor in several industrial and aviation incidents.
3. **Explainable-AI recommendation review console** (not started) —
   a review UI for AI-generated recommendations that makes the
   reasoning inspectable rather than a black box, mirroring the kind
   of "intelligence layer" UX pattern increasingly common in
   industrial software.

## CI

`.github/workflows/ci.yml` runs on every push and pull request to
`main`: lint (oxlint, with its native `jsx-a11y` and `vitest` plugins
enabled), `tsc -b`, the full test suite (unit + property-based +
component tests, including the jest-axe accessibility assertions —
there's no separate "accessibility gate" step because a real failing
assertion is a harder gate than a non-blocking report), a production
build, and `scripts/check-bundle-budget.mjs`, which fails the build if
the shipped JS or CSS exceeds a real, enforced gzip size budget rather
than just printing a number for someone to eyeball later.
