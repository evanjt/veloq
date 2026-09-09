/**
 * Scenario: a silent push wakes the background task on a cold start, so no
 * React tree has mounted and the auth store holds nothing.
 *
 * Expected behaviour: the task reads the credential from SecureStore and
 * fetches the activity, rather than bailing before it touches the engine.
 */

import * as SecureStore from 'expo-secure-store';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useAuthStore } from '@/shared/app/AuthStore';
import { awaitActivityBody } from '@/features/insights/lib/awaitActivityBody';

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
  awaitActivityBody: jest.fn(async () => null),
}));
jest.mock('@/features/settings/lib/notificationService', () => ({
  presentActivityNotification: jest.fn(async () => undefined),
  presentInsightNotification: jest.fn(async () => undefined),
}));
jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

const mockGetItemAsync = SecureStore.getItemAsync as jest.MockedFunction<
  typeof SecureStore.getItemAsync
>;
const mockAwaitActivityBody = awaitActivityBody as jest.MockedFunction<typeof awaitActivityBody>;

const ATHLETE_ID_STORAGE_KEY = 'intervals_athlete_id';
const ACCESS_TOKEN_STORAGE_KEY = 'intervals_access_token';

type TaskBody = (arg: { data: unknown; error: unknown }) => Promise<void>;

describe('background insight task, cold start', () => {
  let runTask: TaskBody;

  beforeAll(() => {
    const defineTask = TaskManager.defineTask as jest.MockedFunction<typeof TaskManager.defineTask>;
    require('@/features/insights/backgroundInsightTask');
    const call = defineTask.mock.calls.find((c) => c[0] === 'veloq-background-insight');
    runTask = call![1] as unknown as TaskBody;
  });

  beforeEach(async () => {
    jest.clearAllMocks();
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
      if (key === ACCESS_TOKEN_STORAGE_KEY) return 'token-abc';
      if (key === ATHLETE_ID_STORAGE_KEY) return '12345';
      return null;
    });
    await AsyncStorage.setItem('veloq-notification-preferences', JSON.stringify({ enabled: true }));
  });

  it('fetches the activity instead of bailing on an unhydrated credential', async () => {
    await runTask({
      data: { data: { event_type: 'ACTIVITY_UPLOADED', activity_id: 'i1234' } },
      error: null,
    });

    expect(useAuthStore.getState().athleteId).toBe('12345');
    expect(mockAwaitActivityBody).toHaveBeenCalled();
  });

  it('still bails when SecureStore holds no credential', async () => {
    mockGetItemAsync.mockResolvedValue(null);

    await runTask({
      data: { data: { event_type: 'ACTIVITY_UPLOADED', activity_id: 'i1234' } },
      error: null,
    });

    expect(mockAwaitActivityBody).not.toHaveBeenCalled();
  });
});
