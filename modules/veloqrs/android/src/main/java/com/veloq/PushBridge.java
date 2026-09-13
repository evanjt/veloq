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
 * <p>Both calls block. The caller is an expedited worker, already off the main
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
   * Fetch one activity's track, store it and index it against the catalogue.
   * Returns the summary as JSON, or null when nothing was indexed, with the
   * reason in the log.
   */
  public static String fetchAndIndex(String activityId, String sportType) {
    load();
    return nativeFetchAndIndex(activityId, sportType);
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

  private static native String nativeFetchAndIndex(String activityId, String sportType);
}
