/**
 * The debug action that reposts an activity's notification: the engine builds the sentence
 * from the stored activity, with the athlete's category switches, and the platform's own poster
 * puts it up. Nothing here writes text, so what reaches the tray is what a real push would show.
 */
import { getNotificationPreferences, presentActivityNotification } from '@/features/settings/light';
import { pushNotificationTemplates } from '@/i18n/notificationTemplates';

export interface RegenerateNotificationDeps {
  build: (
    activityId: string,
    name: string,
    sectionPr: boolean,
    fitnessMilestone: boolean
  ) => { title: string; body: string } | null | undefined;
  post: (activityId: string, title: string, body: string) => Promise<void>;
  categories: { sectionPr: boolean; fitnessMilestone: boolean };
}

/** The text posted, or null when the engine has nothing to say about the activity. */
export async function regenerateNotification(
  activityId: string,
  name: string,
  deps: RegenerateNotificationDeps
): Promise<{ title: string; body: string } | null> {
  const built = deps.build(
    activityId,
    name,
    deps.categories.sectionPr,
    deps.categories.fitnessMilestone
  );
  if (!built || !built.body) return null;
  await deps.post(activityId, built.title, built.body);
  return built;
}

/**
 * Debug action: build the activity's notification in the engine and post it through the
 * platform poster, with the athlete's category switches. Returns false when there is no text.
 */
export async function repostActivityNotification(
  activityId: string,
  name: string,
  build: RegenerateNotificationDeps['build']
): Promise<boolean> {
  pushNotificationTemplates();
  const posted = await regenerateNotification(activityId, name, {
    build,
    post: (id, title, body) =>
      presentActivityNotification(id, title, body, { route: `/activity/${id}`, activityId: id }),
    categories: getNotificationPreferences().categories,
  });
  return posted !== null;
}
