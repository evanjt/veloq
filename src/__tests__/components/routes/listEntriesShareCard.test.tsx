/**
 * Scenario: the routes and sections tabs drew each entry on its own tile.
 *
 * Expected behaviour: both entries are the flat `Card`, pressed through it
 * with a label, and the list spacing sits on a wrapper outside the card.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

import { initialiseI18n } from '@/i18n';
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

beforeAll(async () => {
  await initialiseI18n('en-GB');
});

describe('list entries on the flat Card', () => {
  it('draws a route entry on the flat dark card', async () => {
    const view = await render(<RouteRow route={route} navigable />);
    const touch = view.getByTestId('route-row-r_1-touch');
    expect(touch.props.accessibilityRole).toBe('button');
    expect(touch.props.accessibilityLabel).toBe('Harbour loop, 1.0 km, 3 activities');
    expectFlatCard(touch, view.getByTestId('route-row-r_1'));
  });

  it('draws a section entry on the flat dark card and presses through it', async () => {
    const onPress = jest.fn();
    const view = await render(<SectionRow section={section} onPress={onPress} />);
    const touch = view.getByTestId('section-row-s_1');
    expect(touch.props.accessibilityRole).toBe('button');
    expect(touch.props.accessibilityLabel).toBe('Hill climb, 800 m, 4 traversals');
    expectFlatCard(touch, view.UNSAFE_getAllByType(View)[0]);
    await fireEvent.press(touch);
    expect(onPress).toHaveBeenCalledWith('s_1');
  });
});

describe('a list entry speaks what it draws', () => {
  it('reads a route with its distance, proximity, match and activity count', () => {
    const view = render(
      <RouteRow route={{ ...route, averageMatchQuality: 86.6 }} distanceFromUser={250} navigable />
    );
    expect(view.getByTestId('route-row-r_1-touch').props.accessibilityLabel).toBe(
      'Harbour loop, 1.0 km, 250 m, 87% match, 3 activities'
    );
  });

  it('leaves out a distance the route row hides', () => {
    const view = render(<RouteRow route={{ ...route, distance: 0 }} navigable />);
    expect(view.getByTestId('route-row-r_1-touch').props.accessibilityLabel).toBe(
      'Harbour loop, 3 activities'
    );
  });

  it('reads a section with its gain, proximity, tags, record, trend and traversals', () => {
    const view = render(
      <SectionRow
        section={{
          ...section,
          sectionType: 'custom',
          elevationGainM: 42,
          latestIsRecord: true,
          trend: 0.4,
        }}
        isDisabled
        distanceFromUser={1500}
      />
    );
    expect(view.getByTestId('section-row-s_1').props.accessibilityLabel).toBe(
      'Hill climb, 800 m, Elevation gain 42 m, 1.5 km, Custom, Disabled, ' +
        'Your best time here was your last one, Trending faster, 4 traversals'
    );
  });

  it('names a descent by the height it drops, not as a gain', () => {
    const view = render(<SectionRow section={{ ...section, elevationLossM: 60 }} />);
    expect(view.getByTestId('section-row-s_1').props.accessibilityLabel).toBe(
      'Hill climb, 800 m, Elevation loss 60 m, 4 traversals'
    );
  });

  it('reads a slowing section as declining and a flat one with no trend word', () => {
    const slowing = render(<SectionRow section={{ ...section, trend: -0.2 }} />);
    expect(slowing.getByTestId('section-row-s_1').props.accessibilityLabel).toBe(
      'Hill climb, 800 m, Trending slower, 4 traversals'
    );
    const flatTrend = render(<SectionRow section={{ ...section, trend: 0 }} />);
    expect(flatTrend.getByTestId('section-row-s_1').props.accessibilityLabel).toBe(
      'Hill climb, 800 m, 4 traversals'
    );
  });

  it('never names an unnamed section by its id', () => {
    const view = render(<SectionRow section={{ ...section, name: undefined }} />);
    const button = view.getByRole('button');
    expect(button.props.accessibilityLabel).not.toBe('s_1');
    expect(button.props.accessibilityLabel).not.toContain('s_1');
    expect(button.props.accessibilityLabel).toBe('800 m, 4 traversals');
  });
});
