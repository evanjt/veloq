/**
 * Scenario: a feed card for an activity synced since the athlete last looked
 * carries a gold ring, on both the compact card (no GPS) and the map card.
 *
 * Expected behaviour: the ring is an absolutely positioned overlay in the mark
 * gold of the active theme, absent when the card is not new, and it takes no
 * layout: the card container's style is the same with it on and off.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { ActivityCard } from '@/features/activity/components/ActivityCard';
import type { Activity } from '@/types';
import { colors, darkColors } from '@/theme';

const mockDismissed = jest.fn();
jest.mock('@/shared/native/feedSeen', () => ({
  reportFeedDismissed: (ids: string[]) => mockDismissed(ids),
}));

let mockIsDark = false;
jest.mock('@/shared/app/useTheme', () => ({
  useTheme: () => ({ isDark: mockIsDark }),
}));

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
    stream_types: ['latlng', 'heartrate'],
    ...overrides,
  }) as Activity;

const containers = [
  { name: 'map card', detail: activity() },
  { name: 'compact card', detail: activity({ stream_types: [] }) },
];

describe.each(containers)('the new ring on the $name', ({ detail }) => {
  describe.each([
    { theme: 'light', dark: false, token: colors.chartGoldMark },
    { theme: 'dark', dark: true, token: darkColors.chartGoldMark },
  ])('in the $theme theme', ({ dark, token }) => {
    beforeEach(() => {
      mockIsDark = dark;
    });

    it('draws a non-layout overlay in the theme mark gold when new', () => {
      render(<ActivityCard activity={detail} isNew />);
      const ring = screen.getByTestId('activity-card-a1-new-ring');
      const style = StyleSheet.flatten(ring.props.style);
      expect(style.position).toBe('absolute');
      expect(style.borderColor).toBe(token);
      expect(style.borderWidth).toBe(2);
      expect(ring.props.pointerEvents).toBe('none');
    });

    it('draws nothing when not new', () => {
      render(<ActivityCard activity={detail} />);
      expect(screen.queryByTestId('activity-card-a1-new-ring')).toBeNull();
    });

    it('leaves the card container the same size with the ring on and off', () => {
      const containerStyle = (isNew: boolean) => {
        const view = render(<ActivityCard activity={detail} isNew={isNew} />);
        const style = StyleSheet.flatten(
          view.getByTestId('activity-card-a1-container').props.style
        );
        view.unmount();
        return style;
      };
      const on = containerStyle(true);
      const off = containerStyle(false);
      expect(on).toEqual(off);
    });
  });
});

describe.each(containers)('tapping the $name', ({ detail }) => {
  beforeEach(() => mockDismissed.mockClear());

  it('dismisses the ring of a new card, by id', () => {
    render(<ActivityCard activity={detail} isNew />);
    fireEvent.press(screen.getAllByLabelText(/Lausanne half marathon/)[0]!);
    expect(mockDismissed).toHaveBeenCalledWith(['a1']);
  });

  it('reports nothing for a card that is not new', () => {
    render(<ActivityCard activity={detail} />);
    fireEvent.press(screen.getAllByLabelText(/Lausanne half marathon/)[0]!);
    expect(mockDismissed).not.toHaveBeenCalled();
  });

  it('says New in the label when the ring is the only mark', () => {
    render(<ActivityCard activity={detail} isNew />);
    expect(
      screen.getAllByLabelText(/^activity.newActivity, Lausanne half marathon/).length
    ).toBeGreaterThan(0);
  });
});
