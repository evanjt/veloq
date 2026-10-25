/**
 * Scenario: an activity intervals.icu imported from Garmin, opened with a
 * Garmin key connected.
 *
 * Expected behaviour: nothing renders unless the engine offers the swap; the
 * button asks before it replaces anything; a swap that landed says so and
 * reads the engine's state again; and Undo shows once a swap has kept the
 * earlier file.
 */

import React from 'react';
import { configure, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SwapOutcome, SwapState } from 'veloqrs';

import { ActivityGarminSwap } from '@/features/activity/components/ActivityGarminSwap';
import * as engine from '@/shared/native/garminSwap';
import { confirmAction } from '@/shared/ui/dialog';
import * as recording from '@/features/recording';

configure({ defaultIncludeHiddenElements: true });

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));
jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/native/syncRefresh', () => ({ requestSyncRefresh: jest.fn() }));
jest.mock('@/shared/native/garminSwap', () => ({
  garminSwapState: jest.fn(),
  garminSwapReplace: jest.fn(),
  garminSwapUndo: jest.fn(),
}));
jest.mock('@/shared/ui/dialog', () => ({ confirmAction: jest.fn() }));
jest.mock('@/features/recording', () => {
  const { Pressable, Text } = require('react-native');
  const R = require('react');
  return {
    useWriteAccessMissing: jest.fn(),
    usePermissionUpgrade: jest.fn(),
    GrantAccessButton: ({ onPress, testID }: { onPress: () => void; testID?: string }) =>
      R.createElement(
        Pressable,
        { onPress, testID },
        R.createElement(Text, null, 'recording.grantAccess')
      ),
  };
});

const state = engine.garminSwapState as jest.Mock;
const replace = engine.garminSwapReplace as jest.Mock;
const undo = engine.garminSwapUndo as jest.Mock;
const confirm = confirmAction as jest.Mock;

const writeMissing = recording.useWriteAccessMissing as jest.Mock;
const upgradeHook = recording.usePermissionUpgrade as jest.Mock;
const upgrade = jest.fn();

beforeEach(() => {
  jest.resetAllMocks();
  writeMissing.mockReturnValue(false);
  upgrade.mockResolvedValue({ granted: true, error: null });
  upgradeHook.mockReturnValue({ upgradePermissions: upgrade, isUpgrading: false, error: null });
});

