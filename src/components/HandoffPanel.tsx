import { useHandoffMachine } from "../handoff/useHandoffMachine";
import { AUTOMATION_HANDOFF_TIMEOUT_MS, MANUAL_HANDBACK_TIMEOUT_MS } from "../handoff/handoffMachine";

const STATE_LABEL: Record<string, string> = {
  manual: "Manual control",
  automationPending: "Automation requesting control – awaiting confirmation",
  automatic: "Automatic control",
  manualPending: "Returning control to operator – awaiting acknowledgment",
  failsafe: "FAILSAFE – handback was never acknowledged",
};

/** Deliberately one visual indicator per state, never a blend of two
 * (e.g. no "manual/automatic" combined badge) -- the whole point of
 * this panel is that an operator can read the mode at a glance
 * without ambiguity. */
function remainingMs(now: number, pendingSince: number | null, timeoutMs: number): number | null {
  if (pendingSince === null) return null;
  return Math.max(0, timeoutMs - (now - pendingSince));
}

export function HandoffPanel() {
  const { state, pendingSince, now, requestAutomation, confirm, reject, cedeToManual, overrideToManual, acknowledge } =
    useHandoffMachine();

  const automationCountdown = state === "automationPending" ? remainingMs(now, pendingSince, AUTOMATION_HANDOFF_TIMEOUT_MS) : null;
  const handbackCountdown = state === "manualPending" ? remainingMs(now, pendingSince, MANUAL_HANDBACK_TIMEOUT_MS) : null;

  return (
    <section className="handoff-panel" aria-label="Operator / automation control handoff">
      <h2>Control Handoff</h2>
      <p aria-live="assertive" className={`handoff-state handoff-state-${state}`}>
        {STATE_LABEL[state]}
        {automationCountdown !== null ? ` (${Math.ceil(automationCountdown / 1000)}s to respond)` : null}
        {handbackCountdown !== null ? ` (${Math.ceil(handbackCountdown / 1000)}s to acknowledge)` : null}
      </p>

      <div className="handoff-actions">
        {state === "manual" && (
          <button type="button" onClick={requestAutomation}>
            Request automation takeover
          </button>
        )}

        {state === "automationPending" && (
          <>
            <button type="button" onClick={confirm}>
              Confirm – hand control to automation
            </button>
            <button type="button" onClick={reject}>
              Reject – keep manual control
            </button>
          </>
        )}

        {state === "automatic" && (
          <>
            <button type="button" onClick={overrideToManual}>
              Override – take back control now
            </button>
            <button type="button" onClick={cedeToManual}>
              Automation: cede control
            </button>
          </>
        )}

        {state === "manualPending" && (
          <button type="button" onClick={acknowledge}>
            Acknowledge – I have control
          </button>
        )}

        {state === "failsafe" && (
          <button type="button" onClick={acknowledge}>
            Acknowledge failsafe – resume manual control
          </button>
        )}
      </div>
    </section>
  );
}
