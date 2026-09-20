/**
 * Hand the engine the notification templates for the locale the app is running
 * in, so a push handler woken with no JavaScript alive can still write a
 * sentence.
 *
 * The bundles stay in TypeScript and i18next stays the only thing that
 * resolves one. Rust holds the fifteen resolved strings for whichever locale
 * was last pushed, and formats with those.
 *
 * `setNameTranslations` is the same gesture for two words and keeps them in a
 * process global, which a handler in a fresh process cannot read. These go to
 * the settings table.
 */

import { i18n } from './index';
import { getEngine } from '@/shared/native/engine';
import { debug } from '@/shared/debug/debug';

const log = debug.create('NotificationTemplates');

/**
 * Every key a notification sentence is built from: the twelve clause
 * templates and the three titles.
 *
 * Named here rather than derived from the bundle, so a key that loses its
 * reader still fails `unusedKeys.test.ts` and a renamed one fails the parity
 * test beside it. They interpolate `{{name}}`, `{{delta}}` and `{{count}}`
 * and nothing else, and no locale carries a plural variant of any of them.
 */
export const NOTIFICATION_TEMPLATE_KEYS = [
  'notifications.activityBody.aSection',
  'notifications.activityBody.routePr',
  'notifications.activityBody.routePrDelta',
  'notifications.activityBody.routePrUnnamed',
  'notifications.activityBody.routePrUnnamedDelta',
  'notifications.activityBody.sectionPr',
  'notifications.activityBody.sectionPrDelta',
  'notifications.activityBody.sectionPrCount',
  'notifications.activityBody.sectionPrMany',
  'notifications.activityBody.fasterOnRoute',
  'notifications.activityBody.fasterOnRouteDelta',
  'notifications.activityBody.onRoute',
  'notifications.activityPr.title',
  'notifications.activityFaster.title',
  'notifications.activityRecorded.title',
] as const;

/**
 * Resolve the fifteen against the current bundle and store them.
 *
 * Call it only once the bundle is in i18next's store. Before that every key
 * resolves as itself, and a bundle of keys is what the handler would render.
 *
 * Silent when there is no engine: the launch path runs this before the
 * library's identity is settled on some routes, and a push cannot arrive on an
 * install that has never signed in.
 */
export function pushNotificationTemplates(): void {
  const engine = getEngine();
  if (!engine) return;

  const locale = i18n.language;
  if (!locale) return;

  // `skipOnVariables` leaves `{{name}}` in the stored template for Rust to
  // substitute, rather than resolving it to an empty string here. The cast is
  // i18next's key union refusing a `string[]` overload it does accept.
  const resolve = i18n.t as unknown as (key: string, options: object) => string;
  const templates = NOTIFICATION_TEMPLATE_KEYS.map((key) => ({
    key,
    value: resolve(key, { interpolation: { skipOnVariables: true } }),
  }));

  // A key that resolves as itself means the bundle is not loaded yet. Storing
  // that would leave the handler rendering dotted paths on a lock screen, so
  // keep whatever the last good push left.
  if (templates.some((pair) => pair.value === pair.key)) {
    log.warn('notification templates unresolved, keeping the stored bundle', locale);
    return;
  }

  try {
    engine.setNotificationTemplates(locale, templates);
  } catch (e) {
    log.warn('could not store notification templates', e);
  }
}
