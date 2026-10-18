/**
 * Scenario: a screen draws a skeleton preset while its read is pending, and the
 * component replaces it when the read lands, at the default text size and at
 * the dense cap.
 * Expected behaviour: each preset stands exactly as tall as the component it
 * stands in for, so the swap moves nothing, and each is one busy element whose
 * blocks are hidden from assistive technology.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';
import type { ReactTestInstance, ReactTestRendererJSON } from 'react-test-renderer';

import { ActivityCard } from '@/features/activity/components/ActivityCard';
import { SummaryCard, SummaryCardSkeleton } from '@/features/home/components/SummaryCard';
import type { SummaryCardProps } from '@/features/home/components/SummaryCard';
import { RouteRow } from '@/features/routes/components/RouteRow';
import { SectionRow } from '@/features/routes/components/SectionRow';
import { ListSkeleton, RowSkeleton } from '@/features/routes/components/RowSkeleton';
import { ActivityCardSkeleton, ChartSkeleton } from '@/shared/ui/Shimmer';
import type { Activity, RouteGroup, Section } from '@/types';

import { treeHeight } from '../__shared__/stackHeight';

const mockDimensions = jest.fn();
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  ...jest.requireActual('react-native/Libraries/Utilities/useWindowDimensions'),
  __esModule: true,
  default: () => mockDimensions(),
}));
jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('@/i18n', () => ({
  i18n: { t: (key: string) => key },
  getCurrentLanguage: () => 'en-GB',
}));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));
jest.mock('@/features/routes/hooks/useEngine', () => ({
  useRepresentativeRoute: () => ({ points: [] }),
}));
jest.mock('@/features/settings/stores/MapPreferencesContext', () => ({
  useMapPreferences: () => ({
    getStyleForActivity: () => 'satellite',
    getTerrain3DMode: () => 'smart',
    getActivityCamera: () => undefined,
    hasActivityOverride: () => false,
  }),
}));
jest.mock('@/features/activity/hooks/useMapPreviewCoordinates', () => ({
  ...jest.requireActual('@/features/activity/hooks/useMapPreviewCoordinates'),
  useMapPreviewCoordinates: () => ({ coordinates: [], altitude: undefined, isLoading: false }),
}));
jest.mock('@/features/activity/components/ActivityMapPreview', () => {
  const { View: MockView } = require('react-native');
  return { ActivityMapPreview: () => <MockView /> };
});
jest.mock('@/features/strength', () => ({ StrengthActivityCard: () => null }));

const SCALES = [1, 1.3];

function atScale(fontScale: number) {
  mockDimensions.mockReturnValue({ width: 1200, height: 2400, scale: 3, fontScale });
}

async function heightOf(element: React.ReactElement, fontScale: number): Promise<number> {
  atScale(fontScale);
  const tree = await render(element);
  const height = treeHeight(tree.toJSON() as ReactTestRendererJSON | null, fontScale);
  tree.unmount();
  return height;
}

const days = Array.from({ length: 30 }, (_, i) => 40 + i);

const metrics = [
  { label: 'FTP', value: 250, navigationTarget: '/a' },
  { label: 'Week', value: '4h', navigationTarget: '/b' },
  { label: 'Weight', value: 70, unit: 'kg', navigationTarget: '/c' },
];

function summary(props: Partial<SummaryCardProps>) {
  return (
    <SummaryCard
      heroValue={46}
      heroLabel="Fitness"
      showSparkline
      fitnessData={days}
      fatigueData={days}
      formData={days.map((d) => d - 50)}
      hrvData={days}
      rhrData={days}
      supportingMetrics={metrics}
      {...props}
    />
  );
}

const route = {
  id: 'r_1',
  name: 'Lakeside lap',
  type: 'Ride',
  activityCount: 3,
  activityIds: [],
  signature: null,
  sportTypes: ['Ride'],
  distance: 12000,
} as RouteGroup;

const section = {
  id: 's_1',
  name: 'Quarry climb',
  sportType: 'Ride',
  sportTypes: ['Ride'],
  distanceMeters: 800,
  visitCount: 4,
  activityIds: [],
} as unknown as Section;

const activity = {
  id: 'sample-1',
  name: 'Evening spin',
  type: 'Ride',
  start_date_local: '2026-08-12T07:30:00',
  distance: 42000,
  moving_time: 7200,
  total_elevation_gain: 450,
  stream_types: ['latlng'],
} as Activity;

describe.each(SCALES)('at text scale %s', (fontScale) => {
  it.each([
    ['fitness', 'fitness' as const],
    ['form', 'form' as const],
    ['hrv', 'hrv' as const],
  ])('the summary card skeleton for a %s hero stands as tall as the card', async (_n, hero) => {
    const card = await heightOf(summary({ heroMetric: hero }), fontScale);
    const skeleton = await heightOf(
      <SummaryCardSkeleton heroMetric={hero} showSparkline supportingCount={metrics.length} />,
      fontScale
    );
    expect(skeleton).toBe(card);
  });

  it('the summary card skeleton with no sparkline stands as tall as the card', async () => {
    const card = await heightOf(summary({ showSparkline: false }), fontScale);
    const skeleton = await heightOf(
      <SummaryCardSkeleton
        heroMetric="fitness"
        showSparkline={false}
        supportingCount={metrics.length}
      />,
      fontScale
    );
    expect(skeleton).toBe(card);
  });

  it('the row skeleton stands as tall as a route row and a section row', async () => {
    const skeleton = await heightOf(<RowSkeleton />, fontScale);
    expect(await heightOf(<RouteRow route={route} navigable />, fontScale)).toBe(skeleton);
    expect(await heightOf(<SectionRow section={section} />, fontScale)).toBe(skeleton);
  });

  it('the list skeleton stands as tall as its rows', async () => {
    const row = await heightOf(<RouteRow route={route} navigable />, fontScale);
    expect(await heightOf(<ListSkeleton rows={5} />, fontScale)).toBe(5 * row);
  });

  it('the activity card skeleton stands as tall as a card with a map', async () => {
    const card = await heightOf(<ActivityCard activity={activity} />, fontScale);
    expect(await heightOf(<ActivityCardSkeleton />, fontScale)).toBe(card);
  });
});

function descendants(node: ReactTestInstance): ReactTestInstance[] {
  return node.children.flatMap((child) =>
    typeof child === 'string' ? [] : [child, ...descendants(child)]
  );
}

it.each([
  [
    'summary card',
    <SummaryCardSkeleton key="s" heroMetric="fitness" showSparkline supportingCount={3} />,
  ],
  ['list', <ListSkeleton key="l" rows={4} />],
  ['row', <RowSkeleton key="r" />],
  ['activity card', <ActivityCardSkeleton key="a" />],
  ['chart', <ChartSkeleton key="c" />],
])('the %s skeleton is one busy element with hidden blocks', async (_name, element) => {
  atScale(1);
  await render(element);

  const groups = screen.getAllByRole('progressbar');
  expect(groups).toHaveLength(1);
  const root = groups[0];
  expect(root.props.accessibilityLabel).toBe('common.loading');
  expect(root.props.accessibilityState).toEqual({ busy: true });
  const blocks = root.children.filter((child) => typeof child !== 'string');
  expect(blocks.length).toBeGreaterThan(0);
  for (const block of blocks) {
    expect(block.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(block.props.accessibilityElementsHidden).toBe(true);
  }
  expect(
    descendants(root).filter(
      (node) => node.props.accessible === true || node.props.accessibilityRole !== undefined
    )
  ).toHaveLength(0);
});
