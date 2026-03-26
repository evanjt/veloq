import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { router } from 'expo-router';

const CHANNEL_ID = 'veloq-insights';

/** Set up notification handlers and channels. Call once at app startup. */
export function initializeNotifications(): void {
  // Configure how notifications appear when app is in foreground
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });

  // Create Android notification channel
  if (Platform.OS === 'android') {
    Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Activity Insights',
      description:
        'Notifications about personal records, fitness milestones, and training insights',
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 250],
      lightColor: '#FC4C02',
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
