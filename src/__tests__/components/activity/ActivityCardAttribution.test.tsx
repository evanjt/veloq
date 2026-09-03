/**
 * Scenario: the feed card draws its stat rows over the map preview, and the
 * preview draws the map's source attribution in the same bottom band.
 *
 * Expected behaviour: the card's bottom section reserves room for the
 * attribution pill, so `swisstopo` never prints through `50 TSS 157 bpm`.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { ActivityCard } from '@/features/activity/components/ActivityCard';
import type { Activity } from '@/types';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));

jest.mock('react-native-iap', () => ({
  useIAP: () => ({}),
  ErrorCode: {},
}));

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn() },
  useIsFocused: () => true,
}));

jest.mock('expo-haptics', () => ({
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
  const { Pressable } = require('react-native');
  const { AttributionOverlay } = jest.requireActual(
    '@/features/maps/components/AttributionOverlay'
  );
  return {
    ActivityMapPreview: ({
      onAttributionClearanceChange,
    }: {
      onAttributionClearanceChange?: (clearance: number) => void;
    }) => (
      <>
        <AttributionOverlay
          initialAttribution="© swisstopo © IGN France © Sentinel-2 cloudless by EOX"
          onClearanceChange={onAttributionClearanceChange}
        />
        {/* Stands in for the route-line fallback, which draws no basemap. */}
        <Pressable
          testID="preview-drops-basemap"
          onPress={() => onAttributionClearanceChange?.(0)}
        />
      </>
    ),
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

/** Vertical space the attribution pill claims, read off what it actually renders. */
const attributionHeight = () => {
  const anchor = StyleSheet.flatten(screen.getByTestId('map-attribution').props.style);
  const pill = StyleSheet.flatten(screen.getByTestId('map-attribution-pill').props.style);
  const text = StyleSheet.flatten(screen.getByTestId('map-attribution-text').props.style);
  return (
    (anchor.paddingBottom ?? 0) +
    (pill.paddingVertical ?? 0) * 2 +
    (text.lineHeight ?? text.fontSize ?? 0)
  );
};

const bottomPaddingBottom = () =>
  StyleSheet.flatten(screen.getByTestId('activity-card-bottom').props.style).paddingBottom ?? 0;

describe('the feed card clears the map attribution', () => {
  it('leaves the attribution uncovered by the stat rows', () => {
    renderCard();

    expect(screen.getByTestId('map-attribution-text')).toBeTruthy();
    expect(bottomPaddingBottom()).toBeGreaterThanOrEqual(attributionHeight());
  });

  it('grows the reservation when the credit line wraps to a second row', () => {
    renderCard();
    const oneLine = bottomPaddingBottom();

    const twoLines = attributionHeight() * 2;
    fireEvent(screen.getByTestId('map-attribution-pill'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 320, height: twoLines } },
    });

    expect(bottomPaddingBottom()).toBeGreaterThan(oneLine);
    expect(bottomPaddingBottom()).toBeGreaterThanOrEqual(twoLines);
  });

  it('gives the room back when the credit line fits on one row again', () => {
    renderCard();
    const oneLine = attributionHeight();

    const layoutTo = (height: number) =>
      fireEvent(screen.getByTestId('map-attribution-pill'), 'layout', {
        nativeEvent: { layout: { x: 0, y: 0, width: 320, height } },
      });

    layoutTo(oneLine * 2);
    const wrapped = bottomPaddingBottom();
    layoutTo(oneLine);

    expect(bottomPaddingBottom()).toBeLessThan(wrapped);
    expect(bottomPaddingBottom()).toBeGreaterThanOrEqual(oneLine);
  });

  it('takes the band back when the preview falls back to the route line', () => {
    renderCard();
    expect(bottomPaddingBottom()).toBeGreaterThan(0);

    fireEvent.press(screen.getByTestId('preview-drops-basemap'));

    expect(bottomPaddingBottom()).toBe(0);
  });
});
