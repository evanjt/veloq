/**
 * Hand the engine the words a place name for a new route or section is put
 * together with, and the locale its lookups are asked in, for the locale the
 * app is running in.
 *
 * The engine names a route or section from the places it starts and ends in,
 * after a sync or a detection run, which can happen in a process with no
 * JavaScript alive. So these go to the settings table, like the notification
 * templates, rather than to a process global like the route and section
 * words.
 */

import { i18n } from './index';
import { setSetting } from '@/shared/storage/settingsStorage';
import { debug } from '@/shared/debug/debug';

const log = debug.create('PlaceNameWords');

/** The engine's settings key for the stored words. */
export const PLACE_NAME_WORDS_KEY = '__place_name_words';

const LOOP_KEY = 'routes.placeLoop';
const JOURNEY_KEY = 'routes.placeJourney';

/**
 * Store the words for the current locale. A key that resolves as itself means
 * the bundle has not loaded yet, and storing that would name a route with a
 * dotted path, so whatever the last good push left is kept.
 */
export function pushPlaceNameWords(): void {
  const locale = i18n.language;
  if (!locale) return;

  // `skipOnVariables` leaves `{{place}}`, `{{start}}` and `{{end}}` in the
  // stored words for Rust to substitute. The cast is i18next's key union
  // refusing a `string` overload it does accept.
  const resolve = i18n.t as unknown as (key: string, options: object) => string;
  const options = { interpolation: { skipOnVariables: true } };
  const loop = resolve(LOOP_KEY, options);
  const journey = resolve(JOURNEY_KEY, options);
  if (loop === LOOP_KEY || journey === JOURNEY_KEY) {
    log.warn('place name words unresolved, keeping the stored ones', locale);
    return;
  }

  setSetting(PLACE_NAME_WORDS_KEY, JSON.stringify({ locale, loop, journey })).catch((e) => {
    log.warn('could not store place name words', e);
  });
}
