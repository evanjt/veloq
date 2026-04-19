import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { router } from 'expo-router';
import { brand } from '@/theme';

const CHANNEL_ID = 'veloq-insights';
const SYNC_CHANNEL_ID = 'veloq-sync';
const SYNC_NOTIFICATION_ID = 'sync-progress';

/** Set up notification handlers and channels. Call once at app startup. */
export function initializeNotifications(): void {
  // Configure how notifications appear when app is in foreground
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      // Sync progress: notification center only, no popup banner.
      // Android LOW-importance channel prevents heads-up display; iOS
      // shouldShowBanner=false suppresses the drop-down.
      if (notification.request.identifier === SYNC_NOTIFICATION_ID) {
        return {
          shouldShowBanner: false,
          shouldShowList: true,
          shouldPlaySound: false,
          shouldSetBadge: false,
        };
      }
      return {
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      };
    },
  });

  // Create Android notification channels
  if (Platform.OS === 'android') {
    Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Activity Insights',
      description:
        'Notifications about personal records, fitness milestones, and training insights',
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 250],
      lightColor: brand.orange,
    });
    Notifications.setNotificationChannelAsync(SYNC_CHANNEL_ID, {
      name: 'Sync Progress',
      description: 'Background data sync progress',
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [],
      sound: null,
    });
  }
}

/** Request notification permissions from the OS. Returns true if granted. */
export async function requestNotificationPermission(): Promise<boolean> {
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;

  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

/** Check if notification permissions are currently granted. */
export async function hasNotificationPermission(): Promise<boolean> {
  const { status } = await Notifications.getPermissionsAsync();
  return status === 'granted';
}

export interface InsightNotificationData {
  /** Route to navigate to when notification is tapped */
  route: string;
  /** Optional insight ID for highlighting */
  insightId?: string;
  /** Optional activity ID for deep linking */
  activityId?: string;
  /** Optional section ID for deep linking */
  sectionId?: string;
  [key: string]: unknown;
}

/** Present a local notification with insight content. */
export async function presentInsightNotification(
  title: string,
  body: string,
  data?: InsightNotificationData
): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      data: data ?? {},
      ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
    },
    trigger: null, // immediate
  });
}

/** Post or update the sync progress notification. Reuses the same identifier for silent in-place updates. */
export async function updateSyncNotification(body: string): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      identifier: SYNC_NOTIFICATION_ID,
      content: {
        title: 'Veloq',
        body,
        sticky: true, // Android: can't swipe away during sync
        ...(Platform.OS === 'android' ? { channelId: SYNC_CHANNEL_ID } : {}),
      },
      trigger: null,
    });
  } catch (e) {
    if (__DEV__) console.warn('[SyncNotification] Failed to update:', e);
  }
}

/** Dismiss the sync progress notification silently. */
export async function dismissSyncNotification(): Promise<void> {
  try {
    await Notifications.dismissNotificationAsync(SYNC_NOTIFICATION_ID);
  } catch (e) {
    if (__DEV__) console.warn('[SyncNotification] Failed to dismiss:', e);
  }
}

/**
 * Set up the foreground notification listener.
 * Fires whenever a notification is delivered while the app is in the foreground
 * (the actual presentation is handled by setNotificationHandler). Currently
 * used for diagnostic logging only — the deep-link flow runs from the tap
 * handler below, and the background silent-push pipeline runs from the
 * TaskManager task in backgroundInsightTask.ts.
 */
export function setupNotificationReceivedHandler(): Notifications.Subscription {
  return Notifications.addNotificationReceivedListener((notification) => {
    if (__DEV__) {
      const id = notification.request.identifier;
      const data = notification.request.content.data;
      console.log(`[Notification] Received (foreground) id=${id}`, data);
    }
  });
}

/** Set up the notification response handler for deep linking. Call once at app startup. */
export function setupNotificationResponseHandler(): Notifications.Subscription {
  return Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data as InsightNotificationData | undefined;
    console.log('[Notification] Tap data:', JSON.stringify(data));
    if (!data) return;

    // Deep link to the relevant screen
    if (data.activityId) {
      console.log('[Notification] Navigating to activity:', data.activityId);
      router.push(`/activity/${data.activityId}` as never);
    } else if (data.sectionId) {
      router.push(`/section/${data.sectionId}` as never);
    } else if (data.route) {
      console.log('[Notification] Navigating to route:', data.route);
      router.push(data.route as never);
    }
  });
}
