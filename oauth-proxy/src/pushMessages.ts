/**
 * The Expo push messages one device gets for one event.
 *
 * Two, and they are not interchangeable. On Android, Expo maps title and body
 * to an FCM `notification` block the OS draws without invoking the app, and a
 * data-only message to an FCM `data` block that wakes the background task.
 * They are mutually exclusive per message, so a tray entry when the app is
 * stopped and a wake when it is warm needs one of each. A stopped package
 * never receives the silent one, which is the case the visible one is for.
 *
 * Kept apart from `worker.ts` because what goes in these two objects is a set
 * of decisions, one of them load-bearing enough that a missing field makes an
 * entire platform path unreachable with nothing to say why.
 */

export interface VisibleContent {
  title: string;
  body: string;
}

export function buildPushMessages(
  token: string,
  data: Record<string, unknown>,
  visible: VisibleContent | null,
  platform?: string
): Record<string, unknown>[] {
  const channelId = "veloq-insights";
  const activityId = typeof data.activity_id === "string" ? data.activity_id : null;
  const messages: Record<string, unknown>[] = [];

  if (visible) {
    // The deep-link data rides on the visible push too. Expo forwards it as FCM
    // notification extras, which the device reads out of
    // `response.notification.request.content.data` on a tap. Without it a tap
    // opens MainActivity with no context and the athlete lands on Home.
    const tapData = activityId ? { activityId, route: `/activity/${activityId}`, ...data } : data;

    messages.push({
      to: token,
      title: visible.title,
      body: visible.body,
      data: tapData,
      priority: "high",
      channelId,
      // APNs never invokes a Notification Service Extension without
      // `mutable-content: 1`, and that extension is the only thing iOS wakes
      // deterministically for a visible push, a force-quit included. Without
      // this field every native iOS enrichment path is unreachable and tests as
      // "the extension never ran", with nothing naming the cause. Android
      // ignores it.
      mutableContent: true,
    });
  }

  // Silent data-only push: no title, body, channelId or sound, or Expo emits an
  // FCM notification message and the OS draws a blank tray entry instead of the
  // task being woken. iOS wants apns-priority 5 for a content-available push;
  // "high" risks throttling or a silent drop. Android keeps high priority so
  // aggressive OEMs deliver it promptly.
  messages.push({
    to: token,
    data,
    priority: platform === "ios" ? "normal" : "high",
    _contentAvailable: true,
  });

  return messages;
}
