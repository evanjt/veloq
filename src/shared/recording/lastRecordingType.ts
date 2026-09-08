/**
 * The sport the athlete last recorded, published where anything can read it.
 *
 * The value belongs to the recording feature's preferences, but the widget
 * snapshot needs it and lives in `home`, and importing the recording barrel from
 * there drags the whole app shell (its components reach the engine TurboModule
 * and react-native-iap) into a path the background task also runs. One writer,
 * `RecordingPreferencesStore`, sets it on hydration and on every start, so this
 * never drifts from what is persisted.
 */
let lastRecordingType: string | null = null;

/** A blank sport is no sport: readers fall back rather than take an empty path. */
export function setLastRecordingType(type: string | null | undefined): void {
  const trimmed = typeof type === 'string' ? type.trim() : '';
  lastRecordingType = trimmed.length > 0 ? trimmed : null;
}

export function getLastRecordingType(): string | null {
  return lastRecordingType;
}
