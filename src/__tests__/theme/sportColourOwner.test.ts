/**
 * Scenario: a sport's colour had several owners. The palette held a hue per
 * sport (`ride`, `run`, `swim` and their text and chip-fill variants), the
 * theme a per-type fill and two per-type inks, the fitness store its own
 * colour and text tables, and the widget snapshot shipped a copy of the
 * per-type table. A change to a family's token moved only the surfaces that
 * happened to read it.
 *
 * Expected behaviour: the family table and its tokens are the one owner. The
 * palette carries no sport key, no per-type ink table is exported, the fitness
 * store carries no sport colours, and every family and every type resolves to
 * a family token in both themes.
 */

import * as theme from '@/theme';
import * as sportCategories from '@/shared/activity/sportCategories';
import * as sportPreference from '@/features/fitness/stores/SportPreferenceStore';
import { sportFamilyColours } from '@/theme';
import { SPORT_FAMILY_MEMBERS } from '@/shared/native/sportTaxonomy.generated';

const RETIRED_PALETTE_KEYS = [
  'ride',
  'run',
  'swim',
  'walk',
  'hike',
  'workout',
  'rideText',
  'runText',
  'swimText',
  'walkChipFill',
  'workoutChipFill',
];

describe('sport colour owner', () => {
  it.each([
    ['colors', theme.colors],
    ['darkColors', theme.darkColors],
  ] as const)('%s carries no sport key', (_name, palette) => {
    const keys = Object.keys(palette);
    expect(keys.filter((key) => RETIRED_PALETTE_KEYS.includes(key))).toEqual([]);
  });

  it('exports no per-type ink table', () => {
    expect(Object.keys(theme)).not.toContain('activityTypeInk');
    expect(Object.keys(theme)).not.toContain('activityTypeInkDark');
  });

  it('keeps no second family table beside the engine one', () => {
    expect(Object.keys(sportCategories)).not.toContain('ACTIVITY_CATEGORIES');
  });

  it('keeps no sport colours in the fitness store', () => {
    expect(Object.keys(sportPreference)).not.toContain('SPORT_COLORS');
    expect(Object.keys(sportPreference)).not.toContain('SPORT_TEXT_COLORS');
    expect(Object.keys(sportPreference)).not.toContain('SPORT_TEXT_COLORS_DARK');
  });

  it.each([false, true])('draws every family and type from a family token, dark %s', (isDark) => {
    const steps = sportFamilyColours[isDark ? 'dark' : 'light'];
    const tokens = new Set(Object.values(steps).flat());
    for (const [family, types] of Object.entries(SPORT_FAMILY_MEMBERS)) {
      expect(sportCategories.sportMarkColour(family, isDark)).toBe(
        steps[family as keyof typeof steps][0]
      );
      for (const type of types) {
        expect(tokens).toContain(sportCategories.sportMarkColour(type, isDark));
      }
    }
    expect(sportCategories.sportMarkColour('NotASport', isDark)).toBe(steps.Other[0]);
  });
});
