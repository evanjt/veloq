import React from 'react';
import { Linking, StyleSheet } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';

import { EngineInitBanner } from '@/shared/app/EngineInitBanner';
import { useEngineStatus } from '@/features/routes/stores/EngineStatusStore';
import { shareFile } from '@/features/settings/lib/shareFile';
import { amberBanner, spacing } from '@/theme';
import { InitOutcome } from '../__shared__/veloqrsStub';

type EngineStatusReason = Parameters<
  ReturnType<typeof useEngineStatus.getState>['setInitFailureReason']
>[0];

/**
 * Scenario: the engine will not open. A database written by a newer build is
 * fixed by updating the app, a file another connection holds fixes itself, and
 * a directory nothing can be written to needs space or permission. All three
 * showed the same sentence.
 * Expected behaviour: the banner names the reason the engine recorded, and
 * falls back to the general line for a reason this bundle has no string for.
 */

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

const mockInsets = { top: 0, bottom: 0, left: 0, right: 0 };

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => mockInsets,
}));

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

let mockIsDark = false;
jest.mock('@/shared/app/useTheme', () => ({ useTheme: () => ({ isDark: mockIsDark }) }));

jest.mock('expo-web-browser', () => ({
  ...jest.requireActual('expo-web-browser'),
  openBrowserAsync: jest.fn(async () => undefined),
}));

jest.mock('@/features/settings/lib/shareFile', () => ({
  shareFile: jest.fn(async () => undefined),
}));

jest.mock('@/shared/debug/crashLog', () => ({
  getCrashLog: jest.fn(async () => [{ ts: 1, source: 'js-global', message: 'boom' }]),
  formatCrashLog: () => 'formatted log',
}));

/**
 * The stub's enum is a separate declaration from the generated one the store
 * is typed against, and `ffiEnumStub.test.ts` is what holds the two together.
 */
function failedWith(reason: InitOutcome | null) {
  useEngineStatus.setState({
    initFailed: true,
    initFailureReason: reason as unknown as EngineStatusReason,
  });
}

