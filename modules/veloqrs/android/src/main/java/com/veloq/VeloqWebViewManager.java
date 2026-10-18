package com.veloq;

import android.content.ComponentCallbacks2;
import android.content.Context;
import android.content.res.Configuration;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import androidx.annotation.NonNull;

import com.facebook.react.uimanager.ThemedReactContext;
import com.reactnativecommunity.webview.RNCWebViewManager;
import com.reactnativecommunity.webview.RNCWebViewWrapper;

/**
 * The library's WebView with our tile interceptor attached.
 *
 * <p>The prop delegate, the ref commands and the events are all inherited, so
 * a mount that selects this component through `nativeConfig` behaves exactly
 * as the library's own does.
 */
public class VeloqWebViewManager extends RNCWebViewManager implements ComponentCallbacks2 {

  /** Agreed with `VELOQ_WEBVIEW_COMPONENT_NAME` in `veloqWebView.ts`. */
  public static final String NAME = "VeloqWebView";
  private static final String RELEASE_MAP_SCRIPT =
      "(function() { if (window._veloqReleasableMap && window.map) {"
          + "try { window.map.remove(); } catch (e) {}"
          + "window.map = null;"
          + "window.ReactNativeWebView.postMessage(JSON.stringify({type: 'nativeMapReleased'}));"
          + "} })(); true;";

  private final Handler mainHandler = new Handler(Looper.getMainLooper());
  private final MapWebViewReclaimer<RNCWebViewWrapper> reclaimer =
      new MapWebViewReclaimer<>(Build.VERSION.SDK_INT, mainHandler::post,
          VeloqWebViewManager::releaseMap);
  private Context applicationContext;

  @NonNull
  @Override
  public String getName() {
    return NAME;
  }

  @NonNull
  @Override
  public RNCWebViewWrapper createViewInstance(@NonNull ThemedReactContext context) {
    if (applicationContext == null) {
      applicationContext = context.getApplicationContext();
      applicationContext.registerComponentCallbacks(this);
    }
    RNCWebViewWrapper view = newView(context);
    reclaimer.add(view);
    return view;
  }

  /** The view a mount gets. */
  @NonNull
  protected RNCWebViewWrapper newView(@NonNull ThemedReactContext context) {
    return super.createViewInstance(context);
  }

  @Override
  public void onDropViewInstance(@NonNull RNCWebViewWrapper view) {
    reclaimer.remove(view);
    if (!keepDropped(view)) super.onDropViewInstance(view);
    releaseCallbacksWhenIdle();
  }

  /** True when the view is kept rather than destroyed, which then is the caller's to do. */
  protected boolean keepDropped(@NonNull RNCWebViewWrapper view) {
    return false;
  }

  /** True while the manager keeps a view no mount holds, which still answers a trim. */
  protected boolean keepsViews() {
    return false;
  }

  /** Stops listening for trims once no view is mounted or kept. */
  protected final void releaseCallbacksWhenIdle() {
    if (reclaimer.empty() && !keepsViews() && applicationContext != null) {
      applicationContext.unregisterComponentCallbacks(this);
      applicationContext = null;
    }
  }

  @Override
  public void onTrimMemory(int level) {
    reclaimer.onTrimMemory(level);
  }

  /** Tears down a view's page map in place, keeping its document. */
  protected static void releaseMap(@NonNull RNCWebViewWrapper view) {
    view.getWebView().evaluateJavascript(RELEASE_MAP_SCRIPT, null);
  }

  @Override
  public void onConfigurationChanged(@NonNull Configuration configuration) {}

  @SuppressWarnings("deprecation")
  @Override
  public void onLowMemory() {
    onTrimMemory(ComponentCallbacks2.TRIM_MEMORY_COMPLETE);
  }

  @Override
  protected void addEventEmitters(@NonNull ThemedReactContext reactContext, RNCWebViewWrapper view) {
    // Deliberately not calling super: it sets the library's own client, and
    // the last one set wins.
    view.getWebView().setWebViewClient(newClient());
  }

  @NonNull
  protected VeloqTileWebViewClient newClient() {
    return new VeloqTileWebViewClient();
  }
}
