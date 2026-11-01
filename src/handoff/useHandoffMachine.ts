/**
 * useHandoffMachine.ts -- the only place the handoff machine touches
 * the real clock, same split as useAlarmSystem.ts: the machine
 * itself only reacts to events (including TICK, which carries `now`
 * explicitly), and this hook's job is just to run the actor, supply
 * `now`, and keep a React-friendly snapshot in state.
 */

import { useEffect, useState } from "react";
import { createActor } from "xstate";
import { handoffMachine } from "./handoffMachine";

const TICK_INTERVAL_MS = 250;

export function useHandoffMachine() {
  // useState's lazy-initializer form (called once, on mount) rather
  // than useRef's initial-value argument (re-evaluated, then
  // discarded, on every render) -- same reasoning as in
  // useAlarmSystem.ts.
  const [actor] = useState(() => createActor(handoffMachine));
  const [snapshot, setSnapshot] = useState(() => actor.getSnapshot());
  const [start] = useState(() => performance.now());

  useEffect(() => {
    actor.start();
    const subscription = actor.subscribe(setSnapshot);
    const interval = setInterval(() => {
      actor.send({ type: "TICK", now: performance.now() - start });
    }, TICK_INTERVAL_MS);
    return () => {
      clearInterval(interval);
      subscription.unsubscribe();
      actor.stop();
    };
  }, [actor, start]);

  // performance.now() is only called from event handlers below, never
  // during render -- the `now` exposed for display comes from the
  // machine's own context, which TICK already keeps current.
  const readClock = () => performance.now() - start;

  return {
    state: snapshot.value as string,
    pendingSince: snapshot.context.pendingSince,
    now: snapshot.context.now,
    requestAutomation: () => actor.send({ type: "AUTOMATION_REQUEST", now: readClock() }),
    confirm: () => actor.send({ type: "OPERATOR_CONFIRM" }),
    reject: () => actor.send({ type: "OPERATOR_REJECT" }),
    cedeToManual: () => actor.send({ type: "AUTOMATION_CEDE", now: readClock() }),
    overrideToManual: () => actor.send({ type: "MANUAL_OVERRIDE" }),
    acknowledge: () => actor.send({ type: "OPERATOR_ACK" }),
  };
}
