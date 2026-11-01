/**
 * lifecycle.ts -- the ISA-18.2 alarm state machine, as a pure reducer.
 *
 * Pure on purpose: `reduceAlarm(state, event, options) => nextState`
 * never reads the real clock or touches the network. Every "when does
 * this happen" question is answered by the caller supplying `now` on
 * the event (including a periodic TICK event for time-driven
 * transitions like shelf expiry) -- the same discipline used
 * elsewhere in this author's projects ("math decides"), and the thing
 * that makes this reducer provable with generative tests
 * (lifecycle.properties.test.ts) rather than just example tests.
 *
 * Deliberate scope, stated plainly: a SUPPRESSED alarm that clears is
 * retired directly rather than kept in an audit journal -- a full
 * ISA-18.2 system logs every event for compliance review, which this
 * project does not implement. See README.md's scope section.
 */

import type { AlarmBoard, AlarmEvent, AlarmInstance, AlarmPriority, AlarmState } from "./types";

export interface FloodOptions {
  /** How far back "recent" looks when deciding if the system is
   * flooding, ms. ISA-18.2 guidance treats "more than 10 alarms in
   * 10 minutes" as a flood condition for an individual operator --
   * that's the real-world default below. */
  readonly windowMs: number;
  /** Alarms raised within windowMs, at or above which new LOW
   * priority alarms are suppressed rather than surfaced. */
  readonly threshold: number;
}

export const DEFAULT_FLOOD_OPTIONS: FloodOptions = {
  windowMs: 10 * 60_000,
  threshold: 10,
};

export interface AlarmSystemState {
  readonly board: AlarmBoard;
  /** Raise timestamps within the flood window, oldest first --
   * pruned lazily (on RAISE and on TICK), never eagerly swept. */
  readonly recentRaiseTimestamps: readonly number[];
}

export function createInitialAlarmState(): AlarmSystemState {
  return { board: new Map(), recentRaiseTimestamps: [] };
}

function countInWindow(timestamps: readonly number[], now: number, windowMs: number): number {
  const cutoff = now - windowMs;
  let count = 0;
  for (const t of timestamps) if (t >= cutoff) count++;
  return count;
}

function pruneOld(timestamps: readonly number[], now: number, windowMs: number): readonly number[] {
  const cutoff = now - windowMs;
  const pruned = timestamps.filter((t) => t >= cutoff);
  return pruned.length === timestamps.length ? timestamps : pruned;
}

/** True if the system is currently in a flood condition -- exposed
 * for the UI to show a flood banner, independent of any one alarm's
 * state. */
export function isFlooding(
  state: AlarmSystemState,
  now: number,
  options: FloodOptions = DEFAULT_FLOOD_OPTIONS,
): boolean {
  return countInWindow(state.recentRaiseTimestamps, now, options.windowMs) >= options.threshold;
}

/** Resolve a SHELVED instance back into view, whether triggered by
 * manual unshelve, shelf expiry, or an early re-trip. If the
 * condition already cleared while shelved, it resolves straight to
 * CLEARED rather than flashing back into UNACK first. */
function resolveUnshelve(inst: AlarmInstance): AlarmInstance {
  if (inst.clearedAt !== undefined) {
    return { ...inst, state: "CLEARED", shelf: undefined };
  }
  const state: AlarmState = inst.ackedAt !== undefined ? "ACKED" : "UNACK";
  return { ...inst, state, shelf: undefined };
}

