/**
 * The WebView the map pages mount on Android.
 *
 * The tile interceptor is a `WebViewClient` of ours, and only a view manager of
 * ours can attach it. `nativeConfig.component` swaps the library's native
 * component for that manager's and leaves every prop, ref command and event
 * alone, so nothing else about a mount changes.
 */
import { Platform, requireNativeComponent } from 'react-native';
import type { WebViewNativeConfig } from 'react-native-webview/lib/WebViewTypes';

/** Agreed with `VeloqWebViewManager.NAME`. Nothing else ties the two. */
export const VELOQ_WEBVIEW_COMPONENT_NAME = 'VeloqWebView';

/**
 * The manager inherits the library's prop delegate, so the props it accepts are
 * the library's. `requireNativeComponent` cannot know that.
 */
type NativeWebViewComponent = NonNullable<WebViewNativeConfig['component']>;

/**
 * Undefined off Android, where the library's own component is mounted and the
 * page keeps its existing tile transport.
 */
export const veloqWebViewNativeConfig: WebViewNativeConfig | undefined =
  Platform.OS === 'android'
    ? {
        component: requireNativeComponent(
          VELOQ_WEBVIEW_COMPONENT_NAME
        ) as unknown as NativeWebViewComponent,
      }
    : undefined;