describe('ActivityGarminSwap', () => {
  it('renders nothing while the engine offers nothing', async () => {
    state.mockResolvedValue(SwapState.Hidden);
    render(<ActivityGarminSwap activityId="i1" />);
    await waitFor(() => expect(state).toHaveBeenCalledWith('i1'));
    expect(screen.queryByTestId('activity-i1-garmin-swap')).toBeNull();
  });

  it('renders nothing when the engine read fails', async () => {
    state.mockRejectedValue(new Error('closed'));
    render(<ActivityGarminSwap activityId="i1" />);
    await waitFor(() => expect(state).toHaveBeenCalled());
    expect(screen.queryByTestId('activity-i1-garmin-swap')).toBeNull();
  });

  it('offers the swap marked experimental, and replaces only after the confirmation', async () => {
    state.mockResolvedValueOnce(SwapState.Available).mockResolvedValue(SwapState.Undoable);
    replace.mockResolvedValue({ outcome: SwapOutcome.Replaced });
    render(<ActivityGarminSwap activityId="i1" />);

    const button = await screen.findByTestId('activity-i1-garmin-swap-button');
    expect(screen.getByText('activity.garminSwap.badge')).toBeTruthy();
    expect(screen.getByText('activity.garminSwap.detail')).toBeTruthy();

    fireEvent.press(button);
    expect(replace).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledTimes(1);

    confirm.mock.calls[0][0].onConfirm();
    await waitFor(() => expect(replace).toHaveBeenCalledWith('i1'));
    expect(await screen.findByText('activity.garminSwap.replaced')).toBeTruthy();
    expect(await screen.findByTestId('activity-i1-garmin-swap-undo')).toBeTruthy();
    expect(screen.queryByTestId('activity-i1-garmin-swap-button')).toBeNull();
  });

  it('says a refusal changed nothing and keeps the offer', async () => {
    state.mockResolvedValue(SwapState.Available);
    replace.mockResolvedValue({ outcome: SwapOutcome.Refused, detail: 'no' });
    render(<ActivityGarminSwap activityId="i1" />);
    await screen.findByTestId('activity-i1-garmin-swap-button');
    fireEvent.press(screen.getByTestId('activity-i1-garmin-swap-button'));
    confirm.mock.calls[0][0].onConfirm();

    expect(await screen.findByText('activity.garminSwap.refused')).toBeTruthy();
    expect(screen.getByTestId('activity-i1-garmin-swap-button')).toBeTruthy();
  });

  it('undoes a swap and goes back to nothing offered when the files match again', async () => {
    state.mockResolvedValueOnce(SwapState.Undoable).mockResolvedValue(SwapState.Available);
    undo.mockResolvedValue({ outcome: SwapOutcome.Restored });
    render(<ActivityGarminSwap activityId="i1" />);

    fireEvent.press(await screen.findByTestId('activity-i1-garmin-swap-undo'));

    await waitFor(() => expect(undo).toHaveBeenCalledWith('i1'));
    expect(await screen.findByText('activity.garminSwap.restored')).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });

  describe('write access', () => {
    const tap = async () => {
      state.mockResolvedValue(SwapState.Available);
      render(<ActivityGarminSwap activityId="i1" />);
      fireEvent.press(await screen.findByTestId('activity-i1-garmin-swap-button'));
    };

    it('asks for write access at the tap on a session without it, then confirms', async () => {
      writeMissing.mockReturnValue(true);
      await tap();
      await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
      expect(upgrade).toHaveBeenCalledTimes(1);
      expect(replace).not.toHaveBeenCalled();
    });

    it('goes no further when the upgrade is cancelled, and shows no error', async () => {
      writeMissing.mockReturnValue(true);
      upgrade.mockResolvedValue({ granted: false, error: null });
      await tap();
      await waitFor(() => expect(upgrade).toHaveBeenCalled());
      expect(confirm).not.toHaveBeenCalled();
      expect(replace).not.toHaveBeenCalled();
      expect(screen.queryByTestId('activity-i1-garmin-swap-upgrade-error')).toBeNull();
      expect(screen.getByTestId('activity-i1-garmin-swap-button')).toBeTruthy();
    });

    it('shows the upgrade error and does not swap when the upgrade fails', async () => {
      writeMissing.mockReturnValue(true);
      upgrade.mockResolvedValue({ granted: false, error: 'not granted' });
      upgradeHook.mockReturnValue({
        upgradePermissions: upgrade,
        isUpgrading: false,
        error: 'not granted',
      });
      await tap();
      await waitFor(() => expect(upgrade).toHaveBeenCalled());
      expect(confirm).not.toHaveBeenCalled();
      expect(await screen.findByText('not granted')).toBeTruthy();
    });

    it('runs no upgrade for a session that already can write', async () => {
      await tap();
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(upgrade).not.toHaveBeenCalled();
    });

    it('offers Grant access beside a swap the engine reports as permission blocked', async () => {
      state.mockResolvedValue(SwapState.Available);
      replace.mockResolvedValue({ outcome: SwapOutcome.PermissionBlocked });
      render(<ActivityGarminSwap activityId="i1" />);
      fireEvent.press(await screen.findByTestId('activity-i1-garmin-swap-button'));
      confirm.mock.calls[0][0].onConfirm();

      expect(await screen.findByText('activity.garminSwap.permission')).toBeTruthy();
      fireEvent.press(screen.getByTestId('activity-i1-garmin-swap-grant-access'));
      expect(upgrade).toHaveBeenCalledTimes(1);
    });
  });
});
