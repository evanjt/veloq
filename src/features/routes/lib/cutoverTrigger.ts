/**
 * Launch trigger for the detector cutover.
 *
 * An existing install has its detector saved in `__section_config_json`, so a
 * change to the compiled default never reaches it. The cutover archives the
 * old catalogue, switches the config and re-cuts once. The trigger attempts it
 * on every launch until Rust reports it is no longer owed.
 *
 * There is no marker here. The token in SQLite is the done-marker and Rust
 * re-checks it inside the run, so a second marker would be a second answer to
 * one question, and would outlive the quarantine that resets the real one.
 */

import { StartOutcome } from 'veloqrs';

import { getEngine } from '@/shared/native/engine';

/** In-process guard so the engine retry ladder cannot fire two runs at once. */
let inFlight: Promise<StartOutcome> | null = null;

function attempt(): StartOutcome {
  const engine = getEngine();
  if (!engine) return StartOutcome.NotReady;

  try {
    // Three unrelated reasons used to leave here as one `false`, and the
    // retry ladder above could not tell the cutover it had already done from
    // the one it should ask about again on the next launch.
    if (!engine.isCutoverPending()) return StartOutcome.NotOwed;
    if (engine.isCutoverRunning()) return StartOutcome.Busy;
    // A half-elevated library vetoes genuine climbs as lifts, so a catalogue
    // cut over it would bake that in. Retry on a later launch instead.
    if (engine.getElevationBackfillRemaining() !== 0) return StartOutcome.Held;
    return engine.startDetectorCutover() ? StartOutcome.Started : StartOutcome.Busy;
  } catch {
    return StartOutcome.Failed;
  }
}

/**
 * Start the cutover if it is still owed and the library is ready for it.
 * Resolves to whether Rust accepted the run and, when it did not, whether a
 * later launch would fare any better.
 */
export function startDetectorCutoverAfterUpdate(): Promise<StartOutcome> {
  if (inFlight) return inFlight;
  inFlight = Promise.resolve(attempt()).finally(() => {
    inFlight = null;
  });
  return inFlight;
}
