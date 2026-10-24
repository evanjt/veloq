/**
 * Scenario: a screen reader focuses a feed card.
 *
 * Expected behaviour: the card is one button whose name carries the figures it
 * draws, a clock-style duration and an abbreviated distance or climb said in
 * words in the unit the card draws them in, and the stat rows inside it are not further buttons that repeat the
 * activity's name. What the route and section chips show is said in the card's
 * name, and the chips themselves are reached through the card's actions.
 */

import React from 'react';
import { Platform } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import { initialiseI18n } from '@/i18n';
import { spokenDistance, spokenDuration, spokenElevation } from '@/shared/format/spoken';
import { ActivityCard } from '@/features/activity/components/ActivityCard';
import type { FeedCard } from '@/types';

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

const mapped = {
  id: 'a1',
  name: 'Quarry hill repeats',
  sportType: 'Ride',
  startDateLocal: '2026-08-12T07:30:00',
  distance: 42000,
  movingTime: 5400,
  elevationGain: 359,
  avgHr: 142,
  avgPower: 230,
  hasGps: true,
} as FeedCard;

const indoor = {
  ...mapped,
  id: 'a2',
  name: 'Garage trainer',
  distance: 0,
  elevationGain: 0,
  hasGps: false,
} as FeedCard;

const labelOf = (testID: string) =>
  String(screen.getByTestId(testID).props.accessibilityLabel ?? '');

const drawn = (testID: string) =>
  String(screen.getByTestId(testID, { includeHiddenElements: true }).props.children);

/** The unit system the card drew its distance in, which the spoken figures follow. */
const drawnMetric = (testID: string) => /\b(k?m)$/.test(drawn(testID));

const buttonNames = () =>
  screen
    .getAllByRole('button')
    .map((node) => String(node.props.accessibilityLabel ?? ''))
    .filter(Boolean);

// The card's press target carries its id and label where the system menu is
// not in front of it; on iOS a separate inert view carries the id.
const platformOS = Platform.OS;
beforeAll(() => {
  Platform.OS = 'android';
});
afterAll(() => {
  Platform.OS = platformOS;
});

beforeAll(async () => {
  await initialiseI18n();
});

describe('the feed card spoken name', () => {
  it('carries the climb, the stats with their units and the section PRs on the map card', () => {
    render(
      <ActivityCard
        activity={mapped}
        sectionHighlights={[
          { sectionName: 'Old mill', isPr: true, trend: 1, startIndex: 0, endIndex: 1 },
          { sectionName: 'Weir lane', isPr: true, trend: 0, startIndex: 2, endIndex: 3 },
        ]}
      />
    );

    const label = labelOf('activity-card-a1');
    const isMetric = drawnMetric('activity-card-a1-distance');
    expect(label).toContain(spokenDistance(mapped.distance, isMetric));
    expect(label).toContain(spokenElevation(mapped.elevationGain, isMetric));
    expect(label).toContain(spokenDuration(mapped.movingTime));
    expect(label).not.toContain(drawn('activity-card-a1-duration'));
    expect(label).toContain('142 bpm');
    expect(label).toContain('230 W');
    expect(label).toContain('PRs: 2');
  });

  it('names the activity on one button only', () => {
    render(<ActivityCard activity={mapped} />);

    expect(buttonNames().filter((name) => name === 'Quarry hill repeats')).toEqual([]);
    expect(buttonNames().filter((name) => name.startsWith('Quarry hill repeats'))).toHaveLength(1);
  });

  it('says what the section and route chips show', () => {
    render(
      <ActivityCard
        activity={mapped}
        sectionHighlights={[
          { sectionName: 'Old mill', isPr: true, trend: 1, startIndex: 0, endIndex: 1 },
        ]}
        routeHighlight={{ routeName: 'Ridge loop', isPr: true, trend: 1, prImprovementSeconds: 12 }}
      />
    );

    const label = labelOf('activity-card-a1');
    expect(label).toContain('PRs: 1');
    expect(label).toContain('Personal record by 12 seconds');
    expect(buttonNames()).toEqual([label]);
  });

  it('never speaks the zero distance the compact card hides', () => {
    render(<ActivityCard activity={indoor} />);

    const label = labelOf('activity-card-a2');
    expect(
      screen.queryByTestId('activity-card-a2-distance', { includeHiddenElements: true })
    ).toBeNull();
    expect(label).not.toMatch(/\b0(\.0)? (m|ft|km|mi)\b/);
    expect(label).toContain(spokenDuration(indoor.movingTime));
    expect(label).toContain('142 bpm');
    expect(buttonNames().filter((name) => name === 'Garage trainer')).toEqual([]);
  });
});
