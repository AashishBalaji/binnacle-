/** A system-level banner, independent of any one alarm row, so an
 * operator sees the flood condition even if every individual alarm
 * involved happens to be scrolled out of view. `<output>` carries an
 * implicit `status` role (not `alert`) because this is ongoing state
 * the operator can poll, not a one-off interruption -- a screen
 * reader announces it on change without stealing focus mid-triage. */
export function FloodBanner({ flooding }: { flooding: boolean }) {
  if (!flooding) return null;
  return (
    <output className="flood-banner">
      Alarm flood in progress &ndash; new low-priority alarms are being suppressed until the rate drops.
    </output>
  );
}
