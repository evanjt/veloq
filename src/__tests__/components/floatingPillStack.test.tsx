/**
 * Scenario: the device is offline while a sync runs, or the engine has paused a sync,
 * and more than one status pill has something to say at once. Each pill used to take
 * the one top the position owner gave it, so two of them drew on the same spot.
 *
 * Expected behaviour: the root draws one stack of status pills, each `spacing.xs`
 * below the one above it, starting under the status bar or the banner slot. The text
 * in a pill wraps rather than being cut, and the pill floats on the raised surface
 * with the pill shadow, adding the card edge in dark.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SyncState, SyncStep } from 'veloqrs';

import { pillStack } from '@/shared/app/TopSafeAreaContext';
import { useAuthStore } from '@/shared/app/AuthStore';
import { getEngine } from '@/shared/native/engine';
import { FloatingPill } from '@/shared/ui/FloatingPill';
import { FloatingPillStack } from '@/shared/ui/FloatingPillStack';
import { SyncErrorBanner } from '@/shared/ui/SyncErrorBanner';
import { colors, darkColors, shadows, spacing, stroke } from '@/theme';
import { SyncErrorReason } from '../__shared__/veloqrsStub';

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

const TOP_INSET = 47;
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, bottom: 0, left: 0, right: 0 }),
}));

let mockIsDark = false;
jest.mock('@/shared/app/useTheme', () => ({ useTheme: () => ({ isDark: mockIsDark }) }));
jest.mock('@/shared/app', () => ({
  ...jest.requireActual('@/shared/app'),
  useTheme: () => ({ isDark: mockIsDark }),
}));

let mockOffline = false;
jest.mock('@/shared/app/NetworkContext', () => ({
  useNetwork: () => ({ isOnline: !mockOffline, offlineBannerShown: mockOffline }),
}));

let mockHealth = {
  lastError: null as string | null,
  lastErrorReason: null as SyncErrorReason | null,
  lastSuccessAt: null as string | null,
  retryAtMs: null as number | null,
};
jest.mock('@/shared/native/useSyncHealth', () => ({ useSyncHealth: () => mockHealth }));

let mockSyncing = false;
const engine = {
  getSyncStatus: jest.fn(() =>
    mockSyncing
      ? {
          state: SyncState.Syncing,
          completed: 2,
          total: 11,
          step: SyncStep.RemainingActivities,
          stepItemsDone: 1234,
          stepItemsTotal: 5678,
        }
      : { state: SyncState.Idle }
  ),
  subscribe: jest.fn(() => () => {}),
};

const PILL_HEIGHT = 32;

async function laidOut(testID: string, height: number): Promise<void> {
  await fireEvent(screen.getByTestId(testID), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 360, height } },
  });
}

function top(testID: string): number {
  return StyleSheet.flatten(screen.getByTestId(testID).props.style).top;
}

beforeEach(() => {
  (getEngine as jest.Mock).mockReturnValue(engine);
  mockIsDark = false;
  mockOffline = false;
  mockSyncing = false;
  mockHealth = { lastError: null, lastErrorReason: null, lastSuccessAt: null, retryAtMs: null };
  useAuthStore.setState({ isAuthenticated: true, isDemoMode: false });
});

describe('pillStack', () => {
  it('stacks two pills below a 56px banner slot, space-xs apart, never overlapping', () => {
    const [first, second] = pillStack(TOP_INSET, 56, [PILL_HEIGHT, PILL_HEIGHT]);

    expect(first).toBe(56 + spacing.xs);
    expect(second! - first!).toBe(PILL_HEIGHT + spacing.xs);
    expect(second!).toBeGreaterThanOrEqual(first! + PILL_HEIGHT);
  });

  it('starts under the status bar when the slot is empty', () => {
    expect(pillStack(TOP_INSET, 0, [PILL_HEIGHT])).toEqual([TOP_INSET + spacing.xs]);
  });

  it('places nothing for no pills', () => {
    expect(pillStack(TOP_INSET, 0, [])).toEqual([]);
  });

  it('keeps a wrapped, taller pill clear of the one below it', () => {
    const tops = pillStack(TOP_INSET, 0, [58, PILL_HEIGHT, PILL_HEIGHT]);

    expect(tops[1]! - tops[0]!).toBe(58 + spacing.xs);
    expect(tops[2]! - tops[1]!).toBe(PILL_HEIGHT + spacing.xs);
  });
});

describe('the status pill stack', () => {
  it('draws the offline and the sync pill at different tops when both show', async () => {
    mockOffline = true;
    mockSyncing = true;
    await render(<FloatingPillStack />);
    expect(screen.getByTestId('offline-pill')).toBeTruthy();
    expect(screen.getByTestId('sync-progress-pill')).toBeTruthy();

    await laidOut('floating-pill-offline', PILL_HEIGHT);
    await laidOut('floating-pill-sync', PILL_HEIGHT);

    expect(top('floating-pill-offline')).toBe(TOP_INSET + spacing.xs);
    expect(top('floating-pill-sync')).toBe(TOP_INSET + spacing.xs + PILL_HEIGHT + spacing.xs);
  });

  it('closes the gap when the pill above goes', async () => {
    mockOffline = true;
    mockSyncing = true;
    const { rerender } = await render(<FloatingPillStack />);
    await laidOut('floating-pill-offline', PILL_HEIGHT);
    await laidOut('floating-pill-sync', PILL_HEIGHT);

    mockOffline = false;
    await rerender(<FloatingPillStack />);
    await laidOut('floating-pill-offline', 0);

    expect(top('floating-pill-sync')).toBe(TOP_INSET + spacing.xs);
  });

  it('passes every touch through', async () => {
    mockOffline = true;
    await render(<FloatingPillStack />);

    expect(screen.getByTestId('floating-pill-offline').props.pointerEvents).toBe('none');
  });

  it('wraps the sync label and keeps the counts whole at 360dp and large text', async () => {
    mockSyncing = true;
    await render(<FloatingPillStack />);

    const title = screen.getByTestId('sync-progress-pill-title');
    expect(title.props.numberOfLines).toBeUndefined();
    expect(title.props.maxFontSizeMultiplier).toBeUndefined();
    expect(StyleSheet.flatten(title.props.style).flexShrink).toBe(1);

    const counts = screen.getByTestId('sync-progress-pill-detail');
    expect(counts.props.children).toBe('2/11 · 1234/5678');
    expect(counts.props.numberOfLines).toBeUndefined();
    expect(StyleSheet.flatten(counts.props.style).flexShrink).toBe(0);
    expect(StyleSheet.flatten(counts.props.style).maxWidth).toBe('100%');
  });

  it('wraps the offline words rather than cutting them', async () => {
    mockOffline = true;
    await render(<FloatingPillStack />);

    const title = screen.getByTestId('offline-pill-title');
    expect(title.props.numberOfLines).toBeUndefined();
    expect(title.props.maxFontSizeMultiplier).toBeUndefined();
    expect(screen.getByTestId('offline-pill-detail').props.numberOfLines).toBeUndefined();
  });
});

describe('the paused sync', () => {
  const RETRY_AT = Date.UTC(2026, 9, 17, 14, 30);

  beforeEach(() => {
    mockHealth = {
      lastError: 'HTTP 429',
      lastErrorReason: SyncErrorReason.RateLimited,
      lastSuccessAt: null,
      retryAtMs: RETRY_AT,
    };
  });

  it('is a status pill, and the sync-error banner gives way to it', async () => {
    await render(
      <>
        <SyncErrorBanner />
        <FloatingPillStack />
      </>
    );

    expect(screen.queryByTestId('sync-error-banner')).toBeNull();
    expect(screen.getByTestId('paused-sync-pill')).toBeTruthy();
    expect(screen.getByText('emptyState.syncError.paused')).toBeTruthy();
    expect(screen.getByText('emptyState.syncError.pausedDetail')).toBeTruthy();
  });

  it('gives way to the offline pill', async () => {
    mockOffline = true;
    await render(<FloatingPillStack />);

    expect(screen.queryByTestId('paused-sync-pill')).toBeNull();
    expect(screen.getByTestId('offline-pill')).toBeTruthy();
  });

  it('draws nothing signed out or in demo mode', async () => {
    useAuthStore.setState({ isAuthenticated: true, isDemoMode: true });
    await render(<FloatingPillStack />);

    expect(screen.queryByTestId('paused-sync-pill')).toBeNull();
  });
});

describe('the status pill', () => {
  it.each([
    ['light', false],
    ['dark', true],
  ])('floats on the raised surface with the pill shadow in %s', async (_, isDark) => {
    mockIsDark = isDark;
    const palette = isDark ? darkColors : colors;
    await render(
      <FloatingPill icon="cloud-off-outline" title="Offline" detail="Cached" testID="pill" />
    );

    const pill = StyleSheet.flatten(screen.getByTestId('pill').props.style);
    expect(pill.backgroundColor).toBe(palette.surfaceRaised);
    expect(pill).toMatchObject(StyleSheet.flatten(shadows.pill) ?? {});
    expect(pill.minHeight).toBe(32);
    expect(StyleSheet.flatten(screen.getByTestId('pill-title').props.style).color).toBe(
      palette.textPrimary
    );
    expect(StyleSheet.flatten(screen.getByTestId('pill-detail').props.style).color).toBe(
      palette.textSecondary
    );
  });

  it('adds a 1px card edge in dark and none in light', async () => {
    mockIsDark = true;
    const { rerender } = await render(
      <FloatingPill icon="cloud-off-outline" title="Offline" testID="pill" />
    );
    let pill = StyleSheet.flatten(screen.getByTestId('pill').props.style);
    expect(pill.borderWidth).toBe(stroke.one);
    expect(pill.borderColor).toBe(darkColors.cardEdge);

    mockIsDark = false;
    await rerender(<FloatingPill icon="cloud-off-outline" title="Offline" testID="pill" />);
    pill = StyleSheet.flatten(screen.getByTestId('pill').props.style);
    expect(pill.borderWidth ?? 0).toBe(0);
  });
});
