# Binnacle — project brief for continuing sessions

Target: Honeywell's "Software Engineer I – UI Developer" JD
(Bangalore; React/Angular/TypeScript, REST APIs, 0-2 yrs experience).
This is a portfolio project built to target that JD specifically, not
a generic app.

## Status as of this file's last update

- **Stage 1 (alarm console): complete.** ISA-18.2 alarm lifecycle as
  a pure reducer (`src/alarms/lifecycle.ts`), virtualized/accessible
  UI (`src/components/AlarmConsole.tsx` + friends), a backend
  (`server/`: REST + WebSocket, synthetic data), CI with an enforced
  coverage gate and bundle-size budget. Round-table reviewed twice:
  7.5/10 → fixes applied (real backend, coverage gate, binary-search
  flood scan, trimmed README rhetoric) → effectively 9/10.
- **Stage 2 (mode-confusion-safe automation handoff): complete.**
  `src/handoff/handoffMachine.ts` — an XState machine proving two
  safety properties via fast-check (automation never takes control
  without explicit operator confirmation; no pending state waits
  forever on an unresponsive operator). `HandoffPanel.tsx` renders
  one unambiguous state at a time.
- **Stage 3 (explainable-AI recommendation review console): complete.**
  `src/recommendations/engine.ts` — a pure, deterministic rule-based
  scoring function (not a trained model, deliberately — see the
  file's docstring and README's scope section) that recommends
  ACKNOWLEDGE / SHELVE / ESCALATE per alarm, each with a weighted
  factor breakdown whose weights sum to the stated score (proved by
  fast-check in `engine.properties.test.ts`). `RecommendationPanel.tsx`
  exposes the breakdown behind a native `<details>` disclosure, and
  never uses the word "confidence" in anything rendered (see the UI
  overclaiming fix below). Accepting ACKNOWLEDGE/ESCALATE dispatches
  the real `ack` action immediately; accepting SHELVE opens the real
  `ShelveForm` pre-filled (not a silent apply), via the stage 1
  reducer either way, not a cosmetic log entry.
  `useRecommendationReview.ts` tracks accept/reject decisions keyed by
  tag + excursion (`raisedAt`) + the specific action, in-memory only —
  explicitly not an ISA-18.2 audit journal. Round-table reviewed once:
  7/10 → fixes applied (review-key bug fixed to include action,
  not just tag+excursion; UI stopped calling the rule-based score
  "confidence"; SHELVE-accept routed through the real form; ACKED
  silence gap documented in README's scope section) → effectively
  9/10.

Read `README.md` for the full technical writeup (what's real, what's
synthetic, what's deliberately out of scope). Don't restate it here;
keep this file to process and status.

## Non-negotiable standing rules

- **Never touch `IQRF_V2`** (the user's real trading system, a
  separate repo/directory). Read-only inspection only, if it ever
  comes up at all — it has no relationship to this project.
- **This repo is isolated.** Work here never touches files in any of
  the user's other portfolio-project repos, and vice versa.
- **Every module/README documents honestly what's real vs.
  synthetic.** Never fabricate data or results. The demo feed
  (`src/sim/simulator.ts`, `server/alarmFeed.mjs`) is clearly labeled
  synthetic everywhere it surfaces, including in actual API/WS
  response payloads (`"synthetic": true`).
- **Git commit trailer** (every commit, this repo specifically):
  ```
  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_016snCqMbqtDAMBMJuTEutDF
  ```
  (The session URL may need updating if continuing from a genuinely
  new session — ask the user, or check the current session's own
  identity, rather than assuming this exact URL is still correct.)

## How this project is run (the methodology — see also the general
notes below, which apply beyond just this repo)

1. **Phased, not big-bang.** Each stage is built to be complete and
   shippable on its own before the next stage starts. Never leave a
   stage half-finished to go work on the next one.
2. **Don't start the next stage without being asked.** After a stage
   completes, stop and report. The user decides whether to proceed,
   adjust, or declare the project done as-is.
3. **Round-table review on request.** When the user asks for a
   review, deliver 3-4 distinct reviewer personas with genuinely
   different angles (e.g., a senior engineer on the target team, an
   engineering-manager/hiring lens, a domain specialist relevant to
   the project — accessibility/safety-UX here, a skeptical
   overclaiming-risk reviewer), each with concrete strengths/
   weaknesses, an overall numeric grade with reasoning, and
   prioritized next moves. Keep it substantive and honest, not
   flattering — the point is to catch real gaps before an interview
   does.
4. **When asked to raise a grade, fix substance over polish.** The
   highest-leverage moves are usually real gaps (missing
   functionality the JD calls for, an actual bug) rather than prose
   editing. Don't pad scope to "look more impressive" — that's
   exactly the overclaiming risk a skeptical reviewer flags.
5. **Every claim about test/coverage numbers must be real, measured,
   and re-verified after any change** — run the actual commands, read
   the actual output, don't estimate. Coverage thresholds and bundle
   budgets are floors set just below a real measured number, not
   round aspirational figures.
6. **Verify end-to-end, not just locally.** After pushing, confirm
   the GitHub Actions run actually passed (`gh run list` /
   `gh run watch`) rather than assuming local success implies CI
   success.
7. **Work token-efficiently.** Batch file writes and verification
   commands; don't re-read files just written; run one full
   lint+typecheck+test+build+budget pass at the end of a batch of
   changes rather than after every single small edit; don't spawn
   subagents or round-tables unless the task genuinely calls for
   independent judgment the user asked for.

## Known gotchas specific to this stack

- **`tsc --noEmit` is not the same check as `tsc -b` (used by
  `npm run build`).** The plain check misses some real errors (seen
  twice: an unused-parameter / readonly-property error, a Map typing
  issue). Always run `npm run build` before declaring something
  clean, not just `tsc --noEmit`.
- **Vitest's coverage `include` list must be updated whenever a new
  top-level `src/` directory is added**, or that code is silently
  excluded from the enforced coverage gate (`vite.config.ts`).
- **XState v5 action functions mutate `context` in place** (not
  `assign()`); the `HandoffContext` interface fields must NOT be
  `readonly`, or `tsc -b` fails.
- **Event listener races in WebSocket tests**: attach `message`
  listeners synchronously right after constructing the client, never
  after a separate `await ... "open"` promise — a message that
  arrives in the gap is lost for good (Node's EventEmitter doesn't
  queue for late listeners).
- `react-window` v2's `List` already renders its own `role="list"`
  container — don't wrap it in another one, or you get a real
  aria-required-children violation (list > div > listitem).

## Commands

```sh
npm install
npm run dev             # frontend dev server
npm run start:server    # backend: REST on /api, WebSocket on /ws
npm run test            # vitest: unit + property-based + component + server tests
npm run test:coverage   # same, with the enforced coverage gate
npm run lint             # oxlint (jsx-a11y + vitest plugins enabled)
npm run build             # tsc -b && vite build -- the real type check
npm run check-bundle-budget
```
