/**
 * Scenario: a silent push arrives while a foreground sync is downloading. Both
 * start a fetch, and a result slot that is read without naming a run hands
 * whichever reader comes first the other's answer.
 *
 * Expected behaviour: the push task reads back only the run it started, so a
 * result that belongs to another run never counts as its own ingest.
 */

import * as SecureStore from 'expo-secure-store';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { awaitActivityBody } from '@/features/insights/lib/awaitActivityBody';

const OWN_RUN = 7;
const FOREIGN_RUN = 99;

const mockIndexNewActivity = jest.fn(() => ({ matchedSections: 0, insertedPortions: 0 }));

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
  awaitActivityBody: jest.fn(async () => ({ id: 'i1', name: 'A ride', type: 'Ride' })),
}));
jest.mock('@/features/settings/lib/notificationService', () => ({
  presentActivityNotification: jest.fn(async () => undefined),
}));
jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides({
    engine: {
      ...require('../__shared__/veloqrsStub').fetchCalls,
      hasActivity: jest.fn(() => false),
      getActivityIds: jest.fn(() => []),
      indexNewActivity: mockIndexNewActivity,
      triggerRefresh: jest.fn(),
    },
  })
);

type TaskBody = (arg: { data: unknown; error: unknown }) => Promise<void>;

describe('the push task reading its download result', () => {
  let runTask: TaskBody;
  const { startFetchAndStore, takeFetchAndStoreResult } = require('veloqrs');

  beforeAll(() => {
    const defineTask = TaskManager.defineTask as jest.MockedFunction<typeof TaskManager.defineTask>;
    require('@/features/insights/backgroundInsightTask');
    runTask = defineTask.mock.calls.find((c) => c[0] === 'veloq-background-insight')![1] as never;
  });

  beforeEach(async () => {
    jest.useFakeTimers();
    mockIndexNewActivity.mockClear();
    (awaitActivityBody as jest.Mock).mockResolvedValue({ id: 'i1', name: 'A ride', type: 'Ride' });
    startFetchAndStore.mockReset().mockReturnValue(OWN_RUN);
    takeFetchAndStoreResult.mockReset();
    (SecureStore.getItemAsync as jest.Mock).mockImplementation(async (key: string) => {
      if (key === 'intervals_access_token') return 'token-abc';
      if (key === 'intervals_athlete_id') return '12345';
      return null;
    });
    await AsyncStorage.setItem('veloq-notification-preferences', JSON.stringify({ enabled: true }));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  let pushCount = 0;

  async function deliverPush() {
    const activityId = `i${++pushCount}`;
    const run = runTask({
      data: {
        data: { event_type: 'ACTIVITY_UPLOADED', activity_id: activityId, athlete_id: '12345' },
      },
      error: null,
    });
    let settled = false;
    run.finally(() => {
      settled = true;
    });
    for (let i = 0; i < 100 && !settled; i++) {
      await jest.advanceTimersByTimeAsync(500);
    }
    await run;
  }

  const result = { successCount: 1, totalPoints: 10 };

  it('takes the result of the run it started and indexes the activity', async () => {
    takeFetchAndStoreResult.mockImplementation((run?: number) => (run === OWN_RUN ? result : null));

    await deliverPush();

    expect(takeFetchAndStoreResult).toHaveBeenCalledWith(OWN_RUN);
    expect(mockIndexNewActivity).toHaveBeenCalledWith(expect.stringMatching(/^i\d+$/));
  });

  it('does not count a result that belongs to another run', async () => {
    takeFetchAndStoreResult.mockImplementation((run?: number) =>
      run === FOREIGN_RUN ? result : null
    );

    await deliverPush();

    expect(mockIndexNewActivity).not.toHaveBeenCalled();
  });

  it('waits for its own run rather than stopping when the download is no longer active', async () => {
    let calls = 0;
    takeFetchAndStoreResult.mockImplementation((run?: number) =>
      run === OWN_RUN && ++calls >= 3 ? result : null
    );

    await deliverPush();

    expect(calls).toBe(3);
    expect(mockIndexNewActivity).toHaveBeenCalledWith(expect.stringMatching(/^i\d+$/));
  });
});
