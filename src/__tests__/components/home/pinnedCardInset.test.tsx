/**
 * Scenario: the cards pinned above the feed sit in one container that insets
 * the column to the activity card's edge.
 * Expected behaviour: no pinned card adds a side margin of its own, so each one
 * lines up with the activity cards below, and each is drawn as a shared
 * surface, the flat card or the inline notice, with a name a screen reader can
 * read.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import { PendingUploadsCard } from '@/features/recording/components/PendingUploadsCard';
import { NotificationOptInCard } from '@/features/home/components/NotificationOptInCard';
import { StreamConsentCard } from '@/features/settings/components/StreamConsentCard';
import { useNotificationPrompt } from '@/features/settings/stores/NotificationPromptStore';
import { getVisibleUnuploadedCount } from '@/features/recording/lib/storage/recordingLibrary';
import { Card } from '@/shared/ui/Card';
import { InlineNotice } from '@/shared/ui/InlineNotice';

jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysWithValues());
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useFocusEffect: (effect: () => void | (() => void)) => {
    require('react').useEffect(effect, [effect]);
  },
}));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/app/navigation', () => ({ tapTo: jest.fn() }));
jest.mock('@/shared/app/AuthStore', () => ({
  useAuthStore: (select: (s: unknown) => unknown) =>
    select({ authMethod: 'oauth', isDemoMode: false }),
}));
jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn().mockResolvedValue(null),
  setSetting: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/features/recording/lib/storage/recordingLibrary', () => ({
  getVisibleUnuploadedCount: jest.fn(),
}));
jest.mock('@/features/settings/hooks/useStreamBackfill', () => ({
  useStreamBackfill: () => ({
    awaitingConsent: true,
    estimateRequests: 1200,
    estimateMegabytes: 141,
    start: jest.fn(),
    stop: jest.fn(),
  }),
}));

function sideMargins(): number[] {
  const root = screen.toJSON();
  if (!root || Array.isArray(root)) throw new Error('expected one root element');
  const style = StyleSheet.flatten(root.props.style) ?? {};
  return [
    style.margin,
    style.marginHorizontal,
    style.marginLeft,
    style.marginRight,
    style.marginStart,
    style.marginEnd,
  ].map((value) => value ?? 0);
}

describe('pinned feed cards', () => {
  it('draws the pending uploads banner as an info notice named for a screen reader', async () => {
    (getVisibleUnuploadedCount as jest.Mock).mockResolvedValue(3);
    await render(<PendingUploadsCard />);
    const card = await screen.findByTestId('pending-uploads-card');
    expect(screen.UNSAFE_getByType(InlineNotice).props.tone).toBe('info');
    expect(card.props.accessibilityRole).toBe('button');
    expect(card.props.accessibilityLabel).toContain('recording.library.pendingUploads');
    expect(sideMargins()).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('draws the notification settings hint as a flat card named for a screen reader', async () => {
    useNotificationPrompt.setState({ isLoaded: true, dismissed: true, showingSettingsHint: true });
    await render(<NotificationOptInCard libraryCount={1} />);
    const card = screen.UNSAFE_getByType(Card);
    expect(card.props.variant).toBe('flat');
    expect(card.props.accessibilityLabel).toContain('notifications.prompt.settingsHint');
    expect(sideMargins()).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('adds no side margin to the stream download card', async () => {
    await render(<StreamConsentCard />);
    expect(screen.getByTestId('stream-consent-card')).toBeTruthy();
    expect(sideMargins()).toEqual([0, 0, 0, 0, 0, 0]);
  });
});
