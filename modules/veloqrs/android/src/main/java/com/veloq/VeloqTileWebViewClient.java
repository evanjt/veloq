package com.veloq;

import android.util.Log;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import com.reactnativecommunity.webview.RNCWebViewClient;

import java.io.ByteArrayInputStream;
import java.io.FileNotFoundException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Serves basemap tiles straight out of the Rust-owned store, and lets Rust
 * fetch and keep the tile when the store does not have it. Serves the sprite
 * and glyphs out of the app's assets.
 *
 * <p>Android calls this on a background thread with no JavaScript context, so
 * the only route into Rust is {@link TileBridge}, which this module owns.
 * Every other request is the library's to answer.
 */
public class VeloqTileWebViewClient extends RNCWebViewClient {

  private static final String TAG = "VeloqTile";
  private static final String TILE_PATH = "/veloq-tile/";
  private static final String ASSET_PATH = "/veloq-asset/";

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
  private static String mimeFor(String extension) {
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
  private static String reasonFor(int status) {
    switch (status) {
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

  private static WebResourceResponse empty(int status, String reason, Map<String, String> headers) {
    return new WebResourceResponse("image/jpeg", null, status, reason, headers,
        new ByteArrayInputStream(new byte[0]));
  }

  /**
   * A file the app carries. A glyph range outside the bundle is Rust's to
   * fetch and keep, and any other path the app does not carry is a 404.
   */
  private static WebResourceResponse asset(WebView view, String url, int at) {
    Map<String, String> headers = new HashMap<>();
    headers.put("Access-Control-Allow-Origin", "*");
    headers.put("Cache-Control", "no-store");

    String path = BasemapAssetPath.resolve(url.substring(at + ASSET_PATH.length()));
    if (path == null) return empty(404, "No Asset", headers);
    try {
      InputStream stream = view.getContext().getAssets().open(path);
      return new WebResourceResponse(BasemapAssetPath.mimeFor(path), null, 200, "OK", headers, stream);
    } catch (FileNotFoundException e) {
      return glyph(path, headers);
    } catch (Throwable t) {
      Log.w(TAG, "asset intercept failed for " + url, t);
      return empty(500, "Asset Error", headers);
    }
  }

  /** A glyph range the bundle lacks, from Rust's store or the glyph host. */
  private static WebResourceResponse glyph(String path, Map<String, String> headers) {
    String[] request = BasemapAssetPath.glyphRequest(path);
    if (request == null) return empty(404, "No Asset", headers);
    int[] status = {502};
    byte[] bytes = TileBridge.getGlyph(request[0], request[1], status);
    if (bytes == null || bytes.length == 0) {
      int code = status[0] == 200 ? 404 : status[0];
      return empty(code, reasonFor(code), headers);
    }
    return new WebResourceResponse("application/x-protobuf", null, 200, "OK", headers,
        new ByteArrayInputStream(bytes));
  }

  @Override
  public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
    String url = request.getUrl().toString();
    int assetAt = url.indexOf(ASSET_PATH);
    if (assetAt >= 0) {
      return asset(view, url, assetAt);
    }
    int at = url.indexOf(TILE_PATH);
    if (at < 0) {
      return super.shouldInterceptRequest(view, request);
    }

    // The page shares the WebView's own origin, so this never leaves the
    // process, but MapLibre reads the image back off a canvas and needs both.
    Map<String, String> headers = new HashMap<>();
    headers.put("Access-Control-Allow-Origin", "*");
    headers.put("Cache-Control", "no-store");

    try {
      String rest = url.substring(at + TILE_PATH.length());
      int q = rest.indexOf('?');
      if (q >= 0) rest = rest.substring(0, q);
      // <source>/<z>/<x>/<y>[.ext]
      String[] parts = rest.split("/");
      if (parts.length != 4) return empty(400, "Bad Tile Path", headers);
      String source = parts[0];
      String extension = "";
      int dot = parts[3].indexOf('.');
      if (dot >= 0) {
        extension = parts[3].substring(dot + 1).toLowerCase(Locale.ROOT);
        parts[3] = parts[3].substring(0, dot);
      }
      int z = Integer.parseInt(parts[1]);
      int x = Integer.parseInt(parts[2]);
      int y = Integer.parseInt(parts[3]);

      // What Rust says the page is to be told. A 429 or a 503 is the tile host
      // asking to be left alone, and the page's throttle backoff counts only
      // those, so they cross as themselves. It starts at 502 so a native call
      // that returns without writing it reads as a failure, not a refusal.
      int[] status = {502};
      byte[] bytes = TileBridge.getOrFetch(source, z, x, y, status);
      if (bytes == null || bytes.length == 0) {
        int code = status[0] == 200 ? 404 : status[0];
        return empty(code, reasonFor(code), headers);
      }
      return new WebResourceResponse(mimeFor(extension), null, 200, "OK", headers,
          new ByteArrayInputStream(bytes));
    } catch (Throwable t) {
      Log.w(TAG, "tile intercept failed for " + url, t);
      return empty(500, "Tile Error", headers);
    }
  }
}
