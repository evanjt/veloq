package com.veloq;

/**
 * The map page's route into the Rust-owned tile store.
 *
 * <p>A WebView asks for a tile with an ordinary HTTP request, which Android
 * hands to {@code shouldInterceptRequest} on a background thread with no
 * JavaScript context. That rules out the UniFFI surface, which this project
 * generates for JSI. The symbol below is exported by libveloqrs.so directly.
 *
 * <p>Blocking is correct here: the caller is already off the UI thread and
 * needs the bytes in hand to build its response.
 */
public final class TileBridge {
  private static volatile boolean loaded = false;

  private TileBridge() {}

  /** Bytes for one tile, or null when there is no tile to be had. */
  public static byte[] getOrFetch(String source, int z, int x, int y) {
    if (!loaded) {
      synchronized (TileBridge.class) {
        if (!loaded) {
          // Already in the process via the JSI adapter, but Java needs its own
          // registration before it will resolve a native method against it.
          System.loadLibrary("veloqrs");
          loaded = true;
        }
      }
    }
    return nativeGetOrFetch(source, z, x, y);
  }

  private static native byte[] nativeGetOrFetch(String source, int z, int x, int y);
}
