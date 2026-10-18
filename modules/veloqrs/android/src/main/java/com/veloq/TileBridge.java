package com.veloq;

/**
 * The map page's route into the Rust-owned tile store.
 *
 * <p>A WebView asks for a tile with an ordinary HTTP request, which Android
 * hands to {@code shouldInterceptRequest} on a background thread with no
 * JavaScript context. That rules out the UniFFI surface, which this project
 * generates for JSI. The symbol below is exported by libveloqrs.so directly.
 *
 * <p>A tile never waits on a tile host here: the caller is the WebView's own
 * small pool, which a held thread starves, so basemap tiles go to the engine's
 * loopback listener and only the heatmap is answered here. A glyph range still
 * waits, since one is fetched only for a script the app does not bundle.
 */
public final class TileBridge {
  private static volatile boolean loaded = false;

  private TileBridge() {}

  /**
   * Bytes for one tile already held, or null when there are none. {@code status[0]} is set
   * to what the page is answered with: 200 with the bytes, and without them 404 for a
   * refusal or a tile not held, and 429 or 503 when the tile host asked to be left alone.
   */
  public static byte[] answer(String source, int z, int x, int y, int[] status) {
    load();
    return nativeAnswer(source, z, x, y, status);
  }

  /**
   * Bytes for one glyph range the app does not bundle, fetched and kept on a
   * miss, or null when there are none. {@code status[0]} is set as for
   * {@link #answer}.
   */
  public static byte[] getGlyph(String fontstack, String range, int[] status) {
    load();
    return nativeGetGlyph(fontstack, range, status);
  }

  /**
   * GeoJSON for one {@code /veloq-geo/} path, or null when there is none.
   * {@code status[0]} is set as {@link GeoIntercept.Geo#answer} describes.
   */
  public static byte[] geo(String path, int[] status) {
    load();
    return nativeGeo(path, status);
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

  private static native byte[] nativeAnswer(String source, int z, int x, int y, int[] status);

  private static native byte[] nativeGetGlyph(String fontstack, String range, int[] status);

  private static native byte[] nativeGeo(String path, int[] status);
}
