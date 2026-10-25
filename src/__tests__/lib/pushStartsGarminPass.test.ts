/**
 * Scenario: a push names an activity whose detail has landed.
 *
 * Expected behaviour: the engine is asked once, with that activity's id,
 * whether it came from Garmin and starts a pass if so; an engine that throws
 * does not end the task before the activity is readied.
 */

import * as SecureStore from 'expo-secure-store';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { awaitActivityBody } from '@/features/insights/lib/awaitActivityBody';

const mockPullGarminForActivity = jest.fn((_activityId: string) => true);
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
    sync: { pullGarminForActivity: (id: string) => mockPullGarminForActivity(id) },
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

describe('the push task starting a Garmin pass', () => {
  let runTask: TaskBody;

  beforeAll(() => {
    const defineTask = TaskManager.defineTask as jest.MockedFunction<typeof TaskManager.defineTask>;
    require('@/features/insights/backgroundInsightTask');
    runTask = defineTask.mock.calls.find((c) => c[0] === 'veloq-background-insight')![1] as never;
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.replaceProperty(Platform, 'OS', 'ios');
    (awaitActivityBody as jest.Mock).mockResolvedValue({ id: 'i77', name: 'Harbour loop' });
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

  const deliver = () =>
    runTask({
      data: {
        data: { event_type: 'ACTIVITY_UPLOADED', activity_id: 'i77', athlete_id: '12345' },
      },
      error: null,
    });

  it('asks the engine once with the pushed activity id', async () => {
    await deliver();

    expect(mockPullGarminForActivity).toHaveBeenCalledTimes(1);
    expect(mockPullGarminForActivity).toHaveBeenCalledWith('i77');
  });

  it('still readies the activity when the engine throws', async () => {
    mockPullGarminForActivity.mockImplementationOnce(() => {
      throw new Error('engine closed');
    });

    await deliver();

    expect(mockReadyActivityBodies).toHaveBeenCalledWith('i77');
  });

  it('asks nothing for an activity whose detail never landed', async () => {
    (awaitActivityBody as jest.Mock).mockResolvedValue(null);

    await deliver();

    expect(mockPullGarminForActivity).not.toHaveBeenCalled();
  });
});
