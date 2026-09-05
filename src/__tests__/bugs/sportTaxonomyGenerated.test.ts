/**
 * Scenario: seven lists said which sports are cycling, across two languages,
 * with memberships of two to nine, so an e-bike ride moved the FTP chart and
 * counted for nothing in the fitness gain the chart explains.
 *
 * Expected behaviour: the engine's `sport.rs` is the one owner, the TypeScript
 * copy is generated from it, and a change to either without the other fails.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { SPORT_FAMILIES } from '@/shared/native/sportTaxonomy.generated';
import { readRustSportFamilies, renderSportTaxonomy } from '../../../scripts/lib/sportTaxonomy';

const GENERATED = resolve('src/shared/native/sportTaxonomy.generated.ts');
const RUST = resolve('modules/veloqrs/rust/veloqrs/src/sport.rs');

describe('the sport taxonomy', () => {
  it('is what the Rust module says it is', () => {
    expect(SPORT_FAMILIES).toEqual(readRustSportFamilies(readFileSync(RUST, 'utf-8')));
  });

  it('has a generated file no edit to Rust can leave behind', () => {
    expect(readFileSync(GENERATED, 'utf-8')).toBe(
      renderSportTaxonomy(readRustSportFamilies(readFileSync(RUST, 'utf-8')))
    );
  });

  it('puts no sport in two families', () => {
    const seen = new Set<string>();
    for (const family of ['cycling', 'running', 'walking', 'swimming'] as const) {
      for (const sport of SPORT_FAMILIES[family]) {
        expect(seen.has(sport)).toBe(false);
        seen.add(sport);
      }
    }
  });

  it('reads a list whether it is on one line or many', () => {
    const source = `
pub const CYCLING: &[&str] = &["Ride", "VirtualRide"];
pub const RUNNING: &[&str] = &[
    "Run",
    "TrailRun",
];
pub const WALKING: &[&str] = &["Walk"];
pub const SWIMMING: &[&str] = &["Swim"];
pub const POWER: &[&str] = &["Ride", "Rowing"];
const NOT_PUB: &[&str] = &["Ignored"];
`;

    expect(readRustSportFamilies(source)).toEqual({
      cycling: ['Ride', 'VirtualRide'],
      running: ['Run', 'TrailRun'],
      walking: ['Walk'],
      swimming: ['Swim'],
      power: ['Ride', 'Rowing'],
    });
  });

  it('refuses a source missing a family or declaring an empty one', () => {
    expect(() => readRustSportFamilies('pub const CYCLING: &[&str] = &["Ride"];')).toThrow(
      /running/
    );
    expect(() => readRustSportFamilies('pub const CYCLING: &[&str] = &[];')).toThrow(/CYCLING/);
  });
});
