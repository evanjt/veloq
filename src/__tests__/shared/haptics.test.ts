/**
 * Scenario: every haptic in the app goes through one helper, one function per
 * interaction class, on both platforms.
 *
 * Expected behaviour: on iOS each function calls its feedback-generator call
 * once with its style; on Android each goes through the view's haptic feedback
 * with its constant and never through a raw vibrator waveform, so it follows
 * the system touch feedback setting. A rejected haptic never surfaces as an
 * unhandled rejection.
 */

import { Platform } from 'react-native';
import * as ExpoHaptics from 'expo-haptics';

import * as haptics from '@/shared/ui/haptics';

jest.mock('expo-haptics', () => ({
  ...jest.requireActual('expo-haptics'),
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  performAndroidHapticsAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success' },
  AndroidHaptics: {
    Segment_Tick: 'segment-tick',
    Context_Click: 'context-click',
    Long_Press: 'long-press',
    Confirm: 'confirm',
  },
}));

const mocked = ExpoHaptics as jest.Mocked<typeof ExpoHaptics>;
const originalOS = Platform.OS;

afterEach(() => {
  Platform.OS = originalOS;
  jest.clearAllMocks();
});

describe('on ios', () => {
  beforeEach(() => {
    Platform.OS = 'ios';
  });

  it('selection fires one selection haptic', () => {
    haptics.selection();
    expect(mocked.selectionAsync).toHaveBeenCalledTimes(1);
    expect(mocked.impactAsync).not.toHaveBeenCalled();
    expect(mocked.performAndroidHapticsAsync).not.toHaveBeenCalled();
  });

  it('light fires one light impact', () => {
    haptics.light();
    expect(mocked.impactAsync).toHaveBeenCalledTimes(1);
    expect(mocked.impactAsync).toHaveBeenCalledWith('light');
    expect(mocked.selectionAsync).not.toHaveBeenCalled();
    expect(mocked.performAndroidHapticsAsync).not.toHaveBeenCalled();
  });

  it('medium fires one medium impact', () => {
    haptics.medium();
    expect(mocked.impactAsync).toHaveBeenCalledTimes(1);
    expect(mocked.impactAsync).toHaveBeenCalledWith('medium');
    expect(mocked.performAndroidHapticsAsync).not.toHaveBeenCalled();
  });

  it('success fires one success notification', () => {
    haptics.success();
    expect(mocked.notificationAsync).toHaveBeenCalledTimes(1);
    expect(mocked.notificationAsync).toHaveBeenCalledWith('success');
    expect(mocked.impactAsync).not.toHaveBeenCalled();
    expect(mocked.performAndroidHapticsAsync).not.toHaveBeenCalled();
  });
});

describe('on android', () => {
  beforeEach(() => {
    Platform.OS = 'android';
  });

  afterEach(() => {
    expect(mocked.selectionAsync).not.toHaveBeenCalled();
    expect(mocked.impactAsync).not.toHaveBeenCalled();
    expect(mocked.notificationAsync).not.toHaveBeenCalled();
  });

  it.each([
    ['selection', haptics.selection, 'segment-tick'],
    ['light', haptics.light, 'context-click'],
    ['medium', haptics.medium, 'long-press'],
    ['success', haptics.success, 'confirm'],
  ] as const)('%s fires one view haptic and no vibrator waveform', (_name, fire, constant) => {
    fire();
    expect(mocked.performAndroidHapticsAsync).toHaveBeenCalledTimes(1);
    expect(mocked.performAndroidHapticsAsync).toHaveBeenCalledWith(constant);
  });

  it('a pull to refresh fires the long-press view haptic', () => {
    haptics.onPullRefresh(() => undefined)();
    expect(mocked.performAndroidHapticsAsync).toHaveBeenCalledTimes(1);
    expect(mocked.performAndroidHapticsAsync).toHaveBeenCalledWith('long-press');
  });
});

describe.each(['ios', 'android'] as const)('when the platform rejects the haptic on %s', (os) => {
  beforeEach(() => {
    Platform.OS = os;
  });

  afterEach(() => {
    mocked.selectionAsync.mockImplementation(() => Promise.resolve());
    mocked.impactAsync.mockImplementation(() => Promise.resolve());
    mocked.notificationAsync.mockImplementation(() => Promise.resolve());
    mocked.performAndroidHapticsAsync.mockImplementation(() => Promise.resolve());
  });

  it('raises no unhandled rejection from any class', async () => {
    const reject = () => Promise.reject(new Error('no haptic engine'));
    mocked.selectionAsync.mockImplementation(reject);
    mocked.impactAsync.mockImplementation(reject);
    mocked.notificationAsync.mockImplementation(reject);
    mocked.performAndroidHapticsAsync.mockImplementation(reject);
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
    const missing = () => {
      throw new Error('module missing');
    };
    const native = os === 'android' ? mocked.performAndroidHapticsAsync : mocked.impactAsync;
    native.mockImplementationOnce(missing);
    expect(() => haptics.light()).not.toThrow();
    expect(native).toHaveBeenCalledTimes(1);
  });
});

describe('onPullRefresh', () => {
  beforeEach(() => {
    Platform.OS = 'ios';
    mocked.impactAsync.mockImplementation(() => Promise.resolve());
  });

  it('fires one medium impact before the handler runs, on every call', async () => {
    const order: string[] = [];
    mocked.impactAsync.mockImplementation(() => {
      order.push('haptic');
      return Promise.resolve();
    });
    const handler = jest.fn(() => {
      order.push('handler');
    });
    const wrapped = haptics.onPullRefresh(handler);

    wrapped();
    expect(order).toEqual(['haptic', 'handler']);
    expect(mocked.impactAsync).toHaveBeenCalledWith('medium');

    wrapped();
    expect(mocked.impactAsync).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('returns what the handler returns', async () => {
    const wrapped = haptics.onPullRefresh(() => Promise.resolve(7));
    await expect(wrapped()).resolves.toBe(7);
  });

  it('fires once and passes a rejection through', async () => {
    const wrapped = haptics.onPullRefresh(() => Promise.reject(new Error('offline')));
    await expect(wrapped()).rejects.toThrow('offline');
    expect(mocked.impactAsync).toHaveBeenCalledTimes(1);
  });
});
