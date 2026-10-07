import React from 'react';
import { StyleSheet, View } from 'react-native';
import { render } from '@testing-library/react-native';

import { ActivityCard } from '@/features/activity/components/ActivityCard';
import { ActivityHeader } from '@/features/activity/components/ActivityHeader';
import { DetailHero, HeroNameRow, HeroStatsRow } from '@/shared/ui/DetailHero';
import { opacity, typography } from '@/theme';
import type { Activity, ActivityDetail } from '@/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('@/features/maps/stores/MapPreferencesContext', () => ({
  useMapPreferences: () => ({
    getStyleForActivity: () => 'satellite',
    getTerrain3DMode: () => 'smart',
    hasActivityOverride: () => false,
  }),
}));
jest.mock('@/features/activity/components/ActivityMapPreview', () => {
  const { View: MockView } = require('react-native');
  return { ActivityMapPreview: () => <MockView /> };
});
jest.mock('@/features/maps/components/ActivityMapView', () => {
  const { View: MockView } = require('react-native');
  return { ActivityMapView: () => <MockView /> };
});
jest.mock('@/features/strength', () => ({
  StrengthActivityCard: () => null,
  useExerciseSets: () => ({ data: [] }),
  useMuscleGroups: () => ({ data: [] }),
}));

const activity = {
  id: 'sample-1',
  name: 'Morning ride',
  type: 'Ride',
  start_date_local: '2026-08-12T07:30:00',
  distance: 42000,
  moving_time: 7200,
  total_elevation_gain: 450,
  stream_types: ['latlng'],
} as Activity;

const styleOf = (node: { props: { style?: unknown } }) =>
  StyleSheet.flatten(node.props.style as never) as Record<string, unknown>;

it('uses one shadow geometry and full type roles for map text', () => {
  const card = render(<ActivityCard activity={activity} />);
  const cardName = styleOf(card.getByText('Morning ride'));
  const cardStat = styleOf(card.getByTestId('activity-card-sample-1-distance'));
  expect(cardName.lineHeight).toBe(typography.cardTitle.lineHeight);

  const hero = render(
    <DetailHero
      height={320}
      overlay={
        <>
          <HeroNameRow name="River path" nameTestID="hero-name" />
          <HeroStatsRow stats={['42 km', '2h']} statTestIDs={['hero-stat']} />
        </>
      }
    >
      <View />
    </DetailHero>
  );
  const heroName = styleOf(hero.getByTestId('hero-name'));
  const heroStat = styleOf(hero.getByTestId('hero-stat'));

  const detail = activity as unknown as ActivityDetail;
  const header = render(
    <ActivityHeader
      activity={detail}
      activityId={detail.id}
      coordinates={[]}
      isMetric={true}
      debugEnabled={false}
      mapHeight={320}
      highlightIndex={null}
      sectionCreationMode={false}
      sectionCreationState={undefined}
      sectionCreationError={null}
      onSectionCreated={jest.fn()}
      onCreationCancelled={jest.fn()}
      onCreationErrorDismiss={jest.fn()}
      on3DModeChange={jest.fn()}
      onStyleChange={jest.fn()}
      onCameraCapture={jest.fn()}
      initial3DCamera={null}
      activeTab="charts"
      routeOverlayCoordinates={null}
      sectionOverlays={null}
      highlightedSectionId={null}
    />
  );
  const activityName = styleOf(header.getByTestId('activity-detail-name'));
  const activityStat = styleOf(header.getByTestId('activity-detail-distance'));

  for (const style of [cardName, cardStat, heroName, heroStat, activityName, activityStat]) {
    expect(style.textShadowOffset).toEqual({ width: 0, height: 1 });
    expect(style.textShadowRadius).toBe(3);
  }
  for (const style of [heroName, heroStat, activityName, activityStat]) {
    expect(style.textShadowColor).toBe(opacity.overlay.full);
  }
  expect(heroName.lineHeight).toBe(typography.statsValue.lineHeight);
  expect(activityStat).toMatchObject({
    fontSize: heroStat.fontSize,
    fontWeight: heroStat.fontWeight,
    lineHeight: heroStat.lineHeight,
  });
});
