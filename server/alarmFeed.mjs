/**
 * alarmFeed.mjs -- SYNTHETIC DATA ONLY, same disclosure as
 * src/sim/simulator.ts on the frontend. This is a deliberately
 * separate, plain-JS implementation rather than a shared module with
 * the TypeScript frontend simulator: the two run in different
 * module systems (browser ESM via Vite vs. plain Node ESM here), and
 * sharing a handful of invented tag names isn't worth a build-tooling
 * dependency between them. There is still no real plant/SCADA feed
 * anywhere in this project.
 */

const SYNTHETIC_TAGS = [
  { tag: "TT-204", priority: "high", description: "Reactor feed temperature high" },
  { tag: "PT-118", priority: "critical", description: "Separator pressure high-high" },
  { tag: "FT-331", priority: "low", description: "Coolant flow deviation" },
  { tag: "LT-402", priority: "low", description: "Surge tank level low" },
  { tag: "AT-077", priority: "high", description: "Stack O2 analyzer out of range" },
];

export function createAlarmFeed() {
  /** @type {Array<{tag: string, priority: string, description: string, raisedAt: number}>} */
  const history = [];
  const listeners = new Set();

  function emit(event) {
    history.push(event);
    if (history.length > 200) history.shift(); // bounded, this is a demo feed, not a store
    for (const listener of listeners) listener(event);
  }

  function raiseRandom() {
    const pick = SYNTHETIC_TAGS[Math.floor(Math.random() * SYNTHETIC_TAGS.length)];
    emit({ ...pick, raisedAt: Date.now() });
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function getHistory() {
    return history.slice();
  }

  function start(intervalMs = 1500) {
    const interval = setInterval(raiseRandom, intervalMs);
    return () => clearInterval(interval);
  }

  return { emit, raiseRandom, subscribe, getHistory, start };
}
