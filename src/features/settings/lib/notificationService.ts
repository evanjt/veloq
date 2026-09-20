import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { router } from 'expo-router';
import { brand } from '@/theme';
import { debug } from '@/shared/debug/debug';
import { tapTargetFromPushData } from '@/features/insights/lib/pushPayload';

const log = debug.create('Notification');
const CHANNEL_ID = 'veloq-insights';

/**
 * expo-notifications reads the Android channel from the trigger and nowhere
 * else. A `channelId` in `content` is dropped, and a null trigger falls back to
 * expo's own channel, whose importance is hardcoded HIGH, so a notification
 * that means to be quiet has to name its channel here. iOS has no channels, so
 * the trigger stays null and the notification is still immediate.
 */
const immediatelyOn = (channelId: string) => (Platform.OS === 'android' ? { channelId } : null);

/** Set up notification handlers and channels. Call once at app startup. */
export function initializeNotifications(): void {
  // Configure how notifications appear when app is in foreground
  Notifications.setNotificationHandler({
    handleNotification: async () => {
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
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250],
      lightColor: brand.tealLight,
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
      priority: 'high',
    },
    trigger: immediatelyOn(CHANNEL_ID),
  });
}

/**
 * Schedule (or replace) a per-activity notification using a stable identifier.
 * Repeated calls with the same activityId update the existing tray entry in
 * place rather than stacking duplicates - used by the background task to fire
 * a placeholder immediately and then enrich it once GPS + insights are ready.
 *
 * `attachmentUri` is a local file shown beside the text. Only iOS presents one
 * for a locally scheduled notification: Android resolves the image to the
 * static large icon in the manifest, so the key is left off there entirely.
 */
export async function presentActivityNotification(
  activityId: string,
  title: string,
  body: string,
  data?: InsightNotificationData,
  attachmentUri?: string | null
): Promise<void> {
  const attachable = Platform.OS === 'ios' && !!attachmentUri;
  await Notifications.scheduleNotificationAsync({
    identifier: `activity-${activityId}`,
    content: {
      title,
      body,
      data: data ?? {},
      priority: 'high',
      ...(attachable
        ? {
            attachments: [
              {
                identifier: `activity-${activityId}-route`,
                url: attachmentUri as string,
                type: 'public.png',
              },
            ],
          }
        : {}),
    },
    trigger: immediatelyOn(CHANNEL_ID),
  });
}

/**
 * Set up the foreground notification listener.
 * Fires whenever a notification is delivered while the app is in the foreground
 * (the actual presentation is handled by setNotificationHandler). Currently
 * used for diagnostic logging only - the deep-link flow runs from the tap
 * handler below, and the background silent-push pipeline runs from the
 * TaskManager task in backgroundInsightTask.ts.
 */
export function setupNotificationReceivedHandler(): Notifications.Subscription {
  return Notifications.addNotificationReceivedListener((notification) => {
    if (__DEV__) {
      const id = notification.request.identifier;
      const data = notification.request.content.data;
      log.log(`[Notification] Received (foreground) id=${id}`, data);
    }
  });
}

// A single tap can surface through both `getLastNotificationResponseAsync`
// (cold-start path) and `addNotificationResponseReceivedListener` (live path).
// Track identifiers we've already routed for to avoid double-navigation.
const handledResponseIds = new Set<string>();

/**
 * Route based on notification data, whether the tap happened while the app was
 * running or launched it cold.
 *
 * The payload is unwrapped by `tapTargetFromPushData`, which is the same
 * normalisation the background task uses. Reading `data.activityId` directly
 * was the bug: iOS wraps the object as a JSON string and Android FCM data
 * messages arrive under `body`, so the direct read was `undefined` and the tap
 * went nowhere.
 *
 * Exported so the four shapes can be tested against it.
 */
export function routeFromNotificationData(data: unknown, coldStart = false): void {
  const target = tapTargetFromPushData(data);
  if (!target) return;
  log.log('Notification tap routing to:', target.path);
  if (target.mode === 'navigate') {
    router.navigate(target.path as never);
    return;
  }
  // A cold start has nothing under the pushed screen, so back leaves the app
  // rather than landing on the feed. Seating the tab group first is the same
  // reset `AuthGate` does for its own stack. A warm tap already has a stack.
  if (coldStart) router.replace('/(tabs)' as never);
  router.push(target.path as never);
}

/** Clears the tap dedupe set. Tests only, so one case cannot leak into the next. */
export function __resetHandledResponseIds(): void {
  handledResponseIds.clear();
}

/** Set up the notification response handler for deep linking. Call once at app startup. */
export function setupNotificationResponseHandler(): Notifications.Subscription {
  return Notifications.addNotificationResponseReceivedListener((response) => {
    const id = response.notification.request.identifier;
    if (handledResponseIds.has(id)) {
      log.log('Tap already handled via cold-start path:', id);
      return;
    }
    handledResponseIds.add(id);
    const data = response.notification.request.content.data;
    log.log('Tap data:', JSON.stringify(data));
    routeFromNotificationData(data);
  });
}

/**
 * Handle the notification that launched the app (cold-start tap).
 * `addNotificationResponseReceivedListener` registers too late to catch this -
 * on Android, FCM posts the tap intent before JS has booted, so we have to
 * explicitly ask expo-notifications what the launching notification was.
 * Returns a promise that resolves once routing has been attempted.
 */
export async function handleInitialNotificationResponse(): Promise<void> {
  try {
    const response = await Notifications.getLastNotificationResponseAsync();
    if (!response) return;
    const id = response.notification.request.identifier;
    if (handledResponseIds.has(id)) return;
    handledResponseIds.add(id);
    const data = response.notification.request.content.data;
    log.log('Cold-start tap data:', JSON.stringify(data));
    routeFromNotificationData(data, true);
  } catch (e) {
    log.warn('Could not read initial response:', e);
  }
}
