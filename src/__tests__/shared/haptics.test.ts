/**
 * Scenario: every haptic in the app goes through one helper, one function per
 * interaction class, on both platforms.
 *
 * Expected behaviour: each function calls its expo-haptics function once with
 * its style whatever Platform.OS says, and a rejected haptic never surfaces as
 * an unhandled rejection.
 */

import { Platform } from 'react-native';
import * as ExpoHaptics from 'expo-haptics';

import * as haptics from '@/shared/ui/haptics';

jest.mock('expo-haptics', () => ({
  ...jest.requireActual('expo-haptics'),
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success' },
}));

const mocked = ExpoHaptics as jest.Mocked<typeof ExpoHaptics>;
const originalOS = Platform.OS;

afterEach(() => {
  Platform.OS = originalOS;
  jest.clearAllMocks();
});

describe.each(['ios', 'android'] as const)('on %s', (os) => {
  beforeEach(() => {
    Platform.OS = os;
  });

  it('selection fires one selection haptic', () => {
    haptics.selection();
    expect(mocked.selectionAsync).toHaveBeenCalledTimes(1);
    expect(mocked.impactAsync).not.toHaveBeenCalled();
  });

  it('light fires one light impact', () => {
    haptics.light();
    expect(mocked.impactAsync).toHaveBeenCalledTimes(1);
    expect(mocked.impactAsync).toHaveBeenCalledWith('light');
    expect(mocked.selectionAsync).not.toHaveBeenCalled();
  });

  it('medium fires one medium impact', () => {
    haptics.medium();
    expect(mocked.impactAsync).toHaveBeenCalledTimes(1);
    expect(mocked.impactAsync).toHaveBeenCalledWith('medium');
  });

  it('success fires one success notification', () => {
    haptics.success();
    expect(mocked.notificationAsync).toHaveBeenCalledTimes(1);
    expect(mocked.notificationAsync).toHaveBeenCalledWith('success');
    expect(mocked.impactAsync).not.toHaveBeenCalled();
  });
});

describe('when the platform rejects the haptic', () => {
  it('raises no unhandled rejection from any class', async () => {
    const reject = () => Promise.reject(new Error('no haptic engine'));
    mocked.selectionAsync.mockImplementation(reject);
    mocked.impactAsync.mockImplementation(reject);
    mocked.notificationAsync.mockImplementation(reject);
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);
    try {
      haptics.selection();
      haptics.light();
      haptics.medium();
      haptics.success();
      await new Promise((resolve) => setImmediate(resolve));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('survives a synchronous throw from the native module', () => {
    mocked.impactAsync.mockImplementationOnce(() => {
      throw new Error('module missing');
    });
    expect(() => haptics.light()).not.toThrow();
  });
});
