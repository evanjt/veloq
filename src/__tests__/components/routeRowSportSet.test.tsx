import React from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { render } from '@testing-library/react-native';

import { RouteRow } from '@/features/routes/components/RouteRow';
import { Card } from '@/shared/ui/Card';
import type { RouteGroup } from '@/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
  useMetricSystem: () => true,
}));
jest.mock('@/features/routes/hooks/useEngine', () => ({
  useRepresentativeRoute: () => ({ points: [] }),
}));

it('shows every sport icon and no scalar sport pace on a mixed route', () => {
  const route = {
    id: 'r_1',
    name: 'Loop',
    type: 'Ride',
    activityCount: 5,
    activityIds: [],
    signature: null,
    sportTypes: ['Ride', 'Walk'],
    bestPace: 3.5,
    distance: 1000,
  } as RouteGroup;
  const view = render(<RouteRow route={route} navigable />);
  const iconNames = view.UNSAFE_getAllByType(MaterialCommunityIcons).map((icon) => icon.props.name);

  expect(iconNames).toContain('bike');
  expect(iconNames).toContain('walk');
  expect(view.getByText('5')).toBeTruthy();
  expect(view.queryByText(/km\/h|min\/km/)).toBeNull();
  expect(view.UNSAFE_getByType(Card).props.variant).toBe('flat');
});

describe('placeholder glyph', () => {
  const placeholderIcons = (type: string, sportTypes: string[]) => {
    const route = {
      id: 'r_2',
      name: 'Trail',
      type,
      activityCount: 1,
      activityIds: [],
      signature: null,
      sportTypes,
      distance: 1000,
    } as RouteGroup;
    const view = render(<RouteRow route={route} navigable />);
    return view.UNSAFE_getAllByType(MaterialCommunityIcons).map((icon) => icon.props);
  };

  it.each([
    ['Hike', 'hiking'],
    ['TrailRun', 'run-fast'],
    ['Rowing', 'rowing'],
  ])('draws the shared sport glyph for %s', (type, glyph) => {
    const icons = placeholderIcons(type, [type]);
    expect(icons.filter((icon) => icon.name === glyph)).toHaveLength(2);
  });

  it('draws the sport icons at the section row size', () => {
    const icons = placeholderIcons('Ride', ['Ride']);
    expect(icons.filter((icon) => icon.name === 'bike').map((icon) => icon.size)).toContain(12);
  });
});
