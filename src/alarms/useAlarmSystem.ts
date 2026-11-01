/**
 * useAlarmSystem.ts -- the only place in this app that touches the
 * real clock or React state. Everything else (lifecycle.ts) stays a
 * pure function of (state, event, now); this hook's job is just to
 * supply `now`, run a periodic TICK so shelf expiry and flood decay
 * actually happen, and expose a small dispatch surface the UI calls.
 */

import { useCallback, useEffect, useReducer, useRef } from "react";
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
export function useAlarmSystem(floodOptions: FloodOptions = DEFAULT_FLOOD_OPTIONS) {
  const [state, dispatch] = useReducer(reducer, undefined, createInitialAlarmState);
  const startRef = useRef(performance.now());
  const nowRef = useRef(0);

  useEffect(() => {
    const interval = setInterval(() => {
      nowRef.current = performance.now() - startRef.current;
      dispatch({ type: "TICK", now: nowRef.current });
    }, TICK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  const now = () => performance.now() - startRef.current;

  const raise = useCallback(
    (tag: string, priority: "critical" | "high" | "low", description: string) =>
      dispatch({ type: "RAISE", tag, priority, description, now: now() }),
    [],
  );
  const clear = useCallback((tag: string) => dispatch({ type: "CLEAR", tag, now: now() }), []);
  const ack = useCallback((tag: string) => dispatch({ type: "ACK", tag, now: now() }), []);
  const shelve = useCallback(
    (tag: string, reason: string, durationMs: number) =>
      dispatch({ type: "SHELVE", tag, reason, durationMs, now: now() }),
    [],
  );
  const unshelve = useCallback((tag: string) => dispatch({ type: "UNSHELVE", tag, now: now() }), []);

  return {
    state,
    now: now(),
    flooding: isFlooding(state, now(), floodOptions),
    raise,
    clear,
    ack,
    shelve,
    unshelve,
  };
}
