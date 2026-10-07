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
import { render, screen, within } from '@testing-library/react-native';

import { ActivityCard } from '@/features/activity/components/ActivityCard';
import { Card } from '@/shared/ui/Card';
import type { Activity } from '@/types';
import { layout, spacing } from '@/theme';

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
    icu_average_watts: 342,
    calories: 382,
    average_temp: 22,
    stream_types: ['latlng', 'heartrate'],
    ...overrides,
  }) as Activity;

const renderCard = (detail: Activity = activity()) => render(<ActivityCard activity={detail} />);

const bottomPaddingBottom = () =>
  StyleSheet.flatten(screen.getByTestId('activity-card-bottom').props.style).paddingBottom ?? 0;

describe('the feed card keeps its bottom band for the stats', () => {
  it('uses the same raised card with and without a map', () => {
    const mapped = renderCard();
    expect(mapped.UNSAFE_getByType(Card).props.variant).toBe('raised');
    mapped.unmount();

    const compact = renderCard(activity({ stream_types: [] }));
    expect(compact.UNSAFE_getByType(Card).props.variant).toBe('raised');
  });

  it('shows the synced power used by the metrics row', () => {
    renderCard(activity({ icu_average_watts: 205 }));

    expect(screen.getByText('205 W')).toBeTruthy();
  });

  it('draws no map credit of its own', () => {
    renderCard();

    expect(screen.queryByTestId('map-attribution')).toBeNull();
    expect(screen.queryByTestId('map-attribution-text')).toBeNull();
  });

  it('reserves no clearance under the stat rows', () => {
    renderCard();

    expect(bottomPaddingBottom()).toBe(0);
  });

  it('keeps every stat row over the full-height preview', () => {
    renderCard(activity({ icu_average_watts: 205 }));

    const band = within(screen.getByTestId('activity-card-bottom'));
    expect(band.getByTestId('activity-card-a1-distance')).toBeTruthy();
    expect(band.getByText('205 W')).toBeTruthy();
  });
});

describe('the feed card keeps its stat row clear of the record button', () => {
  it('insets the secondary stat row on the right by the button footprint and its margin', () => {
    renderCard();
    const style = StyleSheet.flatten(
      screen.getByTestId('activity-card-a1-secondary-stats').props.style
    );
    expect(style.marginRight).toBe(layout.recordFabSize + spacing.md * 2);
  });
});

describe('the feed card draws no place line', () => {
  it('shows nothing for a locality an older stored body still carries', () => {
    renderCard(activity({ locality: 'Lausanne', country: 'Switzerland' } as Partial<Activity>));

    expect(screen.queryByText('Lausanne')).toBeNull();
    expect(screen.queryByText(/Switzerland/)).toBeNull();
  });
});
