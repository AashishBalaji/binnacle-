# Binnacle — Alarm Console

A single-screen alarm management console built around a real
industrial standard, [ISA-18.2](https://www.isa.org/standards-and-publications/isa-standards/isa-standards-committees/isa18)
("Management of Alarm Systems for the Process Industries"), rather
than a simplified "alerts panel."

A binnacle is the housing that holds a ship's compass steady and
legible for the helmsman — the name is a reference to the console's
purpose: keeping an operator's situational awareness intact during an
alarm flood, a shift change, or a nuisance alarm firing every few
minutes, which is exactly when a naive alerts list tends to lose it.

This is a three-stage project, each stage built to be complete and
shippable on its own: the alarm console itself, a mode-confusion-safe
automation handoff, and an explainable-AI recommendation review
console. All three are complete — see
[Project scope and roadmap](#project-scope-and-roadmap) for the detail
on each.

## What this does

- Models the ISA-18.2 alarm lifecycle as a pure reducer
  (`src/alarms/lifecycle.ts`): `UNACK → ACKED`, the `RTN_UNACK` state
  that a simplified alerts list typically misses (a condition that
  cleared but was never acknowledged while active still needs an
  operator to acknowledge that it happened), operator-driven
  `SHELVED` (with a reason and an expiry), system-driven flood
  `SUPPRESSED` (low priority only — high and critical alarms are
  never auto-suppressed), and terminal `CLEARED`.
- The reducer never reads the real clock — every transition is driven
  by a caller-supplied `now`, including a periodic `TICK` event for
  time-based transitions like shelf expiry. `src/alarms/lifecycle.properties.test.ts`
  uses [fast-check](https://fast-check.dev/) to generate thousands of
  random operator-action sequences and check two invariants on every
  one of them: a shelved alarm that re-trips always surfaces
  immediately (regardless of remaining shelf time), and flood
  suppression never applies to a high or critical alarm. The
  flood-window check uses a binary search rather than a linear scan,
  since raise timestamps are always appended in increasing order —
  matters once a board is tracking hundreds of tags under a real
  flood, though at demo scale either approach is instant.
- A small backend (`server/`) that actually serves the demo data over
  the network instead of a client-only button: a REST endpoint
  (`GET /api/alarms/history`) and a WebSocket stream (`/ws`) that
  pushes new synthetic alarms to connected clients, with its own test
  suite covering both. It's plain Node (`http` + `ws`), no framework
  — two routes don't need one, and it keeps the backend's dependency
  footprint as small as the frontend's.
- A virtualized alarm list (`react-window`) so the board stays
  responsive under a real flood, with every row action
  (Acknowledge / Clear / Shelve / Unshelve) as a plain, labeled
  `<button>` — keyboard-operable without any extra work.
- A flood banner (`<output>`, which carries an implicit `status` ARIA
  role) that's visible independent of any one alarm row, so an
  operator sees the flood condition even if the alarms involved have
  scrolled out of view.
- An inline (non-modal) shelve form, chosen over a dialog to avoid
  focus-trap complexity for a low-frequency action.
- A mode-confusion-safe operator/automation handoff panel
  (`src/handoff/`, stage 2 — see roadmap below for the detail), with
  its own XState machine and fast-check property proofs.
- An explainable-AI recommendation panel (`src/recommendations/`,
  stage 3 — see roadmap below) that reviews the current board and
  suggests Acknowledge / Shelve / Escalate actions, each with a
  weighted-factor breakdown an operator can expand and read, not a
  bare confidence number. Accepting a recommendation applies the real
  alarm action (`ack`/`shelve`) through the same lifecycle reducer as
  the manual row buttons.

## What's synthetic

There is no real plant, PLC, or SCADA system behind this. The "Demo
controls" in the console, `src/sim/simulator.ts` (client-side), and
`server/alarmFeed.mjs` (server-side) are all synthetic — invented tag
names and a bursty timing model, built only so a reviewer can see the
flood-suppression and shelving behavior without a live feed. Every
REST and WebSocket response from `server/` marks itself
`"synthetic": true` for the same reason. None of it should be
mistaken for real industrial data.

## Scope: what this does not do

- No audit journal. A real ISA-18.2 system logs every state
  transition for compliance review; this reducer retires a cleared
  `SUPPRESSED` alarm directly rather than keeping a permanent record.
- No alarm rationalization workflow (deciding, per tag, what its
  priority and setpoints should be) — priorities here are assigned at
  raise time by whatever raises the alarm.
- No multi-operator / shift-handover model. The console assumes one
  operator viewing one board.
- No persistence beyond the backend's in-memory, size-capped history
  (200 events). Restarting the server clears it; there's no database.
- No trained ML model behind the "AI" in stage 3's recommendation
  engine (`src/recommendations/engine.ts`) — it's a deterministic,
  rule-based scoring function, on purpose: see that file's docstring
  for why a real model would work against the stage's actual goal
  (an inspectable, provably-explainable recommendation, not a label
  claiming to be one).
- No real escalation/paging system behind stage 3's ESCALATE action.
  Accepting an ESCALATE recommendation acknowledges the alarm and
  records the decision in the (in-memory, non-persistent) review log
  — nothing is actually paged or ticketed.

## Running it

```sh
npm install
npm run dev             # frontend dev server
npm run start:server    # backend: REST on /api, WebSocket on /ws
npm run test            # vitest: unit + property-based + component + server tests
npm run test:coverage   # same, with the coverage gate from vite.config.ts
npm run lint             # oxlint, incl. native jsx-a11y and vitest plugins
npm run build            # tsc -b && vite build
```

## Project scope and roadmap

Each stage is built to be complete and shippable on its own, rather
than a scaffold for the next one:

1. **Alarm console** (complete) — the ISA-18.2 lifecycle, the backend
   feed, the virtualized UI, accessibility, CI, and this scope
   writeup.
2. **Mode-confusion-safe autonomy handoff** (complete) —
   `src/handoff/handoffMachine.ts` models an operator/automation
   handoff as an [XState](https://stately.ai/docs/xstate) machine
   with five states (`manual`, `automationPending`, `automatic`,
   `manualPending`, `failsafe`). The two safety properties this
   exists to guarantee, each proved with the same fast-check
   generative approach as stage 1: automation can never take control
   in a single step (it always passes through
   `automationPending` and an explicit operator confirmation first),
   and no pending state can wait forever on an unresponsive
   operator — an unanswered automation request safely times out back
   to manual, and an unacknowledged handback times out to a loud
   `failsafe` state rather than silently assuming the operator
   noticed. An operator override, by contrast, is always a single
   immediate transition with no confirmation step, because reclaiming
   control must never be made to wait. Timeouts use the same
   explicit-`now`/`TICK` discipline as the stage 1 reducer rather
   than XState's timer-based `after`, so the machine stays
   deterministic to test. `HandoffPanel.tsx` renders one unambiguous
   state at a time — never a blended "manual/automatic" indicator.
3. **Explainable-AI recommendation review console** (complete) —
   `src/recommendations/engine.ts` is a pure, deterministic,
   rule-based scoring function (`generateRecommendations(board, now)`)
   over the same alarm board stage 1 already models — not a trained
   model, deliberately: the stage's actual claim is that a
   recommendation's reasoning is genuinely inspectable, and the only
   way to make that true rather than asserted is for the reasoning to
   be a short list of named, weighted rules rather than a model's
   opaque output. Three recommended actions: ACKNOWLEDGE (the default
   for any unacknowledged alarm), ESCALATE (once a critical/high alarm
   passes a priority-specific age threshold — never recommended for
   low priority, the same severity-gating principle as stage 1's flood
   suppression), and SHELVE (a low-priority alarm still active well
   past acknowledgment — the classic ISA-18.2 nuisance-alarm pattern).
   Every recommendation's `confidence` is the clamped sum of its own
   `factors[].weight`, so the breakdown `RecommendationPanel.tsx`
   shows behind a native `<details>`/`<summary>` disclosure always
   adds up to the number an operator is being asked to trust — proved
   for arbitrary boards by `engine.properties.test.ts`'s fast-check
   invariants, the same generative-testing discipline as stages 1 and
   2. Accepting a recommendation dispatches the real `ack`/`shelve`
   action (ESCALATE also acks — see the scope note above on why);
   rejecting just records the decision. `useRecommendationReview.ts`
   keys each decision by tag *and* the alarm excursion's `raisedAt`,
   so a later re-raise of the same tag is reviewed fresh rather than
   silently reusing a stale decision — mirroring stage 1's "one
   instance per excursion" rule. The review log this hook keeps is
   explicitly not an ISA-18.2 audit journal (see scope above):
   in-memory only, lost on refresh, there only so a reviewer can see
   what was decided and why while the page is open.

## CI

`.github/workflows/ci.yml` runs on every push and pull request to
`main`:

- Lint — oxlint, with its native `jsx-a11y` and `vitest` plugins
  enabled.
- Type check — `tsc -b`.
- Test with a coverage gate — the full suite (unit, property-based,
  component tests including jest-axe accessibility assertions, and
  the backend's REST + WebSocket tests), with the build failing if
  coverage drops below the floor set in `vite.config.ts`. There's no
  separate accessibility-gate step: the axe assertions are ordinary
  test assertions, and a violation fails this step like any other
  failing test.
- Build — `tsc -b && vite build`.
- Bundle size budget — `scripts/check-bundle-budget.mjs` gzips the
  built JS and CSS and fails if either exceeds its budget, instead of
  just printing a number for someone to read later.
