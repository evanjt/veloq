package com.veloq;

import java.io.UnsupportedEncodingException;
import java.net.URLDecoder;
import java.util.Locale;

/**
 * Maps the path a map page asks for under `veloq-asset/` to a file in the app's
 * `basemap` asset directory, and refuses everything that is not one.
 *
 * <p>The page decides the path, so this is the one place that keeps a request
 * inside the two directories the app ships: any segment that is empty, `.` or
 * `..`, a backslash, a NUL, or a first segment other than `sprites` or `fonts`
 * resolves to nothing.
 */
final class BasemapAssetPath {

  static final String ROOT = "basemap/";

  private BasemapAssetPath() {}

  /**
   * @param rest what follows `veloq-asset/` in the request URL, query and
   *     fragment included, percent-encoded as MapLibre sends it
   * @return the asset path under the app's assets, or null when the request is
   *     not for a file the app can carry
   */
  static String resolve(String rest) {
    if (rest == null) return null;
    int cut = rest.length();
    int query = rest.indexOf('?');
    if (query >= 0) cut = query;
    int fragment = rest.indexOf('#');
    if (fragment >= 0 && fragment < cut) cut = fragment;

    String decoded;
    try {
      // URLDecoder reads a plus as a space, which a path never means.
      decoded = URLDecoder.decode(rest.substring(0, cut).replace("+", "%2B"), "UTF-8");
    } catch (UnsupportedEncodingException | IllegalArgumentException e) {
      return null;
    }
    if (decoded.indexOf('\\') >= 0 || decoded.indexOf('\0') >= 0) return null;

    String[] segments = decoded.split("/", -1);
    if (segments.length < 2) return null;
    for (String segment : segments) {
      if (segment.isEmpty() || segment.equals(".") || segment.equals("..")) return null;
    }
    if (!segments[0].equals("sprites") && !segments[0].equals("fonts")) return null;
    return ROOT + decoded;
  }

  /**
   * The font stack and range a resolved asset path names when it is a glyph
   * range, so a range the bundle lacks can be asked of Rust. Rust checks both
   * against what the glyph host serves.
   *
   * @param path what {@link #resolve} returned
   * @return {stack, range}, or null when the path is not a glyph range
   */
  static String[] glyphRequest(String path) {
    String prefix = ROOT + "fonts/";
    if (path == null || !path.startsWith(prefix) || !path.endsWith(".pbf")) return null;
    String[] parts = path.substring(prefix.length(), path.length() - ".pbf".length()).split("/", -1);
    return parts.length == 2 ? parts : null;
  }

  /** What the bytes are, from the extension of the file asked for. */
  static String mimeFor(String path) {
    String lower = path.toLowerCase(Locale.ROOT);
    if (lower.endsWith(".json")) return "application/json";
    if (lower.endsWith(".png")) return "image/png";
    if (lower.endsWith(".pbf")) return "application/x-protobuf";
    return "application/octet-stream";
  }
}
