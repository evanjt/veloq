/**
 * Scenario: the routes and sections tabs drew each entry on its own tile.
 *
 * Expected behaviour: both entries are the flat `Card`, pressed through it
 * with a label, and the list spacing sits on a wrapper outside the card.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

import { RouteRow } from '@/features/routes/components/RouteRow';
import { SectionRow } from '@/features/routes/components/SectionRow';
import { darkColors, layout } from '@/theme';
import type { RouteGroup, Section } from '@/types';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: true }),
  useMetricSystem: () => true,
}));
jest.mock('@/features/routes/hooks/useEngine', () => ({
  useRepresentativeRoute: () => ({ points: [] }),
}));
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));

const flat = (node: { props: { style?: unknown } }): Record<string, unknown> =>
  (StyleSheet.flatten(node.props.style as never) as Record<string, unknown>) ?? {};

const route = {
  id: 'r_1',
  name: 'Harbour loop',
  type: 'Ride',
  activityCount: 3,
  activityIds: [],
  signature: null,
  sportTypes: ['Ride'],
  distance: 1000,
} as RouteGroup;

const section = {
  id: 's_1',
  name: 'Hill climb',
  sportType: 'Ride',
  sportTypes: ['Ride'],
  distanceMeters: 800,
  visitCount: 4,
  activityIds: [],
} as unknown as Section;

function expectFlatCard(
  node: { props: { style?: unknown } },
  parent: { props: { style?: unknown } }
) {
  const style = flat(node);
  expect(style.backgroundColor).toBe(darkColors.surfaceCard);
  expect(style.borderRadius).toBe(layout.borderRadius);
  expect(style.shadowOpacity).toBeUndefined();
  expect(style.elevation).toBeUndefined();
  expect(style.marginHorizontal).toBeUndefined();
  expect(style.marginBottom).toBeUndefined();
  expect(flat(parent).marginBottom).toBeDefined();
}

describe('list entries on the flat Card', () => {
  it('draws a route entry on the flat dark card', () => {
    const view = render(<RouteRow route={route} navigable />);
    const touch = view.getByTestId('route-row-r_1-touch');
    expect(touch.props.accessibilityRole).toBe('button');
    expect(touch.props.accessibilityLabel).toBe('Harbour loop');
    expectFlatCard(touch, view.getByTestId('route-row-r_1'));
  });

  it('draws a section entry on the flat dark card and presses through it', () => {
    const onPress = jest.fn();
    const view = render(<SectionRow section={section} onPress={onPress} />);
    const touch = view.getByTestId('section-row-s_1');
    expect(touch.props.accessibilityRole).toBe('button');
    expect(touch.props.accessibilityLabel).toBe('Hill climb');
    expectFlatCard(touch, view.UNSAFE_getAllByType(View)[0]);
    fireEvent.press(touch);
    expect(onPress).toHaveBeenCalledWith('s_1');
  });
});
