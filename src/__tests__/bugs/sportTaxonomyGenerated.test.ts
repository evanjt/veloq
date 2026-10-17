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

import { isActivityType } from '@/features/routes/types';
import {
  ACTIVITY_TYPES,
  SPORT_FAMILIES,
  SPORT_FAMILY_MEMBERS,
  SPORT_SHADES,
} from '@/shared/native/sportTaxonomy.generated';
import {
  readRustSportFamilies,
  readRustSportFamilyMembers,
  readRustSportShades,
  renderSportTaxonomy,
} from '../../../scripts/lib/sportTaxonomy';

const RUST = resolve('modules/veloqrs/rust/veloqrs/src/sport.rs');

describe('the sport taxonomy', () => {
  it('is what the Rust module says it is', () => {
    const source = readFileSync(RUST, 'utf-8');
    expect(SPORT_FAMILIES).toEqual(readRustSportFamilies(source));
    expect(SPORT_FAMILY_MEMBERS).toEqual(readRustSportFamilyMembers(source));
    expect(SPORT_SHADES).toEqual(readRustSportShades(source));
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

  it('gives every named sport one drawn family, with snowshoe in winter and hiking on foot', () => {
    const seen = new Set<string>();
    for (const sports of Object.values(SPORT_FAMILY_MEMBERS)) {
      for (const sport of sports) {
        expect(seen.has(sport)).toBe(false);
        seen.add(sport);
      }
    }
    expect(SPORT_FAMILY_MEMBERS.Winter).toContain('Snowshoe');
    expect(SPORT_FAMILY_MEMBERS.Winter).toContain('IceSkate');
    expect(SPORT_FAMILY_MEMBERS.Foot).toEqual(expect.arrayContaining(['Walk', 'Hike']));
    expect(SPORT_FAMILY_MEMBERS.Water).toEqual(expect.arrayContaining(['Swim', 'Rowing']));
    expect(SPORT_SHADES[3]).toContain('IceSkate');
    expect(SPORT_SHADES[2]).toContain('Hike');
    for (const sport of ['StandUpPaddling', 'VirtualRow', 'Surfing', 'RollerSki', 'Squash']) {
      expect(seen.has(sport)).toBe(true);
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

  it('derives the activity type list from the drawn families, every counting sport included', () => {
    const families = readRustSportFamilyMembers(readFileSync(RUST, 'utf-8'));
    expect(ACTIVITY_TYPES).toEqual([...new Set(Object.values(families).flat())]);
    for (const sports of Object.values(SPORT_FAMILIES)) {
      for (const sport of sports) expect(ACTIVITY_TYPES).toContain(sport);
    }
  });

  it('renders a sport added to a family into the activity type list once', () => {
    const source = readFileSync(RUST, 'utf-8');
    const families = readRustSportFamilyMembers(source);
    const rendered = renderSportTaxonomy(
      readRustSportFamilies(source),
      { ...families, Other: [...families.Other, 'Floorball'] },
      readRustSportShades(source)
    );
    const list = rendered.slice(rendered.indexOf('export const ACTIVITY_TYPES'));
    expect(list.match(/'Floorball'/g)).toHaveLength(1);
    expect(rendered).toContain('export type ActivityType = (typeof ACTIVITY_TYPES)[number];');
  });

  it('accepts every generated activity type at runtime and nothing outside the list', () => {
    for (const sport of ACTIVITY_TYPES) expect(isActivityType(sport)).toBe(true);
    expect(isActivityType('Floorball')).toBe(false);
    expect(isActivityType('')).toBe(false);
  });
});
