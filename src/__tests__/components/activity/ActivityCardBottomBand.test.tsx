/**
 * Scenario: the feed card draws its stat rows over the map preview's bottom
 * band. The preview used to draw the map credit into that same band, and the
 * card held a pill's height of empty space under the stats to clear it.
 *
 * Expected behaviour: neither is there. The credit is carried by every real map
 * surface and by the detail screen the card opens, so the feed card draws none
 * and reserves nothing for one, and the stat rows sit on the card edge.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import { ActivityCard } from '@/features/activity/components/ActivityCard';
import type { Activity } from '@/types';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));

jest.mock('react-native-iap', () => ({
  useIAP: () => ({}),
  ErrorCode: {},
}));

jest.mock('expo-haptics', () => ({
  ...jest.requireActual('expo-haptics'),
  impactAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
}));

jest.mock('@/features/maps/stores/MapPreferencesContext', () => ({
  useMapPreferences: () => ({
    getStyleForActivity: () => 'satellite',
    getTerrain3DMode: () => 'smart',
    setActivityOverride: jest.fn(),
    clearActivityOverride: jest.fn(),
    hasActivityOverride: () => false,
  }),
}));

jest.mock('@/features/strength', () => ({
  StrengthActivityCard: () => null,
  useExerciseSets: () => ({ data: [] }),
  useMuscleGroups: () => ({ data: [] }),
}));

jest.mock('@/features/activity/components/ActivityMapPreview', () => {
  const { View } = require('react-native');
  return {
    ActivityMapPreview: () => <View testID="preview-stub" />,
  };
});

const activity = (overrides: Partial<Activity> = {}): Activity =>
  ({
    id: 'a1',
    name: 'Lausanne half marathon',
    type: 'Run',
    start_date_local: '2026-08-12T07:30:00',
    distance: 21097,
    moving_time: 17209,
    total_elevation_gain: 1047,
    icu_training_load: 50,
    average_heartrate: 157,
    average_watts: 342,
    calories: 382,
    average_temp: 22,
    stream_types: ['latlng', 'heartrate'],
    ...overrides,
  }) as Activity;

const renderCard = (detail: Activity = activity()) => render(<ActivityCard activity={detail} />);

const bottomPaddingBottom = () =>
  StyleSheet.flatten(screen.getByTestId('activity-card-bottom').props.style).paddingBottom ?? 0;

describe('the feed card keeps its bottom band for the stats', () => {
  it('draws no map credit of its own', () => {
    renderCard();

    expect(screen.queryByTestId('map-attribution')).toBeNull();
    expect(screen.queryByTestId('map-attribution-text')).toBeNull();
  });

  it('reserves no clearance under the stat rows', () => {
    renderCard();

    expect(bottomPaddingBottom()).toBe(0);
  });
});
