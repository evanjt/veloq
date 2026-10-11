/**
 * Scenario: the manual entry header draws a back arrow over a screen with no stack header.
 *
 * Expected behaviour: pressing it fires one light impact and goes back, and when the screen was
 * opened as the stack root it goes to the Feed instead of doing nothing.
 */

import React from 'react';
import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { ManualEntryHeader } from '@/features/recording/components/ManualEntryHeader';

jest.mock('expo-haptics', () => ({
  ...jest.requireActual('expo-haptics'),
  impactAsync: jest.fn(() => Promise.resolve()),
  performAndroidHapticsAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
}));

let canGoBack: jest.SpyInstance;

beforeEach(() => {
  (router.back as jest.Mock).mockClear();
  (router.replace as jest.Mock).mockClear();
  canGoBack = jest.spyOn(router, 'canGoBack').mockReturnValue(true);
});

afterEach(() => {
  canGoBack.mockRestore();
});

describe('ManualEntryHeader back arrow', () => {
  it.each([
    ['ios', Haptics.impactAsync, 'light'],
    ['android', Haptics.performAndroidHapticsAsync, 'context-click'],
  ] as const)('fires one light haptic and goes back on %s', (os, call, constant) => {
    const originalOS = Platform.OS;
    Platform.OS = os;
    (call as jest.Mock).mockClear();
    (router.back as jest.Mock).mockClear();
    try {
      render(<ManualEntryHeader activityType="Run" textPrimary="#000" />);

      fireEvent.press(screen.UNSAFE_getByProps({ name: 'arrow-left' }));

      expect(call).toHaveBeenCalledTimes(1);
      expect(call).toHaveBeenCalledWith(constant);
      expect(router.back).toHaveBeenCalledTimes(1);
    } finally {
      Platform.OS = originalOS;
    }
  });

  it('goes to the Feed when the screen is the stack root', () => {
    canGoBack.mockReturnValue(false);
    render(<ManualEntryHeader activityType="Run" textPrimary="#000" />);

    fireEvent.press(screen.UNSAFE_getByProps({ name: 'arrow-left' }));

    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith('/');
  });
});
