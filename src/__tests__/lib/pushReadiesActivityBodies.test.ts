/**
 * Scenario: an activity push wakes the background task after the platform's
 * own push handler stored the detail and the track. Where that handler leaves
 * the streams and intervals owed, nothing else fetches them before the tap,
 * so the activity opens offline with every chart waiting on the network.
 *
 * Expected behaviour: once the detail has landed, the task asks the engine to
 * ready the activity's remaining bodies, waits for the answer within a
 * deadline, and records the outcome in its run log.
 */

import * as SecureStore from 'expo-secure-store';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { awaitActivityBody } from '@/features/insights/lib/awaitActivityBody';
import { appendTaskRun } from '@/features/insights/lib/taskRunLog';

const mockReadyActivityBodies = jest.fn(async (_activityId: string) => true);

jest.mock('@/features/insights/lib/taskRunLog', () => ({
  appendTaskRun: jest.fn(async () => undefined),
}));
jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(() => ({
    setSyncCredentials: jest.fn(),
    clearSyncCredentials: jest.fn(),
  })),
}));
jest.mock('expo-task-manager', () => ({
  ...jest.requireActual('expo-task-manager'),
  defineTask: jest.fn(),
  isTaskRegisteredAsync: jest.fn(async () => false),
  unregisterTaskAsync: jest.fn(async () => undefined),
}));
jest.mock('@/features/insights/lib/awaitActivityBody', () => ({
  awaitActivityBody: jest.fn(async () => null),
}));
jest.mock('@/features/settings/lib/notificationService', () => ({
  presentActivityNotification: jest.fn(async () => undefined),
}));
jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides({
    engine: {
      ...require('../__shared__/veloqrsStub').fetchCalls,
      hasActivity: jest.fn(() => true),
      indexNewActivity: jest.fn(() => ({ matchedSections: 0, insertedPortions: 0 })),
      triggerRefresh: jest.fn(),
      activityNotification: jest.fn(() => null),
      readyActivityBodies: (activityId: string) => mockReadyActivityBodies(activityId),
    },
  })
);

type TaskBody = (arg: { data: unknown; error: unknown }) => Promise<void>;

const mockAwaitActivityBody = awaitActivityBody as jest.MockedFunction<typeof awaitActivityBody>;
const mockAppendTaskRun = appendTaskRun as jest.MockedFunction<typeof appendTaskRun>;

function readiedEntries() {
  return mockAppendTaskRun.mock.calls.map(([entry]) => entry).filter((e) => e.stage === 'readied');
}

describe('the push task readying the pushed activity', () => {
  let runTask: TaskBody;

  beforeAll(() => {
    const defineTask = TaskManager.defineTask as jest.MockedFunction<typeof TaskManager.defineTask>;
    require('@/features/insights/backgroundInsightTask');
    runTask = defineTask.mock.calls.find((c) => c[0] === 'veloq-background-insight')![1] as never;
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.replaceProperty(Platform, 'OS', 'ios');
    mockReadyActivityBodies.mockImplementation(async () => true);
    mockAwaitActivityBody.mockResolvedValue({
      id: 'i77',
      name: 'Harbour loop',
      sportType: 'Ride',
    } as never);
    (SecureStore.getItemAsync as jest.Mock).mockImplementation(async (key: string) => {
      if (key === 'intervals_access_token') return 'token-abc';
      if (key === 'intervals_athlete_id') return '12345';
      return null;
    });
    await AsyncStorage.setItem(
      'veloq-notification-preferences',
      JSON.stringify({ enabled: true, categories: { sectionPr: true, fitnessMilestone: true } })
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  function deliver(athleteId = '12345') {
    return runTask({
      data: {
        data: { event_type: 'ACTIVITY_UPLOADED', activity_id: 'i77', athlete_id: athleteId },
      },
      error: null,
    });
  }

  it('readies the activity once its detail has landed and logs that it is ready', async () => {
    await deliver();

    expect(mockReadyActivityBodies).toHaveBeenCalledTimes(1);
    expect(mockReadyActivityBodies).toHaveBeenCalledWith('i77');
    expect(readiedEntries()).toEqual([
      expect.objectContaining({ activityId: 'i77', detail: expect.stringMatching(/^ready/) }),
    ]);
  });

  it('logs the bodies still owed when the engine could not fetch them all', async () => {
    mockReadyActivityBodies.mockImplementation(async () => false);

    await deliver();

    expect(readiedEntries()).toEqual([
      expect.objectContaining({ activityId: 'i77', detail: expect.stringMatching(/^still owed/) }),
    ]);
  });

  it('readies on Android too, where the engine answers at once when nothing is owed', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');

    await deliver();

    expect(mockReadyActivityBodies).toHaveBeenCalledWith('i77');
  });

  it('does not ready an activity whose detail never landed', async () => {
    mockAwaitActivityBody.mockResolvedValue(null);

    await deliver();

    expect(mockReadyActivityBodies).not.toHaveBeenCalled();
    expect(readiedEntries()).toEqual([]);
  });

  it('does not ready an activity addressed to another athlete', async () => {
    await deliver('another-athlete');

    expect(mockReadyActivityBodies).not.toHaveBeenCalled();
  });

  it('ends the task at the deadline when the engine never answers', async () => {
    jest.useFakeTimers();
    mockReadyActivityBodies.mockImplementation(() => new Promise<boolean>(() => {}));

    const run = deliver();
    let settled = false;
    void run.finally(() => {
      settled = true;
    });
    for (let i = 0; i < 120 && !settled; i++) {
      await jest.advanceTimersByTimeAsync(500);
    }
    await run;

    expect(settled).toBe(true);
    expect(readiedEntries()).toEqual([
      expect.objectContaining({ activityId: 'i77', detail: expect.stringMatching(/^timed out/) }),
    ]);
  });

  it('logs a failure rather than ending the task when the engine throws', async () => {
    mockReadyActivityBodies.mockImplementation(async () => {
      throw new Error('engine closed');
    });

    await deliver();

    expect(readiedEntries()).toEqual([
      expect.objectContaining({ activityId: 'i77', detail: 'failed: engine closed' }),
    ]);
  });
});
