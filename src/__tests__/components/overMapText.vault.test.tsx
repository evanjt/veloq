import React from 'react';
import { StyleSheet, View } from 'react-native';
import { configure, render } from '@testing-library/react-native';

import { ActivityCard } from '@/features/activity/components/ActivityCard';
import { DetailHero, HeroNameRow, HeroStatsRow } from '@/shared/ui/DetailHero';
import { opacity, typography } from '@/theme';
import type { FeedCard } from '@/types';

// The card's drawn text is hidden from assistive technology, which reads the
// card's own label instead, and these cases check what is drawn.
configure({ defaultIncludeHiddenElements: true });

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('@/features/settings/stores/MapPreferencesContext', () => ({
  useMapPreferences: () => ({
    getStyleForActivity: () => 'satellite',
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
jest.mock('@/features/maps/components/ActivityMapView', () => {
  const { View: MockView } = require('react-native');
  return { ActivityMapView: () => <MockView /> };
});
jest.mock('@/features/strength', () => ({
  StrengthActivityCard: () => null,
}));

const activity = {
  id: 'sample-1',
  name: 'Morning ride',
  sportType: 'Ride',
  startDateLocal: '2026-08-12T07:30:00',
  distance: 42000,
  movingTime: 7200,
  elevationGain: 450,
  hasGps: true,
} as FeedCard;

const styleOf = (node: { props: { style?: unknown } }) =>
  StyleSheet.flatten(node.props.style as never) as Record<string, unknown>;

it('uses one shadow geometry and full type roles for map text', async () => {
  const card = await render(<ActivityCard activity={activity} />);
  const cardName = styleOf(card.getByText('Morning ride'));
  const cardStat = styleOf(
    card.getByTestId('activity-card-sample-1-distance', { includeHiddenElements: true })
  );
  expect(cardName.lineHeight).toBe(typography.cardTitle.lineHeight);

  const hero = await render(
    <DetailHero
      height={320}
      overlay={
        <>
          <HeroNameRow name="River path" nameTestID="hero-name" />
          <HeroStatsRow
            stats={[
              { text: '42 km', label: 'Distance: 42 km' },
              { text: '2h', label: 'Duration: 2h' },
            ]}
            statTestIDs={['hero-stat']}
          />
        </>
      }
    >
      <View />
    </DetailHero>
  );
  const heroName = styleOf(hero.getByTestId('hero-name'));
  const heroStat = styleOf(hero.getByTestId('hero-stat'));

  for (const style of [cardName, cardStat, heroName, heroStat]) {
    expect(style.textShadowOffset).toEqual({ width: 0, height: 1 });
    expect(style.textShadowRadius).toBe(3);
  }
  for (const style of [heroName, heroStat]) {
    expect(style.textShadowColor).toBe(opacity.overlay.full);
  }
  expect(heroName.lineHeight).toBe(typography.statsValue.lineHeight);
});
