/**
 * Scenario: layers were written as numbers from -1 to 1000, so the tab bar and
 * the sync pill shared 1000 and three pills shared 999, and which one covered
 * the other came down to mount order.
 *
 * Expected behaviour: the layer token holds the guide's nine rungs in
 * ascending order, and every floating piece reads a value of its own inside the
 * floating band, under the tab bar.
 */

import { floatingLayers, layers } from '@/theme';

describe('the layer token', () => {
  it('holds the nine rungs of the scale', () => {
    expect(layers).toEqual({
      base: 0,
      raised: 1,
      sticky: 10,
      mapOverlay: 100,
      floating: 200,
      tabBar: 300,
      banner: 400,
      toast: 500,
      overlay: 600,
    });
  });

  it('orders the rungs from the base up to the overlay', () => {
    const values = Object.values(layers);
    expect(values).toEqual([...values].sort((a, b) => a - b));
    expect(new Set(values).size).toBe(values.length);
  });
});

describe('the floating layers', () => {
  const values = Object.values(floatingLayers);

  it('give no two floating pieces the same value', () => {
    expect(new Set(values).size).toBe(values.length);
  });

  it('keep every floating piece above the map overlays and under the tab bar', () => {
    for (const value of values) {
      expect(value).toBeGreaterThanOrEqual(layers.floating);
      expect(value).toBeLessThan(layers.tabBar);
    }
  });

  it('name the record button, the status pill stack and the return pill stack', () => {
    expect(Object.keys(floatingLayers).sort()).toEqual(
      ['recordButton', 'returnPills', 'statusPills'].sort()
    );
  });
});
