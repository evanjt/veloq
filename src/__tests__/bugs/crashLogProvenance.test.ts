/**
 * Scenario: a shared crash log listed its entries and nothing else, so a
 * report could not be matched to the build, platform or engine state that
 * produced it.
 *
 * Expected behaviour: the log opens with the app version and build commit,
 * the native build number, the platform and its version, and whether the
 * engine is open, not open, or failed to open and why.
 */

import { Platform } from 'react-native';
import { InitOutcome } from 'veloqrs';

import { formatCrashLog, type CrashEntry } from '@/shared/debug/crashLog';
import { useEngineStatus } from '@/features/routes/stores/EngineStatusStore';

const mockExpoConfig: Record<string, unknown> = {};
jest.mock('expo-constants', () => ({
  ...jest.requireActual('expo-constants'),
  __esModule: true,
  default: {
    get expoConfig() {
      return mockExpoConfig;
    },
  },
}));

const mockEngine = { ready: false };
jest.mock('@/shared/native/engine', () => ({
  ...jest.requireActual('@/shared/native/engine'),
  isEngineReady: () => mockEngine.ready,
}));

const entry: CrashEntry = {
  ts: Date.UTC(2026, 0, 2, 3, 4, 5),
  source: 'js-global',
  message: 'boom',
  screen: 'feed',
  fatal: true,
};

function headerOf(log: string): string {
  return log.split('\n---\n')[0];
}

beforeEach(() => {
  Object.keys(mockExpoConfig).forEach((k) => delete mockExpoConfig[k]);
  Object.assign(mockExpoConfig, {
    version: '0.9.3',
    extra: { buildCommit: 'c0ffee123' },
    android: { versionCode: 41 },
    ios: { buildNumber: '57' },
  });
  mockEngine.ready = false;
  useEngineStatus.setState({ initFailed: false, initFailureReason: null });
  jest.replaceProperty(Platform, 'OS', 'android');
  jest.spyOn(Platform, 'Version', 'get').mockReturnValue(34);
});

afterEach(() => jest.restoreAllMocks());

describe('the crash log header', () => {
  it('opens with the version, the build commit and the platform', () => {
    const log = formatCrashLog([entry]);
    const first = log.split('\n')[0];
    expect(first).toContain('0.9.3');
    expect(first).toContain('c0ffee123');
    expect(first).toContain('build 41');
    expect(headerOf(log)).toContain('android 34');
    expect(log).toContain('[2026-01-02T03:04:05.000Z] (js-global, fatal) screen=feed\nboom');
  });

  it('says the engine is open', () => {
    mockEngine.ready = true;
    expect(headerOf(formatCrashLog([entry]))).toMatch(/engine open/i);
  });

  it('names why the engine failed to open', () => {
    useEngineStatus.setState({ initFailed: true, initFailureReason: InitOutcome.ForwardSchema });
    const header = headerOf(formatCrashLog([entry]));
    expect(header).toMatch(/failed/i);
    expect(header).toContain('ForwardSchema');
  });

  it('says the engine is not open when it has not opened', () => {
    expect(headerOf(formatCrashLog([entry]))).toMatch(/not open/i);
  });

  it('carries the iOS build number, and the version alone without a stamp', () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    jest.spyOn(Platform, 'Version', 'get').mockReturnValue('18.2');
    mockExpoConfig.extra = {};
    const header = headerOf(formatCrashLog([entry]));
    expect(header.split('\n')[0]).toBe('Veloq 0.9.3, build 57');
    expect(header).toContain('ios 18.2');
  });

  it('still writes the log when a header read throws', () => {
    jest.spyOn(Platform, 'Version', 'get').mockImplementation(() => {
      throw new Error('unreadable');
    });
    const log = formatCrashLog([entry]);
    expect(log.split('\n')[0]).toContain('0.9.3');
    expect(log).toContain('Platform unknown');
    expect(log).toContain('boom');
  });

  it('is empty when there is nothing to report', () => {
    expect(formatCrashLog([])).toBe('');
  });
});
