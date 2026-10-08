/**
 * Scenario: the manual entry header draws a back arrow over a screen with no stack header.
 *
 * Expected behaviour: pressing it fires one light impact and goes back.
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
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
}));

describe('ManualEntryHeader back arrow', () => {
  it.each(['ios', 'android'] as const)('fires one light impact and goes back on %s', (os) => {
    const originalOS = Platform.OS;
    Platform.OS = os;
    (Haptics.impactAsync as jest.Mock).mockClear();
    (router.back as jest.Mock).mockClear();
    try {
      render(<ManualEntryHeader activityType="Run" textPrimary="#000" />);

      fireEvent.press(screen.UNSAFE_getByProps({ name: 'arrow-left' }));

      expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
      expect(Haptics.impactAsync).toHaveBeenCalledWith('light');
      expect(router.back).toHaveBeenCalledTimes(1);
    } finally {
      Platform.OS = originalOS;
    }
  });
});
