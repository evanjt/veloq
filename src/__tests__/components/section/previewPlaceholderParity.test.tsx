import React from 'react';
import { StyleSheet, View } from 'react-native';
import { render } from '@testing-library/react-native';
import { SectionRow } from '@/features/routes/components/SectionRow';
import { RouteRow } from '@/features/routes/components/RouteRow';
import type { FrequentSection, RouteGroup } from '@/types';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());

let mockIsDark = false;
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: mockIsDark }),
  useMetricSystem: () => true,
}));
jest.mock('@/features/routes/hooks/useEngine', () => ({
  useRepresentativeRoute: () => ({ points: [] }),
}));

/**
 * Scenario: a route and a section with no polyline to draw sit on adjacent tabs.
 * Expected behaviour: their empty previews are filled with the same colour in
 * both themes.
 */

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

const ROUTE = {
  id: 'r_1',
  name: 'Loop',
  type: 'Ride',
  activityCount: 5,
  activityIds: [],
  signature: null,
  sportTypes: ['Ride'],
  distance: 1000,
} as RouteGroup;

// The placeholder is the only view that centres its content and is filled.
const placeholderFill = (view: ReturnType<typeof render>) =>
  view
    .UNSAFE_getAllByType(View)
    .map((v) => StyleSheet.flatten(v.props.style) ?? {})
    .filter((s) => s.justifyContent === 'center' && s.alignItems === 'center' && s.backgroundColor)
    .map((s) => s.backgroundColor);

describe.each([
  ['light', false],
  ['dark', true],
])('the empty preview in the %s theme', (_name, isDark) => {
  it('is the same fill on the section row as on the route row', () => {
    mockIsDark = isDark;
    const section = placeholderFill(render(<SectionRow section={SECTION} />));
    const route = placeholderFill(render(<RouteRow route={ROUTE} navigable />));

    expect(route.length).toBeGreaterThan(0);
    expect(section).toEqual(expect.arrayContaining([route[route.length - 1]]));
  });
});
