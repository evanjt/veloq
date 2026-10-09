package com.veloq;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.util.Locale;

/**
 * What the WebView is answered for one {@code /veloq-tile/} request.
 *
 * <p>Kept apart from the WebView client so the decision runs on the JVM with
 * the native call faked. The interceptor runs on the WebView's own small pool,
 * which also hands finished responses to the page, so nothing here may wait
 * on a tile host: a miss is answered with a body still to come.
 */
final class TileIntercept {

  /** The engine's side of a tile request, as {@link TileBridge} makes it. */
  interface Tiles {
    /**
     * Bytes for a tile already held, or null with {@code status[0]} set to the
     * answer: a refusal, a throttle, a failure, or {@link TileBridge#PENDING}
     * when {@code pending} will be completed once the host answers.
     */
    byte[] answer(String source, int z, int x, int y, int[] status, PendingTile pending);
  }

  /** One answer: a status, its reason, a content type and a body. */
  static final class Answer {
    final int status;
    final String reason;
    final String mime;
    final InputStream body;

    Answer(int status, String reason, String mime, InputStream body) {
      this.status = status;
      this.reason = reason;
      this.mime = mime;
      this.body = body;
    }
  }

  private final Tiles tiles;

  TileIntercept(Tiles tiles) {
    this.tiles = tiles;
  }

  /**
   * What the bytes are, from the extension the page asked for.
   *
   * Never from the source name. The page passes the style's own source key,
   * `openmaptiles`, `ne2_shaded` and the satellite ids, and none of them
   * begins with the `vector` or `terrain` prefix a name match needed, so every
   * tile including the vector basemap was answered as imagery.
   *
   * The fallback is imagery because that is what a template naming no
   * extension is: several satellite hosts carry z/x/y in query parameters and
   * end in no path extension at all, while the vector source always names
   * `pbf`.
   */
  static String mimeFor(String extension) {
    switch (extension) {
      case "pbf":
      case "mvt":
        return "application/x-protobuf";
      case "png":
        return "image/png";
      case "webp":
        return "image/webp";
      case "jpg":
      case "jpeg":
        return "image/jpeg";
      default:
        return "image/jpeg";
    }
  }

  /** The reason phrase for a status the store can answer without a tile. */
  static String reasonFor(int status) {
    switch (status) {
      case 400:
        return "Bad Tile Path";
      case 404:
        return "No Tile";
      case 429:
        return "Too Many Requests";
      case 503:
        return "Service Unavailable";
      default:
        return "Bad Gateway";
    }
  }

  static Answer empty(int status) {
    return new Answer(status, reasonFor(status), "image/jpeg", new ByteArrayInputStream(new byte[0]));
  }

  /** Answer {@code rest}, the request path after {@code /veloq-tile/}. */
  Answer answer(String rest) {
    int q = rest.indexOf('?');
    if (q >= 0) rest = rest.substring(0, q);
    // <source>/<z>/<x>/<y>[.ext]
    String[] parts = rest.split("/");
    if (parts.length != 4) return empty(400);
    String source = parts[0];
    String extension = "";
    int dot = parts[3].indexOf('.');
    if (dot >= 0) {
      extension = parts[3].substring(dot + 1).toLowerCase(Locale.ROOT);
      parts[3] = parts[3].substring(0, dot);
    }
    int z;
    int x;
    int y;
    try {
      z = Integer.parseInt(parts[1]);
      x = Integer.parseInt(parts[2]);
      y = Integer.parseInt(parts[3]);
    } catch (NumberFormatException e) {
      return empty(400);
    }

    // What the engine says the page is to be told. A 429 or a 503 is the tile
    // host asking to be left alone, and the page's throttle backoff counts
    // only those, so they cross as themselves. It starts at 502 so a native
    // call that returns without writing it reads as a failure, not a refusal.
    int[] status = {502};
    PendingTile pending = new PendingTile();
    byte[] bytes = tiles.answer(source, z, x, y, status, pending);
    String mime = mimeFor(extension);
    if (status[0] == TileBridge.PENDING) {
      return new Answer(200, "OK", mime, pending);
    }
    if (bytes == null || bytes.length == 0) {
      return empty(status[0] == 200 ? 404 : status[0]);
    }
    return new Answer(200, "OK", mime, new ByteArrayInputStream(bytes));
  }
}
