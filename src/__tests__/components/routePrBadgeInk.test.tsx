/**
 * Scenario: a feed card whose activity set a route PR shows a gold badge with
 * a trophy and the time gained, and a section's recent efforts mark the record
 * with a gold PR label. White on the gold measures 2.1:1.
 *
 * Expected behaviour: text on the gold fill reaches 4.5:1 in both themes, and
 * the slower-than-PR delta keeps its light text on the dark badge.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { configure, render } from '@testing-library/react-native';

import { ActivityCard } from '@/features/activity/components/ActivityCard';
import { RecentEffortsList } from '@/features/insights/components/content/RecentEffortsList';
import type { SectionPerformanceRecord } from '@/features/routes/hooks/useSectionPerformances';
import { brand, ink } from '@/theme';
import type { Activity } from '@/types';
import { contrastRatio } from '../__shared__/contrast';

const mockScheme = { current: 'light' as 'light' | 'dark' };

// The card's drawn chips are hidden from assistive technology, which reads the
// card's own label instead, and these cases check what is drawn.
configure({ defaultIncludeHiddenElements: true });

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('@/shared/app/ThemeProvider', () => ({
  ...jest.requireActual('@/shared/app/ThemeProvider'),
  useResolvedColorScheme: () => mockScheme.current,
}));
jest.mock('@/features/settings/stores/MapPreferencesContext', () => ({
  useMapPreferences: () => ({
    getStyleForActivity: () => 'light',
    getTerrain3DMode: () => 'smart',
    getActivityCamera: () => undefined,
    hasActivityOverride: () => false,
  }),
}));
// The card's menu reads the track for its 3D item, which no test here draws.
jest.mock('@/features/activity/hooks/useMapPreviewCoordinates', () => ({
  ...jest.requireActual('@/features/activity/hooks/useMapPreviewCoordinates'),
  useMapPreviewCoordinates: () => ({ coordinates: [], altitude: undefined, isLoading: false }),
}));
jest.mock('@/features/activity/components/ActivityMapPreview', () => {
  const { View: MockView } = require('react-native');
  return { ActivityMapPreview: () => <MockView /> };
});
jest.mock('@/features/strength', () => ({ StrengthActivityCard: () => null }));
jest.mock('@/shared/app/navigation', () => ({
  ...jest.requireActual('@/shared/app/navigation'),
  navigateTo: jest.fn(),
}));

const activity = {
  id: 'sample-7',
  name: 'Harbour loop',
  type: 'Ride',
  start_date_local: '2026-08-12T07:30:00',
  distance: 42000,
  moving_time: 7200,
  total_elevation_gain: 450,
  stream_types: ['latlng'],
} as Activity;

const flat = (style: unknown) =>
  (StyleSheet.flatten(style as never) ?? {}) as Record<string, unknown>;

describe.each([false, true])('the route PR badge (dark %s)', (isDark) => {
  beforeEach(() => {
    mockScheme.current = isDark ? 'dark' : 'light';
  });

  it('draws the time gained in an ink the gold can carry', async () => {
    const { getByTestId } = await render(
      <ActivityCard
        activity={activity}
        routeHighlight={{ routeName: 'Harbour', isPr: true, trend: 1, prImprovementSeconds: 12 }}
      />
    );
    const fill = flat(getByTestId('activity-card-sample-7-route-chip').props.style)
      .backgroundColor as string;
    const ink = flat(getByTestId('activity-card-sample-7-route-improvement').props.style)
      .color as string;

    expect(fill).toBe(brand.gold);
    expect(contrastRatio(ink, fill)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps light text on the dark delta badge', async () => {
    const { getByTestId } = await render(
      <ActivityCard
        activity={activity}
        routeHighlight={{ routeName: 'Harbour', isPr: false, trend: -1, timeDeltaSeconds: 30 }}
      />
    );
    const chip = getByTestId('activity-card-sample-7-route-chip');
    const [text] = chip.findAll((n) => typeof n.props.children === 'string');

    expect(flat(text.props.style).color).toBe(ink.white);
  });
});

describe.each([false, true])('the recent efforts PR label (dark %s)', (isDark) => {
  beforeEach(() => {
    mockScheme.current = isDark ? 'dark' : 'light';
  });

  it('draws the label and its trophy in an ink the gold can carry', async () => {
    const best = {
      activityId: 'ride-1',
      activityName: 'ride-1',
      activityDate: new Date(Date.UTC(2026, 5, 1)),
      laps: [],
      lapCount: 1,
      bestTime: 550,
      bestPace: 1000 / 550,
      bestForwardTime: 550,
      bestReverseTime: null,
      direction: 'same',
    } as unknown as SectionPerformanceRecord;
    const { getByText } = await render(
      <RecentEffortsList
        records={[best]}
        bests={{ forward: best, reverse: null, forwardIsPr: true, reverseIsPr: false }}
      />
    );
    const label = getByText('sections.legendPr');
    let badge = label.parent!;
    while (!flat(badge.props.style).backgroundColor) badge = badge.parent!;
    const fill = flat(badge.props.style).backgroundColor as string;
    const trophy = badge.findAll((n) => n.props.name === 'trophy')[0];

    expect(fill).toBe(brand.gold);
    expect(contrastRatio(flat(label.props.style).color as string, fill)).toBeGreaterThanOrEqual(
      4.5
    );
    expect(contrastRatio(trophy.props.color, fill)).toBeGreaterThanOrEqual(4.5);
  });
});
