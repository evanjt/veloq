/**
 * Scenario: an activity's card is drawn with the ground coverage the engine
 * read for it.
 * Expected behaviour: the card shows the badge the engine decided, entirely new
 * or mostly new, and shows nothing for an activity with no badge, with or
 * without section highlights beside it.
 */

import React from 'react';
import { configure, render, screen } from '@testing-library/react-native';

import { ActivityCard } from '@/features/activity/components/ActivityCard';
import type { ActivityNewGround } from '@/features/activity/hooks/useActivitySectionHighlights';
import type { Activity } from '@/types';

// The card's figures are drawn for the eye and hidden from a screen reader,
// which hears them in the card's label, so queries reach hidden elements.
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
  useExerciseSets: () => ({ data: [] }),
  useMuscleGroups: () => ({ data: [] }),
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
  it('says new ground when the engine calls the ride entirely new', async () => {
    await render(<ActivityCard activity={activity} newGround={ground('entirelyNew', 10)} />);

    expect(screen.getByTestId(PILL)).toBeTruthy();
    expect(screen.getByText('activity.newGround')).toBeTruthy();
  });

  it('says mostly new when the engine calls the ride mostly new', async () => {
    await render(<ActivityCard activity={activity} newGround={ground('mostlyNew', 6)} />);

    expect(screen.getByText('activity.mostlyNewGround')).toBeTruthy();
    expect(screen.queryByText('activity.newGround')).toBeNull();
  });

  it('draws nothing below the threshold or with no read', async () => {
    const { rerender } = await render(
      <ActivityCard activity={activity} newGround={ground(null, 4)} />
    );
    expect(screen.queryByTestId(PILL)).toBeNull();

    await rerender(<ActivityCard activity={activity} />);
    expect(screen.queryByTestId(PILL)).toBeNull();
  });

  it('sits beside the section chip rather than replacing it', async () => {
    await render(
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
