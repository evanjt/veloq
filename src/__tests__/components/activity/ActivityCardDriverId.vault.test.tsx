/**
 * Scenario: on iOS the feed card sits inside the system menu's link, and an
 * automation driver's snapshot lists nothing drawn under a link that carries a
 * preview or a menu. The card's id has to be carried by a view outside it.
 *
 * Expected behaviour: on iOS one non-accessible view that lets touches through
 * carries `activity-card-<id>`, beside the menu and not inside it; on Android
 * the card's own press target carries the id and nothing else does.
 */

import React from 'react';
import { Platform } from 'react-native';
import { configure, render, screen } from '@testing-library/react-native';

import { ActivityCard } from '@/features/activity/components/ActivityCard';
import type { FeedCard } from '@/types';

configure({ defaultIncludeHiddenElements: true });

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

jest.mock('@/features/activity/components/ActivityCardContextMenu', () => {
  const { View } = require('react-native');
  return {
    ActivityCardContextMenu: ({ children }: { children: React.ReactNode }) => (
      <View testID="menu-stub">{children}</View>
    ),
  };
});

jest.mock('@/features/settings/stores/MapPreferencesContext', () => ({
  useMapPreferences: () => ({
    getStyleForActivity: () => 'satellite',
    getTerrain3DMode: () => 'smart',
    setActivityOverride: jest.fn(),
    clearActivityOverride: jest.fn(),
    hasActivityOverride: () => false,
  }),
}));

jest.mock('@/features/strength', () => ({ StrengthActivityCard: () => null }));

jest.mock('@/features/activity/components/ActivityMapPreview', () => {
  const { View } = require('react-native');
  return { ActivityMapPreview: () => <View testID="preview-stub" /> };
});

const activity = (overrides: Partial<FeedCard> = {}): FeedCard =>
  ({
    id: 'a1',
    name: 'Lausanne half marathon',
    sportType: 'Run',
    startDateLocal: '2026-08-12T07:30:00',
    distance: 21097,
    movingTime: 17209,
    elevationGain: 1047,
    hasGps: true,
    ...overrides,
  }) as FeedCard;

const onOS = async (os: 'ios' | 'android', run: () => Promise<void>) => {
  const originalOS = Platform.OS;
  Platform.OS = os;
  try {
    await run();
  } finally {
    Platform.OS = originalOS;
  }
};

describe.each([
  ['a map card', activity()],
  ['a compact card', activity({ hasGps: false })],
])('the id of %s', (_name, detail) => {
  it('is carried on ios by one inert view beside the menu', () =>
    onOS('ios', async () => {
      await render(<ActivityCard activity={detail} />);

      const marker = screen.getByTestId('activity-card-a1');
      expect(marker.props.pointerEvents).toBe('none');
      expect(marker.props.accessible).toBeFalsy();
      expect(marker.props.onPress).toBeUndefined();

      const menu = screen.getByTestId('menu-stub');
      let node = marker.parent;
      while (node) {
        expect(node).not.toBe(menu);
        node = node.parent;
      }
    }));

  it('is carried on android by the press target alone', () =>
    onOS('android', async () => {
      await render(<ActivityCard activity={detail} />);

      const carriers = screen.getAllByTestId('activity-card-a1');
      expect(carriers).toHaveLength(1);
      expect(carriers[0].props.pointerEvents).not.toBe('none');
    }));
});
