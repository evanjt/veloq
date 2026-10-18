/**
 * Scenario: a render error reaches the root boundary in a release build, where
 * the app has no reload and the navigator, its header and back are gone, while a
 * ride may still be recording underneath.
 *
 * Expected behaviour: the crash screen offers a way forward. Retry renders the
 * app again, the crash log can be shared, and a live ride is named with an
 * action that stops and keeps it.
 */

import React from 'react';
import { Appearance, StyleSheet } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';

import { GlobalErrorBoundary } from '@/shared/ui/GlobalErrorBoundary';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { endRecordingSession } from '@/features/recording/lib/endRecordingSession';
import { shareFile } from '@/features/settings/lib/shareFile';
import { colors, darkColors } from '@/theme';

jest.mock('@/shared/debug/boundaryCrash', () => ({ recordBoundaryCrash: jest.fn() }));
jest.mock('@/shared/debug/crashLog', () => ({
  getCrashLog: jest.fn(async () => [{ ts: 1, source: 'js-boundary', message: 'orchard fell' }]),
  formatCrashLog: () => 'orchard fell',
}));
jest.mock('@/features/settings/lib/shareFile', () => ({ shareFile: jest.fn(async () => {}) }));
jest.mock('@/features/recording/lib/endRecordingSession', () => ({
  endRecordingSession: jest.fn(async () => {
    const { useRecordingStore: store } = jest.requireActual(
      '@/features/recording/stores/RecordingStore'
    );
    store.getState().stopRecording();
  }),
}));

// React renders a failed tree a second time before a boundary catches it, so
// the child fails until the test clears the cause.
let broken = true;

function Orchard(): React.ReactElement {
  if (broken) throw new Error('orchard fell');
  const { Text } = require('react-native');
  return <Text>orchard grows</Text>;
}

const dev = (globalThis as unknown as { __DEV__: boolean }).__DEV__;
let consoleError: jest.SpyInstance;

beforeEach(() => {
  broken = true;
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  useRecordingStore.getState().reset();
  jest.clearAllMocks();
});

afterEach(() => {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = dev;
  consoleError.mockRestore();
  jest.restoreAllMocks();
});

function renderCrash() {
  return render(
    <GlobalErrorBoundary>
      <Orchard />
    </GlobalErrorBoundary>
  );
}

describe('the app crash screen in a release build', () => {
  it('renders the app again on Retry', async () => {
    const tree = await renderCrash();
    expect(tree.queryByText('orchard grows')).toBeNull();

    broken = false;
    await act(async () => {
      fireEvent.press(tree.getByText('Retry'));
    });

    expect(tree.getByText('orchard grows')).toBeTruthy();
    expect(tree.queryByText('Retry')).toBeNull();
  });

  it('says the library is unaffected and never asks the athlete to quit', async () => {
    const tree = await renderCrash();

    expect(tree.getByText('Your activities on this device are unaffected.')).toBeTruthy();
    expect(tree.queryByText(/close and reopen/i)).toBeNull();
  });

  it('shares the crash log', async () => {
    const tree = await renderCrash();

    await act(async () => {
      fireEvent.press(tree.getByText('Share crash log'));
    });

    expect(shareFile).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'orchard fell', kind: 'text' })
    );
  });

  it('says so when the share sheet cannot open, and stays on the screen', async () => {
    (shareFile as jest.Mock).mockRejectedValueOnce(new Error('no sharing'));
    const tree = await renderCrash();

    await act(async () => {
      fireEvent.press(tree.getByText('Share crash log'));
    });

    expect(tree.getByText("Couldn't share the crash log.")).toBeTruthy();
    expect(tree.getByText('Retry')).toBeTruthy();
  });

  it('offers no ride action when nothing is recording', async () => {
    const tree = await renderCrash();

    expect(tree.queryByText('Your ride is still recording.')).toBeNull();
    expect(tree.queryByText('Stop and save ride')).toBeNull();
  });

  it.each(['recording', 'paused'] as const)(
    'names a %s ride and stops and keeps it',
    async (status) => {
      useRecordingStore.setState({ status, startTime: Date.now() - 60_000 });
      const tree = await renderCrash();

      expect(tree.getByText('Your ride is still recording.')).toBeTruthy();
      await act(async () => {
        fireEvent.press(tree.getByText('Stop and save ride'));
      });

      expect(endRecordingSession).toHaveBeenCalledTimes(1);
      expect(useRecordingStore.getState().status).toBe('stopped');
      expect(tree.queryByText('Your ride is still recording.')).toBeNull();
      expect(tree.getByText('Your ride is stopped and kept on this device.')).toBeTruthy();
    }
  );

  it.each([
    ['light', colors],
    ['dark', darkColors],
  ] as const)('draws the %s appearance from the theme roles', async (scheme, roles) => {
    jest.spyOn(Appearance, 'getColorScheme').mockReturnValue(scheme);
    const tree = await renderCrash();

    const container = tree.getByText('Something went wrong').parent?.parent;
    expect(container).toHaveStyle({ backgroundColor: roles.surfacePage });
    expect(tree.getByText('Something went wrong')).toHaveStyle({ color: roles.textPrimary });
    expect(tree.getByText('Your activities on this device are unaffected.')).toHaveStyle({
      color: roles.textSecondary,
    });

    const action = StyleSheet.flatten(tree.getByText('Retry').props.style).color as string;
    expect(action).toBe(roles.actionLink);
    expect(isTeal(action)).toBe(false);
    expect(contrast(action, roles.surfacePage)).toBeGreaterThanOrEqual(4.5);
  });
});

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** A hue between green and cyan, where the retired teal sat. */
function isTeal(hex: string): boolean {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const span = max - Math.min(r, g, b);
  if (span === 0) return false;
  const hue =
    max === r
      ? 60 * (((g - b) / span) % 6)
      : max === g
        ? 60 * ((b - r) / span + 2)
        : 60 * ((r - g) / span + 4);
  return hue >= 150 && hue <= 195;
}
