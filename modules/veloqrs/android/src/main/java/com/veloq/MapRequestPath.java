package com.veloq;

/**
 * Which of the map page's own requests a URL is, and the path after its marker.
 *
 * <p>Kept apart from the WebView client so the routing runs on the JVM. The
 * geo marker is matched first: a geo path is not {@code source/z/x/y}, so
 * reaching the tile parser would refuse it as a 400.
 */
final class MapRequestPath {

  enum Kind { GEO, ASSET, TILE }

  static final String GEO_PATH = "/veloq-geo/";
  static final String ASSET_PATH = "/veloq-asset/";
  static final String TILE_PATH = "/veloq-tile/";

  final Kind kind;
  /** Everything after the marker, query string included. */
  final String rest;

  private MapRequestPath(Kind kind, String rest) {
    this.kind = kind;
    this.rest = rest;
  }

  /** The route for {@code url}, or null when it is the library's to answer. */
  static MapRequestPath of(String url) {
    MapRequestPath route = after(url, GEO_PATH, Kind.GEO);
    if (route == null) route = after(url, ASSET_PATH, Kind.ASSET);
    if (route == null) route = after(url, TILE_PATH, Kind.TILE);
    return route;
  }

  private static MapRequestPath after(String url, String marker, Kind kind) {
    int at = url.indexOf(marker);
    return at < 0 ? null : new MapRequestPath(kind, url.substring(at + marker.length()));
  }
}
