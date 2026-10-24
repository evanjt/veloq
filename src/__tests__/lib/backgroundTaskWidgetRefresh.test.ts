/**
 * Scenario: a silent push for a new activity wakes the headless task while the
 * athlete has notifications switched off.
 *
 * Expected behaviour: the activity is still ingested and the widgets are
 * redrawn from it. Notification preferences gate the tray entry only.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as TaskManager from 'expo-task-manager';

import { updateWidgetSnapshot } from '@/features/home';
import { awaitActivityBody } from '@/features/insights/lib/awaitActivityBody';
import { presentActivityNotification } from '@/features/settings/lib/notificationService';

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
}));
jest.mock('@/features/insights/lib/awaitActivityBody', () => ({
  awaitActivityBody: jest.fn(async () => null),
}));
jest.mock('@/features/settings/lib/notificationService', () => ({
  presentActivityNotification: jest.fn(async () => undefined),
}));
jest.mock('@/features/home', () => ({ updateWidgetSnapshot: jest.fn() }));
jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

type TaskBody = (arg: { data: unknown; error: unknown }) => Promise<void>;

const activityPush = {
  data: { data: { event_type: 'ACTIVITY_UPLOADED', activity_id: 'i1234', athlete_id: '12345' } },
  error: null,
};

describe('background insight task widget refresh', () => {
  let runTask: TaskBody;

  beforeAll(() => {
    require('@/features/insights/backgroundInsightTask');
    const defineTask = TaskManager.defineTask as jest.Mock;
    runTask = defineTask.mock.calls.find((c) => c[0] === 'veloq-background-insight')[1];
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    (SecureStore.getItemAsync as jest.Mock).mockImplementation(async (key: string) => {
      if (key === 'intervals_access_token') return 'token-abc';
      if (key === 'intervals_athlete_id') return '12345';
      return null;
    });
  });

  it('ingests and redraws the widgets with notifications switched off', async () => {
    await AsyncStorage.setItem(
      'veloq-notification-preferences',
      JSON.stringify({ enabled: false })
    );

    await runTask(activityPush);

    expect(awaitActivityBody).toHaveBeenCalled();
    expect(updateWidgetSnapshot).toHaveBeenCalled();
    expect(presentActivityNotification).not.toHaveBeenCalled();
  });

  it('ingests and redraws the widgets when no preference was ever saved', async () => {
    await runTask(activityPush);

    expect(awaitActivityBody).toHaveBeenCalled();
    expect(updateWidgetSnapshot).toHaveBeenCalled();
    expect(presentActivityNotification).not.toHaveBeenCalled();
  });
});
