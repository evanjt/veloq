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

  /**
   * Bytes for one tile, or null when there is none to hand over. {@code status[0]} is
   * set to what the page is answered with: 200 with the bytes, and without them 404 for
   * a refusal, 429 or 503 when the tile host asked to be left alone, and 502 when it
   * failed.
   */
  public static byte[] getOrFetch(String source, int z, int x, int y, int[] status) {
    load();
    return nativeGetOrFetch(source, z, x, y, status);
  }

  /**
   * Bytes for one glyph range the app does not bundle, fetched and kept on a
   * miss, or null when there are none. {@code status[0]} is set as for
   * {@link #getOrFetch}.
   */
  public static byte[] getGlyph(String fontstack, String range, int[] status) {
    load();
    return nativeGetGlyph(fontstack, range, status);
  }

  private static void load() {
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
  }

  private static native byte[] nativeGetOrFetch(
      String source, int z, int x, int y, int[] status);

  private static native byte[] nativeGetGlyph(String fontstack, String range, int[] status);
}
