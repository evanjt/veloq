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
import java.util.Map;

/**
 * Serves basemap tiles straight out of the Rust-owned store, and lets Rust
 * fetch and keep the tile when the store does not have it, answering the page
 * at once with a body that follows. Serves the sprite and glyphs out of the
 * app's assets, and GeoJSON Rust writes from what it stores.
 *
 * <p>Android calls this on a background thread with no JavaScript context, so
 * the only route into Rust is {@link TileBridge}, which this module owns.
 * Every other request is the library's to answer.
 */
public class VeloqTileWebViewClient extends RNCWebViewClient {

  private static final String TAG = "VeloqTile";

  private static final TileIntercept TILES = new TileIntercept(TileBridge::answer);
  private static final GeoIntercept GEO = new GeoIntercept(TileBridge::geo);

  private static WebResourceResponse empty(int status, String reason, Map<String, String> headers) {
    return new WebResourceResponse("image/jpeg", null, status, reason, headers,
        new ByteArrayInputStream(new byte[0]));
  }

  /**
   * A file the app carries. A glyph range outside the bundle is Rust's to
   * fetch and keep, and any other path the app does not carry is a 404.
   */
  private static WebResourceResponse asset(WebView view, String url, String rest) {
    Map<String, String> headers = new HashMap<>();
    headers.put("Access-Control-Allow-Origin", "*");
    headers.put("Cache-Control", "no-store");

    String path = BasemapAssetPath.resolve(rest);
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
      return empty(code, TileIntercept.reasonFor(code), headers);
    }
    return new WebResourceResponse("application/x-protobuf", null, 200, "OK", headers,
        new ByteArrayInputStream(bytes));
  }

  @Override
  public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
    String url = request.getUrl().toString();
    MapRequestPath route = MapRequestPath.of(url);
    if (route == null) {
      return super.shouldInterceptRequest(view, request);
    }
    if (route.kind == MapRequestPath.Kind.ASSET) {
      return asset(view, url, route.rest);
    }

    // The page shares the WebView's own origin, so this never leaves the
    // process, but MapLibre reads the image back off a canvas and needs both.
    Map<String, String> headers = new HashMap<>();
    headers.put("Access-Control-Allow-Origin", "*");
    headers.put("Cache-Control", "no-store");

    try {
      TileIntercept.Answer answer = route.kind == MapRequestPath.Kind.GEO
          ? GEO.answer(route.rest)
          : TILES.answer(route.rest);
      return new WebResourceResponse(answer.mime, null, answer.status, answer.reason, headers,
          answer.body);
    } catch (Throwable t) {
      Log.w(TAG, "map request intercept failed for " + url, t);
      return empty(500, "Tile Error", headers);
    }
  }
}