export function reduceAlarm(
  state: AlarmSystemState,
  event: AlarmEvent,
  options: FloodOptions = DEFAULT_FLOOD_OPTIONS,
): AlarmSystemState {
  switch (event.type) {
    case "RAISE":
      return applyRaise(state, event.tag, event.priority, event.description, event.now, options);

    case "CLEAR": {
      const existing = state.board.get(event.tag);
      if (!existing) return state;
      let nextInstance: AlarmInstance | undefined;
      if (existing.state === "UNACK") {
        nextInstance = { ...existing, state: "RTN_UNACK", clearedAt: event.now };
      } else if (existing.state === "ACKED" || existing.state === "SUPPRESSED") {
        // SUPPRESSED was never surfaced, so it needs no acknowledgment --
        // retiring it straight to CLEARED is the deliberate scope choice
        // documented in this module's docstring.
        nextInstance = { ...existing, state: "CLEARED", clearedAt: event.now };
      } else if (existing.state === "SHELVED") {
        // Stays shelved -- the operator's suppression choice stands --
        // but remember it cleared so unshelve/expiry resolves correctly.
        nextInstance = { ...existing, clearedAt: event.now };
      } else {
        return state; // RTN_UNACK / CLEARED already: no-op
      }
      return { ...state, board: withInstance(state.board, event.tag, nextInstance) };
    }

    case "ACK": {
      const existing = state.board.get(event.tag);
      if (!existing) return state;
      let nextInstance: AlarmInstance | undefined;
      if (existing.state === "UNACK") {
        nextInstance = { ...existing, state: "ACKED", ackedAt: event.now };
      } else if (existing.state === "RTN_UNACK") {
        nextInstance = { ...existing, state: "CLEARED", ackedAt: event.now };
      } else if (existing.state === "SUPPRESSED") {
        // Manual escape hatch: an operator who notices a suppressed
        // low-priority alarm can always bring it into view themselves.
        nextInstance = { ...existing, state: "ACKED", ackedAt: event.now };
      } else {
        return state; // ACKED / SHELVED / CLEARED: ack is a no-op here
      }
      return { ...state, board: withInstance(state.board, event.tag, nextInstance) };
    }

    case "SHELVE": {
      const existing = state.board.get(event.tag);
      if (!existing || existing.state === "CLEARED" || existing.state === "SHELVED") return state;
      const nextInstance: AlarmInstance = {
        ...existing,
        state: "SHELVED",
        shelf: { reason: event.reason, shelvedAt: event.now, expiresAt: event.now + event.durationMs },
      };
      return { ...state, board: withInstance(state.board, event.tag, nextInstance) };
    }

    case "UNSHELVE": {
      const existing = state.board.get(event.tag);
      if (!existing || existing.state !== "SHELVED") return state;
      return { ...state, board: withInstance(state.board, event.tag, resolveUnshelve(existing)) };
    }

    case "TICK": {
      let mutableBoard: Map<string, AlarmInstance> | null = null;
      for (const [tag, inst] of state.board) {
        if (inst.state === "SHELVED" && inst.shelf && event.now >= inst.shelf.expiresAt) {
          if (!mutableBoard) mutableBoard = new Map(state.board);
          mutableBoard.set(tag, resolveUnshelve(inst));
        }
      }
      const prunedTimestamps = pruneOld(state.recentRaiseTimestamps, event.now, options.windowMs);
      if (!mutableBoard && prunedTimestamps === state.recentRaiseTimestamps) return state;
      return { board: mutableBoard ?? state.board, recentRaiseTimestamps: prunedTimestamps };
    }

    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

function applyRaise(
  state: AlarmSystemState,
  tag: string,
  priority: AlarmPriority,
  description: string,
  now: number,
  options: FloodOptions,
): AlarmSystemState {
  const existing = state.board.get(tag);

  if (existing && existing.state === "SHELVED") {
    // The defining ISA-18.2 nuance this project tests for: a re-trip
    // while shelved must come back into view immediately, regardless
    // of how much shelf time was left.
    const nextInstance: AlarmInstance = {
      ...existing,
      state: "UNACK",
      shelf: undefined,
      raisedAt: now,
      ackedAt: undefined,
      clearedAt: undefined,
    };
    return { ...state, board: withInstance(state.board, tag, nextInstance) };
  }

  if (existing && existing.state === "RTN_UNACK") {
    // Condition re-trips before the previous excursion was even
    // acknowledged -- reopen it as a fresh active alarm.
    const nextInstance: AlarmInstance = {
      ...existing,
      state: "UNACK",
      raisedAt: now,
      ackedAt: undefined,
      clearedAt: undefined,
    };
    return { ...state, board: withInstance(state.board, tag, nextInstance) };
  }

  if (existing && existing.state !== "CLEARED") {
    // Already active (UNACK / ACKED / SUPPRESSED) -- one instance per
    // tag, no duplicate raise.
    return state;
  }

  const recentRaiseTimestamps = [...state.recentRaiseTimestamps, now];
  const prunedTimestamps = pruneOld(recentRaiseTimestamps, now, options.windowMs);
  const flooding = countInWindow(prunedTimestamps, now, options.windowMs) >= options.threshold;
  // The other half of the invariant: flood suppression only ever
  // applies to LOW priority -- high/critical are never auto-suppressed.
  const initialState: AlarmState = flooding && priority === "low" ? "SUPPRESSED" : "UNACK";

  const nextInstance: AlarmInstance = { tag, priority, description, state: initialState, raisedAt: now };
  return { board: withInstance(state.board, tag, nextInstance), recentRaiseTimestamps: prunedTimestamps };
}

function withInstance(board: AlarmBoard, tag: string, instance: AlarmInstance): AlarmBoard {
  const next = new Map(board);
  next.set(tag, instance);
  return next;
}
