package com.veloq;

import android.util.Log;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import com.reactnativecommunity.webview.RNCWebViewClient;

import java.io.ByteArrayInputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * Serves basemap tiles straight out of the Rust-owned store, and lets Rust
 * fetch and keep the tile when the store does not have it.
 *
 * <p>Android calls this on a background thread with no JavaScript context, so
 * the only route into Rust is {@link TileBridge}, which this module owns.
 * Every other request is the library's to answer.
 */
public class VeloqTileWebViewClient extends RNCWebViewClient {

  private static final String TAG = "VeloqTile";
  private static final String TILE_PATH = "/veloq-tile/";

  private static String mimeFor(String source) {
    if (source.startsWith("vector")) return "application/x-protobuf";
    if (source.startsWith("terrain")) return "image/png";
    return "image/jpeg";
  }

  private static WebResourceResponse empty(int status, String reason, Map<String, String> headers) {
    return new WebResourceResponse("image/jpeg", null, status, reason, headers,
        new ByteArrayInputStream(new byte[0]));
  }

  @Override
  public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
    String url = request.getUrl().toString();
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
      int dot = parts[3].indexOf('.');
      if (dot >= 0) parts[3] = parts[3].substring(0, dot);
      int z = Integer.parseInt(parts[1]);
      int x = Integer.parseInt(parts[2]);
      int y = Integer.parseInt(parts[3]);

      byte[] bytes = TileBridge.getOrFetch(source, z, x, y);
      if (bytes == null || bytes.length == 0) return empty(404, "No Tile", headers);
      return new WebResourceResponse(mimeFor(source), null, 200, "OK", headers,
          new ByteArrayInputStream(bytes));
    } catch (Throwable t) {
      Log.w(TAG, "tile intercept failed for " + url, t);
      return empty(500, "Tile Error", headers);
    }
  }
}
