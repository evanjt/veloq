/**
 * The place names switch. The engine holds it, and every reader and writer
 * goes through here so no screen reaches the setting on its own.
 */

import { getEngine } from '@/shared/native/engine';

/** Whether the athlete has agreed to send route and section end points for names. */
export function getPlaceNamesEnabled(): boolean {
  return getEngine()?.getGeocodingEnabled() ?? false;
}

export function setPlaceNamesEnabled(enabled: boolean): void {
  getEngine()?.setGeocodingEnabled(enabled);
}
