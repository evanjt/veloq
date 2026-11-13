/**
 * Scenario: two icon-only buttons sit side by side, each drawn in its square
 * and lifted to the platform minimum by hit slop on both axes.
 *
 * Expected behaviour: at the gap the theme gives for that square, the two hit
 * areas never overlap on either platform, and the drawn edges keep at least
 * `spacing.sm` apart.
 */

import { MIN_TAP_TARGET, controlHeight, spacing } from '@/theme/spacing';

type Platform = 'ios' | 'android';

// tapTarget reads the platform once, when it loads, from its own registry.
function load(os: Platform) {
  let theme: typeof import('@/theme/tapTarget') | undefined;
  jest.isolateModules(() => {
    require('react-native').Platform.OS = os;
    theme = require('@/theme/tapTarget');
  });
  if (!theme) throw new Error('tapTarget did not load');
  return theme;
}

// The horizontal reach of two squares `drawn` wide laid `gap` apart, from the
// first one's left drawn edge.
function hitAreas(os: Platform, drawn: number, gap: number) {
  const { slopToMinTapTarget } = load(os);
  const slop = slopToMinTapTarget(drawn, drawn);
  const first = { left: -slop.left, right: drawn + slop.right };
  const secondLeft = drawn + gap;
  const second = { left: secondLeft - slop.left, right: secondLeft + drawn + slop.right };
  return { first, second };
}

const SQUARES = [controlHeight.chip, controlHeight.buttonSm, controlHeight.button];

describe.each<Platform>(['ios', 'android'])('gapBetweenTargets on %s', (os) => {
  it('reads that platform minimum', () => {
    expect(load(os).minTapTarget).toBe(MIN_TAP_TARGET[os]);
  });

  it.each(SQUARES)('keeps two %i squares from overlapping', (drawn) => {
    const gap = load(os).gapBetweenTargets(drawn);
    const { first, second } = hitAreas(os, drawn, gap);
    expect(first.right).toBeLessThanOrEqual(second.left);
    expect(gap).toBeGreaterThanOrEqual(spacing.sm);
  });

  it('gives nothing past spacing.sm to a square already at the minimum', () => {
    const { gapBetweenTargets, minTapTarget } = load(os);
    expect(gapBetweenTargets(minTapTarget)).toBe(spacing.sm);
  });
});

describe('the gap a row of icon buttons used to take', () => {
  it('overlaps two button squares on Android', () => {
    const { first, second } = hitAreas('android', controlHeight.button, spacing.xs);
    expect(first.right).toBeGreaterThan(second.left);
  });
});
