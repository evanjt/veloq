/**
 * The row is where the athlete sees a Garmin pass and where a paused or
 * stopped one is started by hand, so each state must show its own words and
 * offer Pull now only where a tap changes something. It runs against the real
 * catalogue, which proves every state resolves to a string.
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

import { FfiGarminHalt, FfiGarminPullPhase, type FfiGarminPull } from 'veloqrs';
import { initialiseI18n, changeLanguage } from '@/i18n';
import { GarminPullRow } from '@/features/settings/components/GarminPullRow';
import { useDebugStore } from '@/features/settings/stores/DebugStore';

const mockPullNow = jest.fn();
const mockUseGarminPull = jest.fn();
jest.mock('@/features/settings/hooks/useGarminPull', () => ({
  useGarminPull: () => mockUseGarminPull(),
}));

function pull(over: Partial<FfiGarminPull>) {
  mockUseGarminPull.mockReturnValue({
    pull: {
      phase: FfiGarminPullPhase.Idle,
      resumeAt: undefined,
      halt: undefined,
      stored: 42,
      reachedMonth: '2025-03',
      backfillDone: false,
      ...over,
    },
    pullNow: mockPullNow,
  });
  return render(<GarminPullRow isDark={false} />);
}

describe('GarminPullRow', () => {
  beforeAll(async () => {
    await initialiseI18n('en-AU');
  });

  beforeEach(async () => {
    await changeLanguage('en-AU');
    mockPullNow.mockClear();
    useDebugStore.setState({
      experimentalEnabled: true,
      experimentalFeatures: { garminUpdate: true },
    });
  });

  it("stays away while Garmin's experimental switch is off", () => {
    useDebugStore.setState({ experimentalEnabled: false });
    const tree = pull({ phase: FfiGarminPullPhase.Running });

    expect(tree.queryByTestId('settings-garmin-pull')).toBeNull();
  });

  it('stays away while no Garmin key is held', () => {
    mockUseGarminPull.mockReturnValue({ pull: undefined, pullNow: mockPullNow });
    const tree = render(<GarminPullRow isDark={false} />);

    expect(tree.queryByTestId('settings-garmin-pull')).toBeNull();
  });

  it('shows a running pass with its count and month and offers no tap', () => {
    const tree = pull({ phase: FfiGarminPullPhase.Running });

    expect(tree.getByTestId('settings-garmin-pull-status').props.children).toBe('Running');
    expect(tree.getByTestId('settings-garmin-pull-detail').props.children).toContain('42');
    expect(tree.getByTestId('settings-garmin-pull-detail').props.children).toContain('2025');
    expect(tree.queryByTestId('settings-garmin-pull-now')).toBeNull();
  });

  it('shows a paused pass with its resume time and pulls on tap', () => {
    const tree = pull({
      phase: FfiGarminPullPhase.Paused,
      resumeAt: new Date(2026, 9, 25, 14, 30).getTime(),
    });

    expect(tree.getByTestId('settings-garmin-pull-status').props.children).toMatch(
      /^Paused until /
    );
    fireEvent.press(tree.getByTestId('settings-garmin-pull-now'));
    expect(mockPullNow).toHaveBeenCalledTimes(1);
  });

  it('shows a finished pass with no tap', () => {
    const tree = pull({ phase: FfiGarminPullPhase.Done, backfillDone: true });

    expect(tree.getByTestId('settings-garmin-pull-status').props.children).toBe('Up to date');
    expect(tree.queryByTestId('settings-garmin-pull-now')).toBeNull();
  });

  it.each([
    [FfiGarminHalt.KeyRejected, /key/i],
    [FfiGarminHalt.Unreachable, /reach/i],
    [FfiGarminHalt.Unstorable, /keep|store/i],
  ])('shows why a stopped pass ended (%s) and offers a tap', (halt, words) => {
    const tree = pull({ phase: FfiGarminPullPhase.Stopped, halt });

    expect(tree.getByTestId('settings-garmin-pull-status').props.children).toMatch(words);
    expect(tree.getByTestId('settings-garmin-pull-now')).toBeTruthy();
  });
});
