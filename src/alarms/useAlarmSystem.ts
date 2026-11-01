/**
 * useAlarmSystem.ts -- the only place in this app that touches the
 * real clock or React state. Everything else (lifecycle.ts) stays a
 * pure function of (state, event, now); this hook's job is just to
 * supply `now`, run a periodic TICK so shelf expiry and flood decay
 * actually happen, and expose a small dispatch surface the UI calls.
 *
 * `now` is read from `performance.now()` only inside event handlers
 * and the tick effect -- never during render -- so the component
 * stays a pure function of its state for React's purposes; the
 * current `now` exposed to the UI is itself just state, updated by
 * the same tick that drives the reducer's TICK event.
 */

import { useCallback, useEffect, useReducer, useState } from "react";
import { createInitialAlarmState, DEFAULT_FLOOD_OPTIONS, isFlooding, reduceAlarm } from "./lifecycle";
import type { AlarmSystemState, FloodOptions } from "./lifecycle";
import type { AlarmEvent, AlarmPriority } from "./types";

const TICK_INTERVAL_MS = 500;

function reducer(state: AlarmSystemState, event: AlarmEvent): AlarmSystemState {
  return reduceAlarm(state, event);
}

export interface UseAlarmSystemResult {
  readonly state: AlarmSystemState;
  readonly now: number;
  readonly flooding: boolean;
  readonly raise: (tag: string, priority: AlarmPriority, description: string) => void;
  readonly clear: (tag: string) => void;
  readonly ack: (tag: string) => void;
  readonly shelve: (tag: string, reason: string, durationMs: number) => void;
  readonly unshelve: (tag: string) => void;
}

/** Real alarm consoles run for a whole shift; `now` here is wall
 * clock milliseconds since page load, which is all the reducer needs
 * -- it never cares about absolute dates, only relative ordering and
 * durations. */
export function useAlarmSystem(floodOptions: FloodOptions = DEFAULT_FLOOD_OPTIONS): UseAlarmSystemResult {
  const [state, dispatch] = useReducer(reducer, undefined, createInitialAlarmState);
  // useState's lazy-initializer form (a function, called exactly once
  // on mount) is the sanctioned way to run an impure call like
  // performance.now() during setup without re-running it, or being
  // flagged as impure, on every render -- unlike useRef's initial-value
  // argument, which gets evaluated on every render only to be
  // discarded after the first.
  const [start] = useState(() => performance.now());
  const [now, setNow] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      const elapsed = performance.now() - start;
      setNow(elapsed);
      dispatch({ type: "TICK", now: elapsed });
    }, TICK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [start]);

  const readClock = useCallback(() => performance.now() - start, [start]);

  const raise = useCallback(
    (tag: string, priority: AlarmPriority, description: string) =>
      dispatch({ type: "RAISE", tag, priority, description, now: readClock() }),
    [readClock],
  );
  const clear = useCallback((tag: string) => dispatch({ type: "CLEAR", tag, now: readClock() }), [readClock]);
  const ack = useCallback((tag: string) => dispatch({ type: "ACK", tag, now: readClock() }), [readClock]);
  const shelve = useCallback(
    (tag: string, reason: string, durationMs: number) =>
      dispatch({ type: "SHELVE", tag, reason, durationMs, now: readClock() }),
    [readClock],
  );
  const unshelve = useCallback((tag: string) => dispatch({ type: "UNSHELVE", tag, now: readClock() }), [readClock]);

  return {
    state,
    now,
    flooding: isFlooding(state, now, floodOptions),
    raise,
    clear,
    ack,
    shelve,
    unshelve,
  };
}
