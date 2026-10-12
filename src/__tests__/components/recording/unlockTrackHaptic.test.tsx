/**
 * Scenario: the locked recording screen is unlocked by sliding the handle along
 * its track. Unlocking changes a mode; it saves nothing.
 *
 * Expected behaviour: the grab fires one light impact, a slide past the
 * threshold unlocks with one selection tick and never the success notification
 * a save plays, and a slide that falls short fires nothing more.
 */

import React from 'react';
import { PanResponder, type PanResponderCallbacks } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';

import * as haptics from '@/shared/ui/haptics';
import { UnlockTrack } from '@/features/recording/components/UnlockTrack';

jest.mock('@/shared/ui/haptics', () => ({
  selection: jest.fn(),
  light: jest.fn(),
  medium: jest.fn(),
  success: jest.fn(),
}));
jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());
jest.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));

const TRACK_WIDTH = 300;

async function renderTrack() {
  let callbacks: PanResponderCallbacks = {};
  const real = PanResponder.create.bind(PanResponder);
  jest.spyOn(PanResponder, 'create').mockImplementation((config) => {
    callbacks = config;
    return real(config);
  });
  const onUnlock = jest.fn();
  const tree = await render(<UnlockTrack onUnlock={onUnlock} />);
  await fireEvent(tree.getByTestId('unlock-track'), 'layout', {
    nativeEvent: { layout: { width: TRACK_WIDTH, height: 56 } },
  });
  const slide = (dx: number) =>
    act(() => {
      callbacks.onPanResponderGrant?.({} as never, {} as never);
      callbacks.onPanResponderRelease?.({} as never, { dx } as never);
    });
  return { slide, onUnlock };
}

function fired() {
  return {
    selection: (haptics.selection as jest.Mock).mock.calls.length,
    light: (haptics.light as jest.Mock).mock.calls.length,
    medium: (haptics.medium as jest.Mock).mock.calls.length,
    success: (haptics.success as jest.Mock).mock.calls.length,
  };
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it('unlocks with a selection tick and no success notification', async () => {
  const { slide, onUnlock } = await renderTrack();

  await slide(TRACK_WIDTH);

  expect(onUnlock).toHaveBeenCalledTimes(1);
  expect(fired()).toEqual({ selection: 1, light: 1, medium: 0, success: 0 });
});

it('fires only the grab when the slide falls short', async () => {
  const { slide, onUnlock } = await renderTrack();

  await slide(10);

  expect(onUnlock).not.toHaveBeenCalled();
  expect(fired()).toEqual({ selection: 0, light: 1, medium: 0, success: 0 });
});
