/**
 * The sports the athlete recently recorded, published where anything can read
 * them, most recent first.
 *
 * The value belongs to the recording feature's preferences, but the widget
 * snapshot needs it and lives in `home`, and importing the recording barrel from
 * there drags the whole app shell (its components reach the engine TurboModule
 * and react-native-iap) into a path the background task also runs. One writer,
 * `RecordingPreferencesStore`, sets it on hydration and on every start, so this
 * never drifts from what is persisted.
 */
let recentRecordingTypes: string[] = [];

/** A blank sport is no sport: readers fall back rather than take an empty path. */
export function setRecentRecordingTypes(types: readonly (string | null | undefined)[]): void {
  recentRecordingTypes = types
    .map((t) => (typeof t === 'string' ? t.trim() : ''))
    .filter((t) => t.length > 0);
}

export function getRecentRecordingTypes(): string[] {
  return [...recentRecordingTypes];
}

/** The one a single-sport surface starts. */
export function getLastRecordingType(): string | null {
  return recentRecordingTypes[0] ?? null;
}
