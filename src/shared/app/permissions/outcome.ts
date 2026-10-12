/**
 * Where a permission stands, as one word a screen can act on. `askable` means
 * the system will still show its dialog, `blocked` that only the app's page in
 * system settings can change it now.
 */
export type PermissionOutcome = 'granted' | 'askable' | 'blocked';

/** The shape every Expo permission response shares. */
export interface PermissionAnswer {
  status: string;
  canAskAgain?: boolean;
}

/**
 * Read an Expo permission response as an outcome. A response without
 * `canAskAgain` reads as askable, so a missing field never hides the dialog.
 */
export function permissionOutcome(answer: PermissionAnswer): PermissionOutcome {
  if (answer.status === 'granted') return 'granted';
  return answer.canAskAgain === false ? 'blocked' : 'askable';
}

export interface PermissionAsk {
  outcome: PermissionOutcome;
  /** The system dialog was raised by this ask, so the athlete has just answered it. */
  prompted: boolean;
}

/**
 * Reads the permission first and requests it only when the system will still
 * show its dialog. A `blocked` result with `prompted` false means the tap raised
 * nothing on screen, so the caller owes the athlete the way to settings.
 */
export async function askPermission(
  read: () => Promise<PermissionAnswer>,
  request: () => Promise<PermissionAnswer>
): Promise<PermissionAsk> {
  const before = permissionOutcome(await read());
  if (before !== 'askable') return { outcome: before, prompted: false };
  return { outcome: permissionOutcome(await request()), prompted: true };
}
