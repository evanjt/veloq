/**
 * Scenario: an activity's card is drawn with the ground coverage the engine
 * read for it.
 * Expected behaviour: the card shows the badge the engine decided, entirely new
 * or mostly new, and shows nothing for an activity with no badge, with or
 * without section highlights beside it.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';

import { ActivityCard } from '@/features/activity/components/ActivityCard';
import type { ActivityNewGround } from '@/features/activity/hooks/useActivitySectionHighlights';
import type { Activity } from '@/types';

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
  return { ActivityMapPreview: () => <View testID="preview-stub" /> };
});
jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysWithValues());

const activity = {
  id: 'a1',
  name: 'Lakeside loop',
  type: 'Ride',
  start_date_local: '2026-08-12T07:30:00',
  distance: 42000,
  moving_time: 5400,
  total_elevation_gain: 400,
  stream_types: ['latlng'],
} as Activity;

const ground = (badge: ActivityNewGround['badge'], newTiles: number): ActivityNewGround => ({
  fraction: newTiles / 10,
  tiles: 10,
  newTiles,
  badge,
});

const PILL = 'activity-card-a1-new-ground-pill';

describe('the new ground pill on the feed card', () => {
  it('says new ground when the engine calls the ride entirely new', () => {
    render(<ActivityCard activity={activity} newGround={ground('entirelyNew', 10)} />);

    expect(screen.getByTestId(PILL)).toBeTruthy();
    expect(screen.getByText('activity.newGround')).toBeTruthy();
  });

  it('says mostly new when the engine calls the ride mostly new', () => {
    render(<ActivityCard activity={activity} newGround={ground('mostlyNew', 6)} />);

    expect(screen.getByText('activity.mostlyNewGround')).toBeTruthy();
    expect(screen.queryByText('activity.newGround')).toBeNull();
  });

  it('draws nothing below the threshold or with no read', () => {
    const { rerender } = render(<ActivityCard activity={activity} newGround={ground(null, 4)} />);
    expect(screen.queryByTestId(PILL)).toBeNull();

    rerender(<ActivityCard activity={activity} />);
    expect(screen.queryByTestId(PILL)).toBeNull();
  });

  it('sits beside the section chip rather than replacing it', () => {
    render(
      <ActivityCard
        activity={activity}
        newGround={ground('entirelyNew', 10)}
        sectionHighlights={[
          { sectionName: 's1', isPr: true, trend: 1, startIndex: 0, endIndex: 1 },
        ]}
      />
    );

    expect(screen.getByTestId(PILL)).toBeTruthy();
    expect(screen.getByTestId('activity-card-a1-section-chip')).toBeTruthy();
  });
});
