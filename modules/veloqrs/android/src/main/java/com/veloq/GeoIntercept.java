package com.veloq;

import java.io.ByteArrayInputStream;

/**
 * What the WebView is answered for one {@code /veloq-geo/} request: GeoJSON
 * the engine writes from what it stores, such as one activity's line.
 *
 * <p>Kept apart from the WebView client so the decision runs on the JVM with
 * the native call faked. The engine's answer is a pooled read with no network
 * in it, so it is answered on the interceptor's thread.
 */
final class GeoIntercept {

  static final String MIME = "application/geo+json";

  /** The engine's side of a geo request, as {@link TileBridge} makes it. */
  interface Geo {
    /**
     * The bytes for {@code path}, or null with {@code status[0]} set to the
     * answer: 400 for a malformed path, 404 for nothing stored there, 503
     * before the engine is open.
     */
    byte[] answer(String path, int[] status);
  }

  private final Geo geo;

  GeoIntercept(Geo geo) {
    this.geo = geo;
  }

  static String reasonFor(int status) {
    switch (status) {
      case 400:
        return "Bad Geo Path";
      case 404:
        return "Not Found";
      case 503:
        return "Service Unavailable";
      default:
        return "Bad Gateway";
    }
  }

  /** Answer {@code rest}, the request path after {@code /veloq-geo/}. */
  TileIntercept.Answer answer(String rest) {
    // It starts at 502 so a native call that returns without writing it reads
    // as a failure, not a refusal.
    int[] status = {502};
    byte[] bytes = geo.answer(rest, status);
    if (bytes == null || bytes.length == 0) {
      int code = status[0] == 200 ? 502 : status[0];
      return new TileIntercept.Answer(code, reasonFor(code), MIME,
          new ByteArrayInputStream(new byte[0]));
    }
    return new TileIntercept.Answer(200, "OK", MIME, new ByteArrayInputStream(bytes));
  }
}
