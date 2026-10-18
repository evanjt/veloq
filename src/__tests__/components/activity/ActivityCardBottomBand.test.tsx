/**
 * Scenario: the feed card draws its stat rows over the map preview's bottom
 * band. The preview used to draw the map credit into that same band, and the
 * card held a pill's height of empty space under the stats to clear it.
 *
 * Expected behaviour: neither is there. The credit is carried by every real map
 * surface and by the detail screen the card opens, so the feed card draws none
 * and reserves nothing for one, and the stat rows sit on the card edge.
 */

import React from 'react';
import { Platform, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import { configure, fireEvent, render, screen, within } from '@testing-library/react-native';
import { router } from 'expo-router';

import { ActivityCard } from '@/features/activity/components/ActivityCard';
import { Card } from '@/shared/ui/Card';
import type { FeedCard } from '@/types';
import { layout, spacing } from '@/theme';

// The card's figures are drawn for the eye and hidden from a screen reader,
// which hears them in the card's label, so queries reach hidden elements.
configure({ defaultIncludeHiddenElements: true });

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));

jest.mock('react-native-iap', () => ({
  useIAP: () => ({}),
  ErrorCode: {},
}));

jest.mock('expo-haptics', () => ({
  ...jest.requireActual('expo-haptics'),
  impactAsync: jest.fn(() => Promise.resolve()),
  performAndroidHapticsAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
}));

jest.mock('@/features/activity/components/ActivityCardContextMenu', () => ({
  ActivityCardContextMenu: ({ children }: { children: React.ReactNode }) => children,
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
}));

jest.mock('@/features/activity/components/ActivityMapPreview', () => {
  const { View } = require('react-native');
  return {
    ActivityMapPreview: () => <View testID="preview-stub" />,
  };
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
    trainingLoad: 50,
    avgHr: 157,
    avgPower: 342,
    calories: 382,
    hasGps: true,
    ...overrides,
  }) as FeedCard;

const renderCard = (detail: FeedCard = activity()) => render(<ActivityCard activity={detail} />);

const bottomPaddingBottom = () =>
  StyleSheet.flatten(screen.getByTestId('activity-card-bottom').props.style).paddingBottom ?? 0;

describe('the feed card keeps its bottom band for the stats', () => {
  it('uses the same raised card with and without a map', async () => {
    const mapped = await renderCard();
    expect(mapped.UNSAFE_getByType(Card).props.variant).toBe('raised');
    await mapped.unmount();

    const compact = await renderCard(activity({ hasGps: false }));
    expect(compact.UNSAFE_getByType(Card).props.variant).toBe('raised');
  });

  it('shows the synced power used by the metrics row', async () => {
    await renderCard(activity({ avgPower: 205 }));

    expect(screen.getByText('205 W')).toBeTruthy();
  });

  it('draws no map credit of its own', async () => {
    await renderCard();

    expect(screen.queryByTestId('map-attribution')).toBeNull();
    expect(screen.queryByTestId('map-attribution-text')).toBeNull();
  });

  it('reserves no clearance under the stat rows', async () => {
    await renderCard();

    expect(bottomPaddingBottom()).toBe(0);
  });

  it('keeps every stat row over the full-height preview', async () => {
    await renderCard(activity({ avgPower: 205 }));

    const band = within(screen.getByTestId('activity-card-bottom'));
    expect(band.getByTestId('activity-card-a1-distance')).toBeTruthy();
    expect(band.getByText('205 W')).toBeTruthy();
  });
});

describe('the feed card keeps its stat row clear of the record button', () => {
  it('insets the secondary stat row on the right by the button footprint and its margin', async () => {
    await renderCard();
    const style = StyleSheet.flatten(
      screen.getByTestId('activity-card-a1-secondary-stats').props.style
    );
    expect(style.marginRight).toBe(layout.recordFabSize + spacing.md * 2);
  });
});

describe('the feed card draws no place line', () => {
  it('shows nothing for a locality an older stored body still carries', async () => {
    await renderCard(
      activity({ locality: 'Lausanne', country: 'Switzerland' } as Partial<FeedCard>)
    );

    expect(screen.queryByText('Lausanne')).toBeNull();
    expect(screen.queryByText(/Switzerland/)).toBeNull();
  });
});

describe('the feed card long-press', () => {
  const onOS = async (os: 'ios' | 'android', run: () => Promise<void>) => {
    const originalOS = Platform.OS;
    Platform.OS = os;
    try {
      await run();
    } finally {
      Platform.OS = originalOS;
    }
  };

  it('fires no haptic of its own on android, leaving the open to the menu', () =>
    onOS('android', async () => {
      (Haptics.performAndroidHapticsAsync as jest.Mock).mockClear();
      await renderCard();

      await fireEvent(screen.getByTestId('activity-card-a1'), 'longPress');

      expect(Haptics.performAndroidHapticsAsync).not.toHaveBeenCalled();
    }));

  it('leaves the hold to the system menu on ios', () =>
    onOS('ios', async () => {
      (Haptics.impactAsync as jest.Mock).mockClear();
      await renderCard();

      await fireEvent(screen.getByTestId('activity-card-a1'), 'longPress');

      expect(Haptics.impactAsync).not.toHaveBeenCalled();
    }));
});

describe('the feed card press', () => {
  it.each(['ios', 'android'] as const)(
    'opens the activity and fires no haptic on %s',
    async (os) => {
      const originalOS = Platform.OS;
      Platform.OS = os;
      (Haptics.impactAsync as jest.Mock).mockClear();
      (Haptics.performAndroidHapticsAsync as jest.Mock).mockClear();
      (router.push as jest.Mock).mockClear();
      try {
        await renderCard();

        await fireEvent.press(screen.getByTestId('activity-card-a1'));

        expect(router.push).toHaveBeenCalledWith('/activity/a1');
        expect(Haptics.impactAsync).not.toHaveBeenCalled();
        expect(Haptics.performAndroidHapticsAsync).not.toHaveBeenCalled();
      } finally {
        Platform.OS = originalOS;
      }
    }
  );
});
