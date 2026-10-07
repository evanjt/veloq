import AsyncStorage from '@react-native-async-storage/async-storage';
import * as TaskManager from 'expo-task-manager';

import { presentActivityNotification } from '@/features/settings/lib/notificationService';
import { useAuthStore } from '@/shared/app/AuthStore';
import { getEngine } from '@/shared/native/engine';

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn(() => null) }));
jest.mock('expo-task-manager', () => ({
  ...jest.requireActual('expo-task-manager'),
  defineTask: jest.fn(),
}));
jest.mock('@/features/insights/lib/taskRunLog', () => ({
  appendTaskRun: jest.fn(async () => undefined),
}));
jest.mock('@/features/settings/lib/notificationService', () => ({
  presentActivityNotification: jest.fn(async () => undefined),
}));

type TaskBody = (arg: { data: unknown; error: unknown }) => Promise<void>;

const KEY = 'veloq-notification-preferences';

describe('background task notification preferences', () => {
  let runTask: TaskBody;

  beforeAll(() => {
    require('@/features/insights/backgroundInsightTask');
    const defineTask = TaskManager.defineTask as jest.Mock;
    runTask = defineTask.mock.calls.find((call) => call[0] === 'veloq-background-insight')[1];
  });

  beforeEach(async () => {
    await AsyncStorage.clear();
    useAuthStore.setState({ athleteId: 'i1', isLoading: false });
    jest.mocked(presentActivityNotification).mockClear();
  });

  it('honours the engine copy when the AsyncStorage mirror is stale', async () => {
    await AsyncStorage.setItem(KEY, JSON.stringify({ enabled: true }));
    jest.mocked(getEngine).mockReturnValue({
      getSetting: (key: string) => (key === KEY ? JSON.stringify({ enabled: false }) : undefined),
    } as never);

    await runTask({
      data: { data: { event_type: 'WELLNESS_UPDATED', athlete_id: 'i1' } },
      error: null,
    });

    expect(presentActivityNotification).not.toHaveBeenCalled();
    const { appendTaskRun } = require('@/features/insights/lib/taskRunLog');
    const details = (appendTaskRun as jest.Mock).mock.calls.map((c) => JSON.stringify(c[0]));
    expect(details.join()).toMatch(/disabled/i);
  });
});
