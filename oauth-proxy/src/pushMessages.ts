/**
 * The Expo push messages one device gets for one event.
 *
 * Two on iOS, one on Android, and they are not interchangeable. Expo maps title
 * and body to a `notification` block the OS draws without invoking the app, and
 * a data-only message to a `data` block that wakes the handler. They are
 * mutually exclusive per message, so carrying both needs one of each.
 *
 * Android gets the silent one alone. The FCM SDK draws the visible push under a
 * tag of its own and the native worker posts its enriched entry under
 * `activity-<id>`, so the two stand side by side and nothing can take the
 * placeholder down: one ride, two tray entries, the second of them generic. The
 * cost is a force-stopped package, which receives no data push at all and so
 * now sees nothing until it is next opened. Evan weighed that against the
 * double entry on 2026-09-20 and chose this.
 *
 * iOS keeps both. Its notification service extension rewrites the visible push
 * in place rather than posting beside it, and a force-quit app there is woken
 * by nothing else.
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

  if (visible && platform !== "android") {
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
