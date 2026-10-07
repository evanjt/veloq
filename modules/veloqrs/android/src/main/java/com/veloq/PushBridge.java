package com.veloq;

/**
 * The push worker's route into Rust.
 *
 * <p>A data push wakes the app process and, on a cold start, no JavaScript runs
 * in it: nothing has opened the engine and nothing has set the credential. So
 * the worker carries both and hands them over before it asks for anything.
 *
 * <p>The symbols are exported by libveloqrs.so directly rather than through a
 * generated Kotlin binding. uniffi-bindgen cannot generate one without its
 * callback-interface initialisation, and a second installer of that vtable in
 * one process makes Rust dispatch a JavaScript-registered observer through
 * another language's handle map.
 *
 * <p>Every call blocks. The caller is an expedited worker, already off the main
 * thread and holding a budget measured in seconds.
 */
public final class PushBridge {
  private static volatile boolean loaded = false;

  private PushBridge() {}

  /**
   * Open the engine and set the credential, and say whether a fetch can be
   * attempted. Neither is replaced if the app is already running with its own.
   */
  public static boolean prepare(String dbPath, String authMethod, String secret, String athleteId) {
    load();
    return nativePrepare(dbPath, authMethod, secret, athleteId);
  }

  /**
   * Open the engine with no credential, so a failed run can still be recorded
   * and the plain entry can read the stored title. Nothing is replaced if the
   * app already has the engine open.
   */
  public static boolean open(String dbPath) {
    load();
    return nativeOpen(dbPath);
  }

  /**
   * One activity push end to end: the gate, the detail body, the track and
   * its index, then the sentence. Returns {@code {"title","body"}} as JSON, or
   * {@code {"skip":true}} when the gate says to post nothing or the push is
   * for a different athlete. Null means the call failed, and the worker
   * answers it with the plain fallback entry.
   */
  public static String activityPush(String activityId, String athleteId) {
    load();
    return nativeActivityPush(activityId, athleteId);
  }

  public static String fallbackNotification() {
    load();
    return nativeFallbackNotification();
  }

  public static void recordFailure(String activityId, String reason) {
    load();
    nativeRecordFailure(activityId, reason);
  }

  /**
   * The home-screen widget snapshot, composed by the same Rust the app
   * composes it with, from the context the app last stored. Null when there
   * is nothing to compose from, and the widgets keep the file they have.
   */
  public static String widgetSnapshot() {
    load();
    return nativeWidgetSnapshot();
  }

  private static void load() {
    if (!loaded) {
      synchronized (PushBridge.class) {
        if (!loaded) {
          // Already in the process via the JSI adapter when the app is warm,
          // but Java needs its own registration before it will resolve a
          // native method against it.
          System.loadLibrary("veloqrs");
          loaded = true;
        }
      }
    }
  }

  private static native boolean nativePrepare(
      String dbPath, String authMethod, String secret, String athleteId);

  private static native boolean nativeOpen(String dbPath);

  private static native String nativeActivityPush(String activityId, String athleteId);

  private static native String nativeFallbackNotification();

  private static native void nativeRecordFailure(String activityId, String reason);

  private static native String nativeWidgetSnapshot();
}
