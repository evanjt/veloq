import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { router } from 'expo-router';
import { brand } from '@/theme';
import { debug } from '@/shared/debug/debug';
import {
  isForSignedInAthlete,
  pushDataAthleteId,
  tapTargetFromPushData,
} from '@/features/insights';
import { ensureCredentialsHydrated, getStoredCredentials } from '@/shared/app/AuthStore';
import { i18n } from '@/i18n';

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

  if (Platform.OS === 'android') {
    nameInsightsChannel();
    i18n.off('languageChanged', nameInsightsChannel);
    i18n.on('languageChanged', nameInsightsChannel);
  }
}

const CHANNEL_NAME_KEY = 'notifications.channel.insightsName';
const CHANNEL_DESCRIPTION_KEY = 'notifications.channel.insightsDescription';

/**
 * Create the insights channel, named in the app's language. Android lists the
 * name in the system's notification settings, and creating a channel again
 * renames it without touching what the athlete set, so this runs again when
 * the language changes.
 *
 * A name that resolves as its key means the bundles are not loaded yet, which
 * is the case on mount, so nothing is created until they are. Nothing posts on
 * the channel before then: insights wait for the launch, and a push that beats
 * it is posted natively, which creates the channel under the generated strings.
 */
function nameInsightsChannel(): void {
  const name = i18n.t(CHANNEL_NAME_KEY);
  if (!name || name === CHANNEL_NAME_KEY) return;
  Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name,
    description: i18n.t(CHANNEL_DESCRIPTION_KEY),
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250],
    lightColor: brand.tealLight,
  }).catch((e: unknown) => log.warn('could not create the insights channel', e));
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
  insightId?: string | undefined;
  /** Optional activity ID for deep linking */
  activityId?: string | undefined;
  /** Optional section ID for deep linking */
  sectionId?: string | undefined;
  [key: string]: unknown;
}

/**
 * The entry's data with the athlete signed in now, which is who it is about.
 * A tap reads it back, so an entry that outlives a wipe opens nothing in the
 * next athlete's library.
 */
function forSignedInAthlete(data?: InsightNotificationData): Record<string, unknown> {
  return { ...data, athleteId: getStoredCredentials().athleteId };
}

/**
 * Schedule (or replace) a per-activity notification using a stable identifier.
 * Repeated calls with the same activityId update the existing tray entry in
 * place rather than stacking duplicates - used by the background task to fire
 * a placeholder immediately and then enrich it once GPS + insights are ready.
 */
export async function presentActivityNotification(
  activityId: string,
  title: string,
  body: string,
  data?: InsightNotificationData
): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    identifier: `activity-${activityId}`,
    content: {
      title,
      body,
      data: forSignedInAthlete(data),
      priority: 'high',
    },
    trigger: immediatelyOn(CHANNEL_ID),
  });
}

/**
 * Take every entry out of the tray and every one out of the schedule, the
 * server's pushes and the app's own alike.
 *
 * Best-effort, so a wipe that cannot reach the tray still empties the library.
 * An entry that survives opens nothing, because a tap routes only for the
 * athlete signed in now.
 */
export async function dismissAllNotifications(): Promise<void> {
  await Promise.all([
    Notifications.dismissAllNotificationsAsync().catch((error: unknown) => {
      log.warn('Could not clear the tray:', error);
    }),
    Notifications.cancelAllScheduledNotificationsAsync().catch((error: unknown) => {
      log.warn('Could not clear the schedule:', error);
    }),
  ]);
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
 * A tap routes only when the entry names the athlete signed in now. The tray
 * can outlive the library it came from, when a wipe's dismissal fails or a
 * push arrives before the previous athlete's token is unregistered, and an
 * entry that names nobody predates the stamp. Either opens the app where it
 * is rather than another athlete's activity in this library.
 *
 * Exported so the four shapes can be tested against it.
 */
export function routeFromNotificationData(data: unknown, coldStart = false): void {
  const target = tapTargetFromPushData(data);
  if (!target) return;
  const signedIn = getStoredCredentials().athleteId;
  if (!isForSignedInAthlete(pushDataAthleteId(data), signedIn)) {
    log.log('Tap is not for the athlete signed in, opening the app where it is');
    return;
  }
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
    // The athlete check reads the credential, which a tap can beat to memory.
    void ensureCredentialsHydrated().then(() => routeFromNotificationData(data));
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
    await ensureCredentialsHydrated();
    routeFromNotificationData(data, true);
  } catch (e) {
    log.warn('Could not read initial response:', e);
  }
}
