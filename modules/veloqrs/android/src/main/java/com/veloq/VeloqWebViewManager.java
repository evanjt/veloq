package com.veloq;

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
public class VeloqWebViewManager extends RNCWebViewManager {

  /** Agreed with `VELOQ_WEBVIEW_COMPONENT_NAME` in `veloqWebView.ts`. */
  public static final String NAME = "VeloqWebView";

  @NonNull
  @Override
  public String getName() {
    return NAME;
  }

  @Override
  protected void addEventEmitters(@NonNull ThemedReactContext reactContext, RNCWebViewWrapper view) {
    // Deliberately not calling super: it sets the library's own client, and
    // the last one set wins.
    view.getWebView().setWebViewClient(new VeloqTileWebViewClient());
  }
}
