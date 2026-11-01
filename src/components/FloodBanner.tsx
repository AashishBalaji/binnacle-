/** A system-level banner, independent of any one alarm row, so an
 * operator sees the flood condition even if every individual alarm
 * involved happens to be scrolled out of view. `role="status"`
 * (not "alert") because this is ongoing state the operator can poll,
 * not a one-off interruption -- a screen reader announces it on
 * change without stealing focus mid-triage. */
export function FloodBanner({ flooding }: { flooding: boolean }) {
  if (!flooding) return null;
  return (
    <div className="flood-banner" role="status">
      Alarm flood in progress &ndash; new low-priority alarms are being suppressed until the rate drops.
    </div>
  );
}
