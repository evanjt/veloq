/**
 * Scenario: an activity push wakes the task in a process that never ran the
 * launch path, so i18next holds no bundle. The athlete's saved language is
 * German.
 *
 * Expected behaviour: the task initialises i18next in the saved language before
 * it hands the notification templates to the engine, so the templates are
 * German text and no template is a key path.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

const mockSetNotificationTemplates = jest.fn();

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(() => ({
    setNotificationTemplates: (...args: unknown[]) => mockSetNotificationTemplates(...args),
    setSyncCredentials: jest.fn(),
    clearSyncCredentials: jest.fn(),
  })),
}));
jest.mock('expo-task-manager', () => ({
  ...jest.requireActual('expo-task-manager'),
  defineTask: jest.fn(),
}));
jest.mock('@/features/insights/lib/taskRunLog', () => ({
  appendTaskRun: jest.fn(async () => undefined),
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
      hasActivity: jest.fn(() => false),
      triggerRefresh: jest.fn(),
      activityNotification: jest.fn(() => null),
      readyActivityBodies: jest.fn(async () => true),
    },
  })
);

type TaskBody = (arg: { data: unknown; error: unknown }) => Promise<void>;

describe('the push task on a cold start', () => {
  it('hands the engine templates in the saved language', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    (SecureStore.getItemAsync as jest.Mock).mockImplementation(async (key: string) => {
      if (key === 'intervals_access_token') return 'token-abc';
      if (key === 'intervals_athlete_id') return '12345';
      return null;
    });
    await AsyncStorage.setItem('veloq-language-preference', 'de-DE');
    await AsyncStorage.setItem(
      'veloq-notification-preferences',
      JSON.stringify({ enabled: true, categories: { sectionPr: true, fitnessMilestone: true } })
    );

    let runTask!: TaskBody;
    jest.isolateModules(() => {
      require('@/features/insights/backgroundInsightTask');
      const defineTask = TaskManager.defineTask as jest.Mock;
      runTask = defineTask.mock.calls.find((c) => c[0] === 'veloq-background-insight')![1];
    });

    await runTask({
      data: {
        data: { event_type: 'ACTIVITY_UPLOADED', activity_id: 'i77', athlete_id: '12345' },
      },
      error: null,
    });

    expect(mockSetNotificationTemplates).toHaveBeenCalledTimes(1);
    const [locale, templates] = mockSetNotificationTemplates.mock.calls[0] as [
      string,
      { key: string; value: string }[],
    ];
    expect(locale).toBe('de-DE');
    expect(
      templates.find((t) => t.key === 'notifications.activityBody.sectionPrCount')?.value
    ).toBe('PR auf {{count}} Abschnitten');
    expect(templates.filter((t) => t.value === t.key)).toEqual([]);
  });
});
