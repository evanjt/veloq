import { requireOptionalNativeModule } from 'expo-modules-core';

import type { LatLngShort } from 'veloqrs';

import { requestNotificationPermissionOutcome } from '@/shared/app/permissions/notifications';

interface VeloqWatchModule {
  state(): { enabled?: boolean };
  setEnabled(enabled: boolean): void;
  sendSection(reply: string): void;
}

/**
 * Hand one section to the Apple Watch guide. The watch reads its cues as
 * notifications, so the phone's notification request is raised after the send,
 * and only while the system still shows its dialog. Nothing is sent and no
 * request is raised while the watch link is switched off, or without the watch
 * module, as on Android; resolves false in both cases.
 */
export async function sendSectionToWatch(reply: string): Promise<boolean> {
  const mod = requireOptionalNativeModule<VeloqWatchModule>('VeloqWatch');
  if (!mod || mod.state().enabled !== true) return false;
  mod.sendSection(reply);
  await requestNotificationPermissionOutcome();
  return true;
}

/** Whether this build carries the watch module, which only the iOS build does. */
export function isWatchLinkAvailable(): boolean {
  return requireOptionalNativeModule<VeloqWatchModule>('VeloqWatch') != null;
}

/** Whether the athlete has the watch link switched on; false without the module. */
export function isWatchLinkEnabled(): boolean {
  return requireOptionalNativeModule<VeloqWatchModule>('VeloqWatch')?.state().enabled === true;
}

/** Switch the watch link on or off. Does nothing without the module. */
export function setWatchLinkEnabled(enabled: boolean): void {
  requireOptionalNativeModule<VeloqWatchModule>('VeloqWatch')?.setEnabled(enabled);
}

/**
 * Hand a section to the watch guide as its name and line. A section with no
 * line has nothing to guide along, so nothing is sent and resolves false.
 */
export async function sendSectionGuide(section: {
  name: string;
  polyline: readonly LatLngShort[];
}): Promise<boolean> {
  if (section.polyline.length === 0) return false;
  const line = section.polyline.map(({ lat, lng }) => ({ latitude: lat, longitude: lng }));
  return sendSectionToWatch(JSON.stringify({ name: section.name, line }));
}
