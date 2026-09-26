/**
 * What the app knows about one activity before it asks the engine what the
 * activity was worth.
 *
 * The priority ladder and both renderings used to live here and in
 * `activityNotificationBody.ts`. They are the engine's now
 * (`modules/veloqrs/rust/veloqrs/src/notifications.rs`), reached through
 * `engine.activityNotification`, so a native push handler that runs with no
 * JavaScript builds the same sentence as the screen without the ladder being
 * ported to Kotlin and then again to Swift.
 */

export interface ActivityInfo {
  name: string;
  type: string;
  ingested: boolean;
  distance?: number;
  movingTime?: number;
}
