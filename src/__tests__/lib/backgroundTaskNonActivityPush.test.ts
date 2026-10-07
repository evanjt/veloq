import AsyncStorage from '@react-native-async-storage/async-storage';
import * as TaskManager from 'expo-task-manager';

import { presentActivityNotification } from '@/features/settings/lib/notificationService';
import { readInsightFingerprint } from '@/features/insights/lib/fingerprintStore';
import { diffInsights, initializeInsightsStore, useInsightsStore } from '@/features/insights/store';
import type { Insight } from '@/features/insights/types';
import { useAuthStore } from '@/shared/app/AuthStore';

const mockInsights: Insight[] = [
  {
    id: 'hrv_trend',
    category: 'hrv_trend',
    priority: 2,
    title: 'HRV changed',
    icon: 'star',
    iconTone: 'neutral',
    timestamp: 0,
    isNew: true,
  },
  {
    id: 'stale_pr-sec_1',
    category: 'stale_pr',
    priority: 3,
    title: 'Record is stale',
    icon: 'star',
    iconTone: 'neutral',
    timestamp: 0,
    isNew: true,
  },
];

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn(() => null) }));
jest.mock('expo-task-manager', () => ({
  ...jest.requireActual('expo-task-manager'),
  defineTask: jest.fn(),
}));
jest.mock('@/features/insights/lib/taskRunLog', () => ({
  appendTaskRun: jest.fn(async () => undefined),
}));
jest.mock('@/features/insights/lib/computeInsightsData', () => ({
  fetchInsightsDataFromEngine: jest.fn(() => ({ insightsData: {}, summaryCardData: null })),
  computeInsightsFromData: jest.fn(() => ({ insights: mockInsights, failed: false })),
}));
jest.mock('@/features/settings/lib/notificationService', () => ({
  presentActivityNotification: jest.fn(async () => undefined),
}));

type TaskBody = (arg: { data: unknown; error: unknown }) => Promise<void>;

describe('background task on a push with no activity', () => {
  let runTask: TaskBody;

  beforeAll(() => {
    require('@/features/insights/backgroundInsightTask');
    const defineTask = TaskManager.defineTask as jest.Mock;
    runTask = defineTask.mock.calls.find((call) => call[0] === 'veloq-background-insight')[1];
  });

  beforeEach(async () => {
    await AsyncStorage.clear();
    await AsyncStorage.setItem('veloq-notification-preferences', JSON.stringify({ enabled: true }));
    useAuthStore.setState({ athleteId: 'i1', isLoading: false });
    useInsightsStore.setState({ lastSeenFingerprint: '', isLoaded: false });
    jest.mocked(presentActivityNotification).mockClear();
  });

  async function deliver(eventType: string): Promise<void> {
    await runTask({
      data: { data: { event_type: eventType, athlete_id: 'i1' } },
      error: null,
    });
  }

  it.each(['WELLNESS_UPDATED', 'FITNESS_UPDATED', 'SPORT_SETTINGS_UPDATED'])(
    'posts nothing for %s and leaves the cards new for the next open',
    async (eventType) => {
      await deliver(eventType);
      await deliver(eventType);
      await initializeInsightsStore();

      expect(presentActivityNotification).not.toHaveBeenCalled();
      expect(await readInsightFingerprint()).toBe('');
      expect(diffInsights(mockInsights, useInsightsStore.getState().lastSeenFingerprint)).toEqual(
        new Set(['hrv_trend', 'stale_pr-sec_1'])
      );
    }
  );
});
