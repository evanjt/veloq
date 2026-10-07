/**
 * The one call launch makes to the engine after the library is open.
 *
 * Launch used to do the name translations, the heatmap toggle, the athlete id
 * write, an activity count and the stats as five separate calls before first
 * paint. Each took the engine lock on its own, so a sync page write could stall
 * the launch five times over. Every one of them is under a millisecond against
 * a real library, so what this saves is the lock takes rather than a payload.
 */

import type { DelegateHost } from './host';
import type { PersistentEngineStats } from '../generated/veloqrs';
import { heatmapTilesPath } from './heatmap';

export interface LaunchDataInput {
  /** Localised word the engine names auto-generated routes with. */
  routeWord: string;
  /** Localised word the engine names auto-generated sections with. */
  sectionWord: string;
  /**
   * The signed-in athlete, written to `__athlete_id` for the backup's
   * cross-athlete guard, or null when launch has no credentials to write.
   */
  athleteId: string | null;
  heatmapEnabled: boolean;
}

/**
 * Apply the launch state and read back the stats the date-range store opens
 * from. `undefined` when the engine is not up: launch has nothing to seed and
 * the caller carries on rather than failing the whole block. A failed call
 * throws, and the caller decides what of launch still runs.
 */
export function launchData(
  host: DelegateHost,
  input: LaunchDataInput
): PersistentEngineStats | undefined {
  // Held here as well as in the engine, for the same reason the toggle does:
  // the engine's copy goes with a clear or a quarantine reopen, and the launch
  // block that set it does not run again.
  const tilesPath = input.heatmapEnabled ? heatmapTilesPath() : null;
  host.heatmapTilesPath = tilesPath;
  if (!host.ready) return undefined;
  return host.timed(
    'launchData',
    () =>
      host.engine.launchData(
        input.routeWord,
        input.sectionWord,
        input.athleteId ?? undefined,
        tilesPath ?? undefined
      ),
    'launch'
  );
}
