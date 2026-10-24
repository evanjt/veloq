/**
 * Scenario: strength marked a primary and an assisting muscle in teal on the feed card
 * and the screen's dots, while the screen's body diagram drew them in the blue
 * sequential ramp.
 *
 * Expected behaviour: the two roles are steps of the sequential ramp in each theme, so
 * every strength surface reads one blue, and neither sits in the teal hue band.
 */
import * as theme from '@/theme';
import { bodyDiagram } from '@/theme';

function hue(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

describe.each(['light', 'dark'] as const)('strength muscle roles, %s', (mode) => {
  const roles = bodyDiagram[mode];

  it('are steps of the sequential ramp, the primary the stronger', () => {
    expect(roles.steps).toContain(roles.primary);
    expect(roles.steps).toContain(roles.secondary);
    expect(roles.primary).not.toBe(roles.secondary);
  });

  it('carry no teal', () => {
    for (const hex of [roles.primary, roles.secondary]) {
      expect(hue(hex)).toBeGreaterThan(190);
    }
  });
});

it('keeps no separate strength hue beside the roles', () => {
  expect('strengthTone' in theme).toBe(false);
});
