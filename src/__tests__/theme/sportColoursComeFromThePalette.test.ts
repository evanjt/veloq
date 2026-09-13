/**
 * Scenario: the activity colours live in the palette, and a store outside the
 * theme restated three of them as hex literals. A palette fix then reached
 * every surface except the ones reading the store.
 *
 * Expected behaviour: the store maps onto the palette, so a colour has one
 * definition and changing it moves every surface that draws the sport.
 */

import { SPORT_COLORS } from '@/features/fitness/stores/SportPreferenceStore';
import { colors } from '@/theme';

it('reads each sport colour off the palette', () => {
  expect(SPORT_COLORS.Cycling).toBe(colors.ride);
  expect(SPORT_COLORS.Running).toBe(colors.run);
  expect(SPORT_COLORS.Swimming).toBe(colors.swim);
});

it('covers every sport the preference can hold', () => {
  expect(Object.keys(SPORT_COLORS).sort()).toEqual(['Cycling', 'Running', 'Swimming']);
});

it('carries no colour of its own', () => {
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '../../features/fitness/stores/SportPreferenceStore.ts'),
    'utf8'
  );

  expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
});
