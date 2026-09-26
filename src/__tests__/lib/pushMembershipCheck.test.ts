/**
 * Scenario: a silent push arrives for an activity the library may already
 * hold. The task asks the engine, and the engine keeps the answer in memory.
 *
 * Expected behaviour: it asks one question and gets a boolean back. Lifting
 * the whole id list to run `includes` crosses a JSI host call per string, and
 * a 500-activity library pays all 500 to decide one thing.
 */

import * as SecureStore from 'expo-secure-store';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useAuthStore } from '@/shared/app/AuthStore';
import { awaitActivityBody } from '@/features/insights/lib/awaitActivityBody';

const mockHasActivity = jest.fn(() => true);
const mockGetActivityIds = jest.fn(() => ['i1234']);
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
  defineTask: jest.fn(),
  isTaskRegisteredAsync: jest.fn(async () => false),
  unregisterTaskAsync: jest.fn(async () => undefined),
}));
jest.mock('@/features/insights/lib/awaitActivityBody', () => ({
  awaitActivityBody: jest.fn(async () => ({ id: 'i1234', name: 'A ride', type: 'Ride' })),
}));
jest.mock('@/features/settings/lib/notificationService', () => ({
  presentActivityNotification: jest.fn(async () => undefined),
  presentInsightNotification: jest.fn(async () => undefined),
}));
jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides({
    engine: {
      hasActivity: mockHasActivity,
      getActivityIds: mockGetActivityIds,
      indexNewActivity: mockIndexNewActivity,
    },
  })
);

const mockGetItemAsync = SecureStore.getItemAsync as jest.MockedFunction<
  typeof SecureStore.getItemAsync
>;
const mockAwaitActivityBody = awaitActivityBody as jest.MockedFunction<typeof awaitActivityBody>;

type TaskBody = (arg: { data: unknown; error: unknown }) => Promise<void>;

describe('the push task asking whether an activity is already held', () => {
  let runTask: TaskBody;

  beforeAll(() => {
    const defineTask = TaskManager.defineTask as jest.MockedFunction<typeof TaskManager.defineTask>;
    require('@/features/insights/backgroundInsightTask');
    const call = defineTask.mock.calls.find((c) => c[0] === 'veloq-background-insight');
    runTask = call![1] as unknown as TaskBody;
  });

  beforeEach(async () => {
    mockHasActivity.mockClear();
    mockGetActivityIds.mockClear();
    mockIndexNewActivity.mockClear();
    mockAwaitActivityBody.mockResolvedValue({
      id: 'i1234',
      name: 'A ride',
      type: 'Ride',
    } as never);
    useAuthStore.setState({
      apiKey: null,
      accessToken: null,
      athleteId: null,
      athlete: null,
      isLoading: true,
      isAuthenticated: false,
      isDemoMode: false,
      hideDemoBanner: false,
      authMethod: null,
      sessionExpired: null,
    });
    mockGetItemAsync.mockImplementation(async (key) => {
      if (key === 'intervals_access_token') return 'token-abc';
      if (key === 'intervals_athlete_id') return '12345';
      return null;
    });
    await AsyncStorage.setItem('veloq-notification-preferences', JSON.stringify({ enabled: true }));
  });

  async function deliverPush() {
    await runTask({
      data: { data: { event_type: 'ACTIVITY_UPLOADED', activity_id: 'i1234' } },
      error: null,
    });
  }

  it('asks once and takes a boolean', async () => {
    await deliverPush();

    expect(mockHasActivity).toHaveBeenCalledWith('i1234');
    expect(mockHasActivity).toHaveBeenCalledTimes(1);
  });

  it('never lifts the id list to decide it', async () => {
    await deliverPush();

    expect(mockGetActivityIds).not.toHaveBeenCalled();
  });

  it('skips the download when the engine already holds it', async () => {
    mockHasActivity.mockReturnValue(true);

    await deliverPush();

    expect(mockIndexNewActivity).toHaveBeenCalledWith('i1234');
  });

  it('goes on to download when the engine does not', async () => {
    mockHasActivity.mockReturnValue(false);

    await deliverPush();

    expect(mockIndexNewActivity).not.toHaveBeenCalled();
  });
});
