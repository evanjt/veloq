/**
 * Scenario: a route with 5 activities and a section with 5 traversals drew the same bare `5`.
 *
 * Expected behaviour: each badge carries its own glyph and an accessibility label naming what it
 * counts, with the number in the label.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { RouteRow } from '@/features/routes/components/RouteRow';
import { SectionRow } from '@/features/routes/components/SectionRow';
import type { RouteGroup, Section } from '@/types';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
  useMetricSystem: () => true,
}));
jest.mock('@/features/routes/hooks/useEngine', () => ({
  useRepresentativeRoute: () => ({ points: [] }),
}));
jest.mock('@expo/vector-icons', () => {
  const { View } = require('react-native');
  return { MaterialCommunityIcons: (props: object) => <View {...props} /> };
});
jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({
    t: (key: string, opts?: { count?: number }) =>
      opts?.count === undefined ? key : `${key}:${opts.count}`,
  }),
}));
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));

const route = {
  id: 'r_5',
  name: 'Harbour loop',
  type: 'Ride',
  activityCount: 5,
  activityIds: [],
  signature: null,
  sportTypes: ['Ride'],
  distance: 1000,
} as RouteGroup;

const section = {
  id: 's_5',
  name: 'Hill climb',
  sportType: 'Ride',
  sportTypes: ['Ride'],
  distanceMeters: 800,
  visitCount: 5,
  activityIds: [],
} as unknown as Section;

describe('count badge cue', () => {
  it('labels the route badge as activities and draws the route glyph', () => {
    const { getByTestId } = render(<RouteRow route={route} navigable />);
    expect(getByTestId('route-row-r_5-count').props.accessibilityLabel).toBe(
      'routes.activitiesCount:5'
    );
    expect(getByTestId('route-row-r_5-count-glyph').props.name).toBe('map-marker-multiple');
  });

  it('labels the section badge as traversals and draws the section glyph', () => {
    const { getByTestId } = render(<SectionRow section={section} />);
    expect(getByTestId('section-row-s_5-count').props.accessibilityLabel).toBe(
      'sections.traversalsCount:5'
    );
    expect(getByTestId('section-row-s_5-count-glyph').props.name).toBe('repeat');
  });

  it('uses the singular for one', () => {
    const { getByTestId } = render(<RouteRow route={{ ...route, activityCount: 1 }} navigable />);
    expect(getByTestId('route-row-r_5-count').props.accessibilityLabel).toBe(
      'routes.activitiesCount:1'
    );
  });
});