describe('EngineInitBanner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInsets.top = 0;
    mockIsDark = false;
    useEngineStatus.setState({ initFailed: false, initFailureReason: null });
  });

  it('stays hidden while the engine is open', async () => {
    const { queryByTestId } = await render(<EngineInitBanner />);
    expect(queryByTestId('engine-init-banner')).toBeNull();
  });

  it.each([
    [InitOutcome.Busy, 'engine.initReason.busy'],
    [InitOutcome.ForwardSchema, 'engine.initReason.forwardSchema'],
    [InitOutcome.StorageUnavailable, 'engine.initReason.storageUnavailable'],
    [InitOutcome.Failed, 'engine.initReason.failed'],
    [InitOutcome.VersionMismatch, 'engine.initReason.versionMismatch'],
  ])('names reason %s with its own line', async (reason, key) => {
    failedWith(reason);
    const { getByText } = await render(<EngineInitBanner />);
    expect(getByText(key)).toBeTruthy();
  });

  it('falls back to the general line when no reason was recorded', async () => {
    failedWith(null);
    const { getByText } = await render(<EngineInitBanner />);
    expect(getByText('engine.initFailed')).toBeTruthy();
  });

  /** An engine newer than the bundle answers with a variant that has no string. */
  it('falls back to the general line for a reason it has no string for', async () => {
    failedWith(99 as InitOutcome);
    const { getByText } = await render(<EngineInitBanner />);
    expect(getByText('engine.initFailed')).toBeTruthy();
  });

  /** Opened is not a failure, and must never reach the banner as one. */
  it('shows the general line rather than a reason when the engine opened', async () => {
    failedWith(InitOutcome.Opened);
    const { getByText } = await render(<EngineInitBanner />);
    expect(getByText('engine.initFailed')).toBeTruthy();
  });

  /** A centre cut-out or status bar covers the top inset, so the text starts below it. */
  it('pads its top edge by the safe-area inset', async () => {
    mockInsets.top = 44;
    failedWith(InitOutcome.Busy);
    const { getByTestId } = await render(<EngineInitBanner />);
    expect(StyleSheet.flatten(getByTestId('engine-init-banner').props.style).paddingTop).toBe(44);
  });

  /** The retry is the only way out of a failed open, so a screen reader has to name it. */
  it('names its retry control for a screen reader', async () => {
    failedWith(InitOutcome.Busy);
    const { getByRole } = await render(<EngineInitBanner />);
    expect(getByRole('button', { name: 'common.retry' })).toBeTruthy();
  });

  /** With no inset to clear, the text keeps the room its own content gives it, and nothing more. */
  it('keeps its own padding when there is no inset', async () => {
    failedWith(InitOutcome.Busy);
    const { getByTestId } = await render(<EngineInitBanner />);
    expect(StyleSheet.flatten(getByTestId('engine-init-banner').props.style).paddingTop).toBe(0);
    expect(
      StyleSheet.flatten(getByTestId('engine-init-banner-content').props.style).paddingVertical
    ).toBe(spacing.sm);
  });

  /**
   * Each reason offers the recovery that can fix it: a database from a newer
   * build needs the app updated, a full disk needs space, and a file whose
   * records disagree needs someone to look at it. Re-opening fixes none of
   * those three, and fixes the two whose cause can pass on its own.
   */
  describe('recovery actions', () => {
    it.each([InitOutcome.Busy, InitOutcome.Failed])(
      'retries %s from a named button',
      async (reason) => {
        const requestRetry = jest.fn();
        useEngineStatus.setState({ requestRetry });
        failedWith(reason);
        const { getByText } = await render(<EngineInitBanner />);
        await fireEvent.press(getByText('common.retry'));
        expect(requestRetry).toHaveBeenCalledTimes(1);
      }
    );

    it('opens the store page for a database a newer build wrote', async () => {
      const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
      failedWith(InitOutcome.ForwardSchema);
      const { getByText, queryByText } = await render(<EngineInitBanner />);
      await fireEvent.press(getByText('engine.initAction.update'));
      expect(openURL).toHaveBeenCalledTimes(1);
      expect(openURL.mock.calls[0][0]).toMatch(/^(market|itms-apps):\/\//);
      expect(openURL.mock.calls[0][0]).not.toContain('write-review');
      expect(queryByText('common.retry')).toBeNull();
    });

    it('routes to the data cache for storage it cannot write, and still retries', async () => {
      const requestRetry = jest.fn();
      useEngineStatus.setState({ requestRetry });
      failedWith(InitOutcome.StorageUnavailable);
      const { getByText } = await render(<EngineInitBanner />);
      await fireEvent.press(getByText('engine.initAction.freeSpace'));
      expect(router.push).toHaveBeenCalledWith('/cache-settings');
      await fireEvent.press(getByText('common.retry'));
      expect(requestRetry).toHaveBeenCalledTimes(1);
    });

    it('shares the crash log and opens the forum for a file it kept aside', async () => {
      failedWith(InitOutcome.VersionMismatch);
      const { getByText, queryByText } = await render(<EngineInitBanner />);
      await fireEvent.press(getByText('support.shareCrashLog'));
      await waitFor(() => expect(shareFile).toHaveBeenCalledTimes(1));
      expect(shareFile).toHaveBeenCalledWith(
        expect.objectContaining({ content: 'formatted log', mimeType: 'text/plain' })
      );
      await fireEvent.press(getByText('support.forum'));
      expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith(
        expect.stringMatching(/^https:\/\/forum\.intervals\.icu\//)
      );
      expect(queryByText('common.retry')).toBeNull();
    });

    it('keeps a retry for a reason this bundle has no case for', async () => {
      failedWith(99 as InitOutcome);
      const { getByText } = await render(<EngineInitBanner />);
      expect(getByText('common.retry')).toBeTruthy();
    });
  });

  describe('palette', () => {
    it.each([
      [false, amberBanner.light],
      [true, amberBanner.dark],
    ])('draws the banner for dark mode %s from its own tones', async (isDark, palette) => {
      mockIsDark = isDark;
      failedWith(InitOutcome.Busy);
      const { getByTestId, getByText } = await render(<EngineInitBanner />);
      expect(
        StyleSheet.flatten(getByTestId('engine-init-banner').props.style).backgroundColor
      ).toBe(palette.bg);
      expect(StyleSheet.flatten(getByText('engine.initReason.busy').props.style).color).toBe(
        palette.text
      );
    });
  });
});
