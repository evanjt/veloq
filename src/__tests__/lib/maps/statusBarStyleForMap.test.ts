/**
 * Scenario: a full-bleed map draws under the system status bar, and the athlete
 * can switch it between the light, dark and satellite styles whatever the app theme.
 *
 * Expected behaviour: the status bar glyphs follow the map drawn beneath them,
 * light over the dark and satellite styles, dark over the light style.
 */

import { statusBarStyleForMap } from '@/features/maps/components/mapStyles';

describe('statusBarStyleForMap', () => {
  it('draws light glyphs over satellite imagery', () => {
    expect(statusBarStyleForMap('satellite')).toBe('light');
  });

  it('draws light glyphs over the dark style', () => {
    expect(statusBarStyleForMap('dark')).toBe('light');
  });

  it('draws dark glyphs over the light style', () => {
    expect(statusBarStyleForMap('light')).toBe('dark');
  });
});
