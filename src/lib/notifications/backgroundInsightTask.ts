import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { debug } from '@/lib';
import {
  computeInsightsFromData,
  fetchInsightsDataFromEngine,
} from '@/hooks/insights/computeInsightsData';
import type { WellnessInput } from '@/hooks/insights/computeInsightsData';
import { formatInsightNotification, pickBestInsightForNotification } from './insightNotification';
import { presentInsightNotification } from './notificationService';
import { computeInsightFingerprint } from '@/providers/InsightsStore';

const log = debug.create('BackgroundInsight');

export const BACKGROUND_INSIGHT_TASK = 'veloq-background-insight';

const FINGERPRINT_KEY = 'veloq-insights-fingerprint';

/**
 * Background task that generates insights and presents a local notification.
 *
 * Called when a silent push arrives from auth.veloq.fit (webhook relay).
 * Runs outside React — no hooks, no providers, no context.
 *
 * Flow:
 *   1. Check notification preferences (must be opted in)
 *   2. Fetch fresh wellness data from intervals.icu API
 *   3. Get insight data from Rust engine (already has activity in SQLite)
 *   4. Generate insights via shared computeInsightsFromData()
 *   5. Compare fingerprint to detect new insights
 *   6. Present local notification with best new insight
 */
TaskManager.defineTask(BACKGROUND_INSIGHT_TASK, async ({ data, error }) => {
  if (error) {
    log.error('Background insight error:', error.message);
    return;
  }

  try {
    // 1. Check if notifications are enabled
    const { getNotificationPreferences } = require('@/providers/NotificationPreferencesStore');
    const prefs = getNotificationPreferences();
    if (!prefs.enabled) {
      log.log('Notifications disabled, skipping');
      return;
    }

    // 2. Get i18n translation function (standalone, no React)
    const { i18n } = require('@/i18n');
    const t = i18n.t.bind(i18n) as (
      key: string,
      params?: Record<string, string | number>
    ) => string;

    // 3. Fetch fresh wellness data from intervals.icu API
    let wellnessData: WellnessInput[] | null = null;
    try {
      const { intervalsApi } = require('@/api');
      const wellness = await intervalsApi.getWellness();
      wellnessData = wellness as WellnessInput[];
    } catch (e) {
      log.warn('Could not fetch wellness data:', e);
      // Continue without wellness — insights will lack CTL/ATL/TSB but PRs still work
    }

    // 4. Get insight data from engine
    const ffiData = fetchInsightsDataFromEngine();
    if (!ffiData) {
      log.log('Engine not ready, skipping insight generation');
      return;
    }

    // 5. Generate insights
    const insights = computeInsightsFromData(ffiData, wellnessData, t);
    if (insights.length === 0) {
      log.log('No insights generated');
      return;
    }

    // 6. Compare fingerprint to detect new insights
    const currentFingerprint = computeInsightFingerprint(insights);
    const storedFingerprint = await AsyncStorage.getItem(FINGERPRINT_KEY);

    if (currentFingerprint === storedFingerprint) {
      log.log('No new insights (fingerprint unchanged)');
      return;
    }

    // 7. Find the best insight to notify about
    // Only notify about insights that are actually new
    const previousIds = new Set((storedFingerprint ?? '').split('|'));
    const newInsights = insights.filter((i) => !previousIds.has(i.id));
    const bestInsight = pickBestInsightForNotification(newInsights);

    if (!bestInsight) {
      log.log('No notification-worthy insights');
      // Still update fingerprint so we don't re-check
      await AsyncStorage.setItem(FINGERPRINT_KEY, currentFingerprint);
      return;
    }

    // 8. Check category preference
    const categoryMap: Record<string, keyof typeof prefs.categories> = {
      section_pr: 'sectionPr',
      fitness_milestone: 'fitnessMilestone',
      period_comparison: 'periodComparison',
      activity_pattern: 'activityPattern',
    };
    const categoryKey = categoryMap[bestInsight.category];
    if (categoryKey && !prefs.categories[categoryKey]) {
      log.log(`Category ${bestInsight.category} disabled, skipping notification`);
      await AsyncStorage.setItem(FINGERPRINT_KEY, currentFingerprint);
      return;
    }

    // 9. Present local notification
    const content = formatInsightNotification(bestInsight, t);
    await presentInsightNotification(content.title, content.body, content.data);
    log.log(`Notification sent: ${content.title} — ${content.body}`);

    // 10. Update stored fingerprint
    await AsyncStorage.setItem(FINGERPRINT_KEY, currentFingerprint);
  } catch (e) {
    log.error('Background insight task failed:', e);
  }
});
