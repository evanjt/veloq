/**
 * Scenario: the distance from the athlete on a route or section row is the
 * value the Nearby sort orders by, and it was drawn in the disabled ink, which
 * measures about 2.5:1 on the row's card in either theme.
 *
 * Expected behaviour: the distance carries a body ink that clears the 4.5:1
 * text bar on the card it sits on, in both themes, and never the disabled one.
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import { StyleSheet } from 'react-native';

import { RouteRow } from '@/features/routes/components/RouteRow';
import { SectionRow } from '@/features/routes/components/SectionRow';
import { colors, darkColors } from '@/theme';
import type { FrequentSection, RouteGroup } from '@/types';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());

let mockDark = false;
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: mockDark }),
  useMetricSystem: () => true,
}));
jest.mock('@/features/routes/hooks/useEngine', () => ({
  useRepresentativeRoute: () => ({ points: [] }),
}));

function channels(hex: string): number[] {
  return [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
}

function contrastRatio(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, bl] = channels(hex);
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const OPAQUE = /^#[0-9A-Fa-f]{6}$/;

/** The ink a text node is drawn in and the nearest opaque ground behind it. */
function inkAndGround(node: ReactTestInstance): { ink: string; ground: string | undefined } {
  const ink = StyleSheet.flatten(node.props.style)?.color as string;
  let at: ReactTestInstance | null = node.parent;
  while (at) {
    const bg = StyleSheet.flatten(at.props.style)?.backgroundColor;
    if (typeof bg === 'string' && OPAQUE.test(bg)) return { ink, ground: bg };
    at = at.parent;
  }
  return { ink, ground: undefined };
}

const ROUTE = {
  id: 'r_1',
  name: 'Harbour loop',
  type: 'Ride',
  activityCount: 3,
  activityIds: [],
  signature: null,
  sportTypes: ['Ride'],
  distance: 12000,
} as RouteGroup;

const SECTION: FrequentSection = {
  id: 's1',
  sectionType: 'auto',
  sportTypes: ['Ride'],
  polyline: [],
  distanceMeters: 1200,
  activityIds: ['a1'],
  visitCount: 3,
  createdAt: '2026-01-01T00:00:00Z',
};

const rows = {
  route: () => <RouteRow route={ROUTE} navigable distanceFromUser={3700} />,
  section: () => <SectionRow section={SECTION} distanceFromUser={3700} />,
};

describe.each([
  ['light', false],
  ['dark', true],
])('the distance from the athlete in the %s theme', (_theme, dark) => {
  beforeEach(() => {
    mockDark = dark;
  });

  it.each(Object.keys(rows) as (keyof typeof rows)[])(
    'clears the text bar on the %s row card',
    async (row) => {
      const view = await render(rows[row]());
      const { ink, ground } = inkAndGround(view.getByText('3.7 km'));
      const disabled = dark ? darkColors.textDisabled : colors.textDisabled;

      expect(ground).toBe(dark ? darkColors.surfaceRaised : colors.surface);
      expect(ink).not.toBe(disabled);
      expect(contrastRatio(ink, ground as string)).toBeGreaterThanOrEqual(4.5);
    }
  );
});
