package com.veloq;

import android.os.Build;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.facebook.react.bridge.LifecycleEventListener;
import com.facebook.react.bridge.ReadableMap;
import com.facebook.react.uimanager.ThemedReactContext;
import com.reactnativecommunity.webview.RNCWebView;
import com.reactnativecommunity.webview.RNCWebViewManagerImpl;
import com.reactnativecommunity.webview.RNCWebViewWrapper;

import org.json.JSONObject;

import java.util.Map;
import java.util.WeakHashMap;

/**
 * The 3D map's WebView, which keeps the last dropped page for the next 3D mount.
 *
 * <p>A later 3D open spends most of its boot in the renderer taking the page's HTML. So a
 * dropped view whose renderer is alive is kept with its document and its map released, and the
 * next mount on the same surface gets it back. When that mount's HTML carries the held page's
 * revision the load is skipped, the page confirms it still runs that revision, and it posts
 * `pageAdopted`, on which the mount injects its build call. Otherwise the HTML loads as for a
 * new view.
 */
public class VeloqMap3DWebViewManager extends VeloqWebViewManager {

  /** Agreed with `VELOQ_MAP3D_WEBVIEW_COMPONENT_NAME` in `veloqWebView.ts`. */
  public static final String NAME = "VeloqMap3DWebView";

  /** Tears the held page's map down without posting, since no mount listens to it. */
  private static final String HOLD_SCRIPT =
      "(function() { if (window.map) { try { window.map.remove(); } catch (e) {}"
          + " window.map = null; } })(); true;";

  /** Answers `adopted` after posting `pageAdopted` when the page runs `%s`, else `stale`. */
  private static final String ADOPT_SCRIPT =
      "(function() {"
          + " var m = document.querySelector('meta[name=\"veloq-page-revision\"]');"
          + " var r = m ? m.getAttribute('content') : null;"
          + " if (r !== %s || typeof window._veloqBuildMap !== 'function'"
          + " || !window.ReactNativeWebView) return 'stale';"
          + " window.ReactNativeWebView.postMessage(JSON.stringify({type: 'pageAdopted', revision: r}));"
          + " return 'adopted';"
          + " })();";

  private static final String ADOPTED = "\"adopted\"";

  private final MapWebViewSlot<RNCWebView, ThemedReactContext> slot =
      new MapWebViewSlot<>(Build.VERSION.SDK_INT, VeloqMap3DWebViewManager::destroyHeld);
  /** Only its wrapping is used, which reads none of the per-mount props. */
  private final RNCWebViewManagerImpl wrapping = new RNCWebViewManagerImpl(true);
  /** The revision of the HTML each view last loaded. */
  private final Map<RNCWebView, String> revisions = new WeakHashMap<>();
  /** A view handed back from the slot, until its first source, with the held page's revision. */
  private final Map<RNCWebViewWrapper, String> awaitingSource = new WeakHashMap<>();
  /** A source whose load was skipped, until the page confirms its revision. */
  private final Map<RNCWebViewWrapper, ReadableMap> skippedSource = new WeakHashMap<>();
  private final LifecycleEventListener hostListener = new LifecycleEventListener() {
    @Override
    public void onHostResume() {}

    @Override
    public void onHostPause() {}

    @Override
    public void onHostDestroy() {
      slot.onHostDestroy();
      afterSlotChange();
    }
  };
  @Nullable private ThemedReactContext listening;

  @NonNull
  @Override
  public String getName() {
    return NAME;
  }

  @NonNull
  @Override
  protected RNCWebViewWrapper newView(@NonNull ThemedReactContext context) {
    MapWebViewSlot.Held<RNCWebView> held = slot.take(context);
    if (held == null) return super.newView(context);
    stopListening();
    RNCWebViewWrapper view = wrapping.createViewInstance(context, held.view);
    awaitingSource.put(view, held.revision);
    return view;
  }

  @Override
  protected boolean keepDropped(@NonNull RNCWebViewWrapper view) {
    awaitingSource.remove(view);
    skippedSource.remove(view);
    RNCWebView webView = view.getWebView();
    ThemedReactContext context = webView.getThemedReactContext();
    String revision = webView.getProgress() >= 100 ? revisions.get(webView) : null;
    if (!slot.offer(webView, context, revision)) return false;
    view.removeView(webView);
    context.removeLifecycleEventListener(webView);
    webView.setWebViewClient(new WebViewClient() {
      @Override
      public boolean onRenderProcessGone(WebView gone, RenderProcessGoneDetail detail) {
        slot.rendererGone(webView);
        afterSlotChange();
        return true;
      }
    });
    webView.evaluateJavascript(HOLD_SCRIPT, null);
    listen(context);
    return true;
  }

  @Override
  protected boolean keepsViews() {
    return slot.holding();
  }

  @Override
  public void onTrimMemory(int level) {
    super.onTrimMemory(level);
    slot.onTrimMemory(level);
    afterSlotChange();
  }

  @NonNull
  @Override
  protected VeloqTileWebViewClient newClient() {
    return new VeloqTileWebViewClient() {
      @Override
      public boolean onRenderProcessGone(WebView webView, RenderProcessGoneDetail detail) {
        if (webView instanceof RNCWebView) slot.rendererGone((RNCWebView) webView);
        return super.onRenderProcessGone(webView, detail);
      }
    };
  }

  @Override
  public void setNewSource(RNCWebViewWrapper view, @Nullable ReadableMap value) {
    String incoming =
        value != null && value.hasKey("html") ? PageRevision.of(value.getString("html")) : null;
    String held = awaitingSource.remove(view);
    skippedSource.remove(view);
    if (PageRevision.adopts(held, incoming)) {
      revisions.put(view.getWebView(), held);
      skippedSource.put(view, value);
      return;
    }
    revisions.put(view.getWebView(), incoming);
    super.setNewSource(view, value);
  }

  @Override
  protected void onAfterUpdateTransaction(@NonNull RNCWebViewWrapper view) {
    super.onAfterUpdateTransaction(view);
    ReadableMap source = skippedSource.get(view);
    if (source == null) return;
    RNCWebView webView = view.getWebView();
    String expected = revisions.get(webView);
    // Read after every prop of the mount is applied, so the post reaches this mount.
    webView.evaluateJavascript(String.format(ADOPT_SCRIPT, JSONObject.quote(expected)), result -> {
      if (skippedSource.get(view) != source) return;
      skippedSource.remove(view);
      if (!ADOPTED.equals(result)) loadHtml(webView, source);
    });
  }

  /** The library's load of an HTML source. */
  private static void loadHtml(RNCWebView webView, ReadableMap source) {
    String baseUrl = source.hasKey("baseUrl") ? source.getString("baseUrl") : "";
    String html = source.getString("html");
    if (html == null) return;
    webView.loadDataWithBaseURL(baseUrl, html, "text/html", "UTF-8", null);
  }

  private static void destroyHeld(RNCWebView webView) {
    webView.setWebViewClient(null);
    webView.destroy();
  }

  private void listen(ThemedReactContext context) {
    if (listening == context) return;
    stopListening();
    context.addLifecycleEventListener(hostListener);
    listening = context;
  }

  private void stopListening() {
    if (listening == null) return;
    listening.removeLifecycleEventListener(hostListener);
    listening = null;
  }

  private void afterSlotChange() {
    if (slot.holding()) return;
    stopListening();
    releaseCallbacksWhenIdle();
  }
}
