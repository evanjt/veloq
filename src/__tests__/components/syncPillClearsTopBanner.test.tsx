/**
 * Scenario: a sync runs while the sync-error banner from the last one is still
 * up. The pill floats under the status bar and the banner's headline is drawn
 * at the same height, so the pill covered it.
 *
 * Expected behaviour: a floating pill sits below every banner in the top slot,
 * and goes back under the status bar once the banners are gone.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SyncState, SyncStep } from 'veloqrs';

import { useAuthStore } from '@/shared/app/AuthStore';
import { getEngine } from '@/shared/native/engine';
import { SyncErrorBanner } from '@/shared/ui/SyncErrorBanner';
import { FloatingPillStack } from '@/shared/ui/FloatingPillStack';
import { EngineInitBanner } from '@/shared/app/EngineInitBanner';
import { useEngineStatus } from '@/features/routes/stores/EngineStatusStore';
import { spacing } from '@/theme';
import { SyncErrorReason } from '../__shared__/veloqrsStub';

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

const TOP_INSET = 47;
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@/shared/app/useTheme', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/app', () => ({
  ...jest.requireActual('@/shared/app'),
  useTheme: () => ({ isDark: false }),
}));

let mockOffline = false;
jest.mock('@/shared/app/NetworkContext', () => ({
  useNetwork: () => ({ isOnline: !mockOffline, offlineBannerShown: mockOffline }),
}));

let mockHealth = {
  lastError: 'HTTP 503' as string | null,
  lastErrorReason: SyncErrorReason.Server as SyncErrorReason | null,
  lastSuccessAt: null as string | null,
};
jest.mock('@/shared/native/useSyncHealth', () => ({ useSyncHealth: () => mockHealth }));

const engine = {
  getSyncStatus: jest.fn(() => ({
    state: SyncState.Syncing,
    completed: 2,
    total: 10,
    step: SyncStep.Activities,
    stepItemsDone: 2,
    stepItemsTotal: 10,
  })),
  subscribe: jest.fn(() => () => {}),
};

async function laidOut(testID: string, height: number): Promise<void> {
  await fireEvent(screen.getByTestId(testID), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 400, height } },
  });
}

function top(testID: string): number {
  return StyleSheet.flatten(screen.getByTestId(testID).props.style).top;
}

beforeEach(() => {
  (getEngine as jest.Mock).mockReturnValue(engine);
  mockOffline = false;
  mockHealth = {
    lastError: 'HTTP 503',
    lastErrorReason: SyncErrorReason.Server,
    lastSuccessAt: null,
  };
  useAuthStore.setState({ isAuthenticated: true, isDemoMode: false });
  useEngineStatus.setState({ initFailed: false, initFailureReason: null });
});

describe('a floating pill and the top banners', () => {
  it('draws the sync pill below the sync-error banner', async () => {
    await render(
      <>
        <SyncErrorBanner />
        <FloatingPillStack />
      </>
    );
    await laidOut('sync-error-banner', 96);

    expect(top('floating-pill-sync')).toBeGreaterThanOrEqual(96);
  });

  it('draws the sync pill below two stacked banners', async () => {
    useEngineStatus.setState({ initFailed: true, initFailureReason: null });
    await render(
      <>
        <SyncErrorBanner />
        <EngineInitBanner />
        <FloatingPillStack />
      </>
    );
    await laidOut('sync-error-banner', 96);
    await laidOut('engine-init-banner', 80);

    expect(top('floating-pill-sync')).toBeGreaterThanOrEqual(96 + 80);
  });

  it('puts the sync pill back under the status bar once the banner goes', async () => {
    const tree = () => (
      <>
        <SyncErrorBanner />
        <FloatingPillStack />
      </>
    );
    const { rerender } = await render(tree());
    await laidOut('sync-error-banner', 96);

    mockHealth = { lastError: null, lastErrorReason: null, lastSuccessAt: null };
    await rerender(tree());

    expect(top('floating-pill-sync')).toBe(TOP_INSET + spacing.xs);
  });

  it('sits under the status bar when no banner is up', async () => {
    mockHealth = { lastError: null, lastErrorReason: null, lastSuccessAt: null };
    await render(<FloatingPillStack />);

    expect(top('floating-pill-sync')).toBe(TOP_INSET + spacing.xs);
  });

  it('draws the offline pill below a notice in the slot', async () => {
    useEngineStatus.setState({ initFailed: true, initFailureReason: null });
    mockOffline = true;
    await render(
      <>
        <EngineInitBanner />
        <FloatingPillStack />
      </>
    );
    await laidOut('engine-init-banner', 80);

    expect(top('floating-pill-offline')).toBeGreaterThanOrEqual(80);
  });
});
