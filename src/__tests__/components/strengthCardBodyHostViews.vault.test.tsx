/**
 * Scenario: the feed scrolls past strength cards. Each card's front and back
 * body diagrams were about 120 SVG host views, created and laid out inside the
 * scroll's frames.
 *
 * Expected behaviour: the card still draws both diagrams, and mounts no
 * react-native-svg host view to do it.
 */

import React from 'react';
import { configure, render, screen } from '@testing-library/react-native';

import { StrengthActivityCard } from '@/features/strength/components/StrengthActivityCard';
import type { FeedCard } from '@/types';

configure({ defaultIncludeHiddenElements: true });

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
  useMetricSystem: () => true,
  useAthlete: () => ({ data: null }),
}));
jest.mock('@/features/activity', () => ({
  ...jest.requireActual('@/features/activity/lib/activityCardA11yLabel'),
  ActivityCardContextMenu: ({ children }: { children: React.ReactNode }) => children,
  SkylineBar: () => null,
}));

const lift = {
  id: 'a1',
  name: 'Rowing machine circuit',
  sportType: 'WeightTraining',
  movingTime: 2700,
  startDateLocal: '2026-01-01T08:00:00',
} as FeedCard;

it('draws both diagrams without a react-native-svg host view', async () => {
  const view = await render(
    <StrengthActivityCard
      activity={lift}
      strengthData={{
        muscles: [
          { slug: 'quadriceps', intensity: 2 },
          { slug: 'gluteal', intensity: 1 },
        ],
        exerciseCount: 2,
        setCount: 6,
        totalWeight: 0,
      }}
    />
  );

  expect(screen.getByTestId('activity-card-a1-bodies')).toBeTruthy();
  const svgHosts = view.UNSAFE_root.findAll(
    (node) => typeof node.type === 'string' && node.type.startsWith('RNSVG')
  );
  expect(svgHosts.map((node) => node.type)).toEqual([]);
});
