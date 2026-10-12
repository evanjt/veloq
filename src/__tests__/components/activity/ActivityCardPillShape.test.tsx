/**
 * Scenario: the map feed card draws a route chip and section pills side by side.
 * Expected behaviour: a route PR chip and a section PR pill share one shape, and the
 * route delta label and a pill count share one label type, in light and dark. With
 * the system asking for less transparency or more contrast, the delta chip drops its
 * translucent fill over the map for an opaque one.
 */

import React from 'react';
import { StyleSheet, useColorScheme } from 'react-native';
import { configure, render, screen, within } from '@testing-library/react-native';

import { ActivityCard } from '@/features/activity/components/ActivityCard';
import { useOpaqueChromeStore } from '@/shared/app/ThemeProvider';
import type { Activity } from '@/types';

// The card's drawn text is hidden from assistive technology, which reads the
// card's own label instead, and these cases check what is drawn.
configure({ defaultIncludeHiddenElements: true });

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('expo-haptics', () => ({
  ...jest.requireActual('expo-haptics'),
  impactAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
}));
jest.mock('@/features/settings/stores/MapPreferencesContext', () => ({
  useMapPreferences: () => ({
    getStyleForActivity: () => 'satellite',
    getTerrain3DMode: () => 'smart',
    getActivityCamera: () => undefined,
    setActivityOverride: jest.fn(),
    clearActivityOverride: jest.fn(),
    hasActivityOverride: () => false,
  }),
}));
jest.mock('@/features/strength', () => ({
  StrengthActivityCard: () => null,
}));
// The card's menu reads the track for its 3D item, which no test here draws.
jest.mock('@/features/activity/hooks/useMapPreviewCoordinates', () => ({
  ...jest.requireActual('@/features/activity/hooks/useMapPreviewCoordinates'),
  useMapPreviewCoordinates: () => ({ coordinates: [], altitude: undefined, isLoading: false }),
}));
jest.mock('@/features/activity/components/ActivityMapPreview', () => {
  const { View } = require('react-native');
  return { ActivityMapPreview: () => <View testID="preview-stub" /> };
});
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  ...jest.requireActual('react-native/Libraries/Utilities/useColorScheme'),
  __esModule: true,
  default: jest.fn(),
}));

const activity = {
  id: 'a1',
  name: 'Lakeside loop',
  type: 'Run',
  start_date_local: '2026-08-12T07:30:00',
  distance: 21097,
  moving_time: 17209,
  total_elevation_gain: 1047,
  stream_types: ['latlng'],
} as Activity;

const flat = (id: string) => StyleSheet.flatten(screen.getByTestId(id).props.style);

const SHAPE = [
  'borderRadius',
  'paddingHorizontal',
  'paddingVertical',
  'borderWidth',
  'backgroundColor',
  'borderColor',
] as const;

describe.each(['light', 'dark'])('feed card pills in %s', (scheme) => {
  beforeEach(() => {
    (useColorScheme as jest.Mock).mockReturnValue(scheme);
  });

  const draw = (isPr: boolean) =>
    render(
      <ActivityCard
        activity={activity}
        routeHighlight={{
          routeName: 'Loop',
          isPr,
          trend: 1,
          timeDeltaSeconds: 12,
          prImprovementSeconds: 5,
        }}
        sectionHighlights={[
          { sectionName: 's1', isPr: true, trend: 1, startIndex: 0, endIndex: 1 },
          { sectionName: 's2', isPr: false, trend: 1, startIndex: 0, endIndex: 1 },
        ]}
      />
    );

  it('draws the route PR chip and the section PR pill in one shape', async () => {
    await draw(true);
    const route = flat('activity-card-a1-route-chip');
    const pill = flat('activity-card-a1-pr-pill');
    for (const key of SHAPE) expect(route[key]).toEqual(pill[key]);
    expect(route.borderWidth).toBe(1);
    expect(route.elevation).toBeUndefined();
    expect(route.shadowRadius).toBeUndefined();
    expect(pill.elevation).toBeUndefined();
  });

  it('draws the route delta chip in the same radius and padding as a pill', async () => {
    await draw(false);
    const route = flat('activity-card-a1-route-chip');
    const pill = flat('activity-card-a1-improving-pill');
    for (const key of [
      'borderRadius',
      'paddingHorizontal',
      'paddingVertical',
      'borderWidth',
    ] as const)
      expect(route[key]).toEqual(pill[key]);
    expect(route.elevation).toBeUndefined();
  });

  it('fills the route delta chip opaque when the system asks for opaque chrome', async () => {
    await draw(false);
    const translucent = flat('activity-card-a1-route-chip').backgroundColor;
    await screen.unmount();

    useOpaqueChromeStore.setState({ preferOpaqueChrome: true });
    try {
      await draw(false);
      const opaque = flat('activity-card-a1-route-chip');
      expect(opaque.backgroundColor).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(opaque.backgroundColor).not.toEqual(translucent);
      expect(opaque.borderColor).toMatch(/^#[0-9A-Fa-f]{6}$/);
    } finally {
      useOpaqueChromeStore.setState({ preferOpaqueChrome: false });
    }
  });

  it('gives the route label and a pill count one label type', async () => {
    await draw(false);
    const label = StyleSheet.flatten(
      within(screen.getByTestId('activity-card-a1-route-chip')).getByText(/\d/).props.style
    );
    const count = StyleSheet.flatten(
      within(screen.getByTestId('activity-card-a1-pr-pill')).getByText('1').props.style
    );
    for (const key of ['fontSize', 'fontWeight', 'lineHeight'] as const)
      expect(label[key]).toEqual(count[key]);
  });
});
