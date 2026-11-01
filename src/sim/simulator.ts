/**
 * simulator.ts -- SYNTHETIC DATA ONLY.
 *
 * This project has no real plant, PLC, or SCADA system behind it, so
 * there is nothing genuine to connect this console to. Everything
 * this module produces is invented for demonstration: random tag
 * names, random priorities, and a deliberately bursty raise rate so
 * the flood-suppression path in lifecycle.ts actually gets exercised
 * on screen instead of sitting untested in a demo. None of this
 * should be mistaken for a real industrial data feed -- see
 * README.md's scope section.
 */

import type { AlarmPriority } from "../alarms/types";

export interface SimulatedRaise {
  readonly tag: string;
  readonly priority: AlarmPriority;
  readonly description: string;
}

const SYNTHETIC_TAGS: readonly SimulatedRaise[] = [
  { tag: "TT-204", priority: "high", description: "Reactor feed temperature high" },
  { tag: "PT-118", priority: "critical", description: "Separator pressure high-high" },
  { tag: "FT-331", priority: "low", description: "Coolant flow deviation" },
  { tag: "LT-402", priority: "low", description: "Surge tank level low" },
  { tag: "AT-077", priority: "high", description: "Stack O2 analyzer out of range" },
  { tag: "PT-205", priority: "critical", description: "Compressor discharge pressure high-high" },
  { tag: "TT-511", priority: "low", description: "Jacket water temperature deviation" },
  { tag: "FT-091", priority: "low", description: "Purge flow low" },
  { tag: "LT-150", priority: "high", description: "Knockout drum level high" },
  { tag: "VT-220", priority: "low", description: "Pump vibration elevated" },
];

/** A simple pseudo-random pick, parameterized so tests can supply a
 * deterministic `random` and assert on output. */
export function pickSyntheticAlarm(random: () => number = Math.random): SimulatedRaise {
  const index = Math.floor(random() * SYNTHETIC_TAGS.length);
  return SYNTHETIC_TAGS[Math.min(index, SYNTHETIC_TAGS.length - 1)];
}

/** Starts a synthetic raise generator calling `onRaise` at a bursty
 * interval (short gaps most of the time, with occasional longer
 * quiet periods) so the flood banner and suppression state both get
 * demonstrated rather than only the steady-state view. Returns a
 * stop function. */
export function startSyntheticFeed(onRaise: (alarm: SimulatedRaise) => void, random: () => number = Math.random): () => void {
  let stopped = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  function scheduleNext() {
    if (stopped) return;
    // Mostly fast (200-900ms) to build toward a flood, occasionally a
    // longer breathing gap (up to ~4s) so the flood also decays.
    const burst = random() < 0.85;
    const delay = burst ? 200 + random() * 700 : 1500 + random() * 2500;
    timeoutId = setTimeout(() => {
      if (stopped) return;
      onRaise(pickSyntheticAlarm(random));
      scheduleNext();
    }, delay);
  }

  scheduleNext();
  return () => {
    stopped = true;
    if (timeoutId) clearTimeout(timeoutId);
  };
}
