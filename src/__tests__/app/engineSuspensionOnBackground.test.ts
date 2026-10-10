/**
 * Scenario: on iOS the library sits in the App Group container, and the system
 * terminates a suspended app that still holds a lock on a file there. Sync,
 * detection and the backfills write on threads of their own that keep running
 * after the app leaves the foreground.
 *
 * Expected behaviour: going to the background on iOS asks the engine to stop
 * writing, inside a background task so the process stays alive while the
 * writes in flight end, and ends that task however the engine answers. The
 * daily backup a background starts is given its time first. Android does
 * nothing of the kind, since its database is not in a shared container.
 */
import { Platform } from 'react-native';

import { handleAppBackground } from '@/shared/app/appBackground';

const mockCalls: string[] = [];
const mockPrepare = jest.fn(async (_deadlineMs: number): Promise<boolean> => {
  mockCalls.push('prepare');
  return true;
});
const mockNative = {
  containerPath: jest.fn(() => '/group/'),
  beginBackgroundTask: jest.fn((_name: string): number | null => {
    mockCalls.push('begin');
    return 7;
  }),
  endBackgroundTask: jest.fn((_id: number) => {
    mockCalls.push('end');
  }),
  prepareEngineForSuspension: (deadlineMs: number) => mockPrepare(deadlineMs),
};
jest.mock('expo-modules-core', () => ({
  ...jest.requireActual('expo-modules-core'),
  requireOptionalNativeModule: jest.fn((name: string) =>
    name === 'VeloqAppGroup' ? mockNative : null
  ),
}));

let mockBackup: () => Promise<void> = async () => undefined;
jest.mock('@/features/settings/lib/autobackup', () => ({
  onAppBackground: () => mockBackup(),
}));
jest.mock('@/features/home/lib/widgetBridge', () => ({
  updateWidgetSnapshot: () => mockCalls.push('widget'),
}));
jest.mock('@/features/maps/lib/basemapFlush', () => ({
  flushBasemapSidecars: () => mockCalls.push('flush'),
}));

/** Let every pending promise callback run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

const originalOs = Platform.OS;

beforeEach(() => {
  mockCalls.length = 0;
  jest.clearAllMocks();
  mockBackup = async () => undefined;
  Platform.OS = 'ios';
});

afterEach(() => {
  Platform.OS = originalOs;
  jest.useRealTimers();
});

describe('going to the background on iOS', () => {
  it('stops the engine writing inside a background task, after the other background work', async () => {
    handleAppBackground();
    await settle();

    expect(mockCalls).toEqual(['flush', 'widget', 'begin', 'prepare', 'end']);
    expect(mockPrepare).toHaveBeenCalledWith(expect.any(Number));
    expect(mockNative.endBackgroundTask).toHaveBeenCalledWith(7);
  });

  it('waits for the backup the background started before stopping the engine', async () => {
    let finishBackup: () => void = () => undefined;
    mockBackup = () => new Promise<void>((resolve) => (finishBackup = resolve));

    handleAppBackground();
    await settle();
    expect(mockPrepare).not.toHaveBeenCalled();

    finishBackup();
    await settle();
    expect(mockCalls.slice(-3)).toEqual(['begin', 'prepare', 'end']);
  });

  it('stops the engine anyway once a backup outlasts its allowance', async () => {
    jest.useFakeTimers();
    mockBackup = () => new Promise<void>(() => undefined);

    handleAppBackground();
    await settle();
    expect(mockPrepare).not.toHaveBeenCalled();

    jest.advanceTimersByTime(60_000);
    await settle();
    expect(mockPrepare).toHaveBeenCalledTimes(1);
    expect(mockNative.endBackgroundTask).toHaveBeenCalledWith(7);
  });

  it('ends the background task when the engine call fails', async () => {
    mockPrepare.mockRejectedValueOnce(new Error('engine closed'));

    handleAppBackground();
    await settle();

    expect(mockNative.endBackgroundTask).toHaveBeenCalledWith(7);
  });

  it('still stops the engine when the system grants no background task', async () => {
    mockNative.beginBackgroundTask.mockReturnValueOnce(null);

    handleAppBackground();
    await settle();

    expect(mockPrepare).toHaveBeenCalledTimes(1);
    expect(mockNative.endBackgroundTask).not.toHaveBeenCalled();
  });
});

describe('going to the background on Android', () => {
  it('leaves the engine writing and asks for no background task', async () => {
    Platform.OS = 'android';

    handleAppBackground();
    await settle();

    expect(mockPrepare).not.toHaveBeenCalled();
    expect(mockNative.beginBackgroundTask).not.toHaveBeenCalled();
  });
});
