/**
 * Scenario: `fit.rs` decides which muscle slugs a strength activity reports,
 * and TypeScript holds the English name each slug is shown under. The two were
 * kept in step by hand, under a comment naming a table that no longer exists.
 *
 * Expected behaviour: a slug added in Rust fails here rather than reaching a
 * screen. The fallback in every call site is the raw slug, so the failure
 * without this test is `lower-back` printed at the athlete.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { MUSCLE_DISPLAY_NAMES } from '@/features/strength/lib/exerciseMuscleMap';

const ROOT = join(__dirname, '../../..');

/** Every slug `exercise_muscle_groups` can put in a `MuscleActivation`. */
function slugsInRust(): string[] {
  const source = readFileSync(join(ROOT, 'modules/veloqrs/rust/veloqrs/src/fit.rs'), 'utf8');
  const start = source.indexOf('pub fn exercise_muscle_groups');
  const end = source.indexOf('\n}', start);
  expect(start).toBeGreaterThan(-1);

  const table = source.slice(start, end);
  const found = new Set<string>();
  for (const [, slug] of table.matchAll(/"([a-z-]+)"/g)) found.add(slug);
  return [...found].sort();
}

describe('the muscle slugs Rust reports and the names TypeScript shows', () => {
  it('name every slug the engine can send', () => {
    const named = Object.keys(MUSCLE_DISPLAY_NAMES).sort();

    expect(slugsInRust()).toEqual(named);
  });

  it('read the table rather than an empty match', () => {
    expect(slugsInRust().length).toBeGreaterThan(10);
  });
});
