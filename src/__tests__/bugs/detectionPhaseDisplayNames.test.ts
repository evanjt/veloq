/**
 * Scenario: the preview run button draws `progress.displayName` for every
 * phase but `loading`, and the percent comes from the engine's weight table.
 * Expected behaviour: every phase a run announces has a name of its own, so
 * the button never shows the engine's raw token.
 */

import * as fs from 'fs';
import * as path from 'path';
import { getPhaseDisplayName } from '@/features/routes/lib/detectionProgress';

/** The phases the engine sets, read from the Rust that sets them. */
const RUST_DIR = path.resolve(__dirname, '../../../modules/veloqrs/rust/veloqrs/src/persistence');

function announcedPhases(): string[] {
  const files = [
    path.join(RUST_DIR, 'sections/preview.rs'),
    path.join(RUST_DIR, 'sections/detection.rs'),
  ];
  const found = new Set<string>();
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    for (const m of source.matchAll(/(?:set_phase|announce_phase)\([^)]*?"(\w+)"/g)) {
      found.add(m[1]);
    }
  }
  // Refusals, not positions in a run. The screen drops progress on them.
  found.delete('aborted');
  found.delete('suspended');
  found.delete('cutover_owed');
  return [...found].sort();
}

describe('detection phase display names', () => {
  it('finds the phases the engine sets', () => {
    expect(announcedPhases().length).toBeGreaterThan(3);
  });

  it.each(announcedPhases())('%s has a name of its own', (phase) => {
    expect(getPhaseDisplayName(phase)).not.toBe(phase);
  });
});
