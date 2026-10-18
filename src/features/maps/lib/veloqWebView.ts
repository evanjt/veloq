/**
 * The WebView the map pages mount.
 *
 * The tile interceptor is a `WebViewClient` of ours on Android and a
 * `WKURLSchemeHandler` of ours on iOS, and only a view manager of ours can
 * attach either. `nativeConfig.component` swaps the library's native component
 * for that manager's and leaves every prop, ref command and event alone, so
 * nothing else about a mount changes.
 */
import { Platform, requireNativeComponent } from 'react-native';
import type { WebView as LibraryWebView } from 'react-native-webview';
import type { WebViewNativeConfig } from 'react-native-webview/lib/WebViewTypes';

/**
 * What a mounted WebView's ref holds: its injection and reload commands. The library's class
 * declares the extra props a caller may add as `undefined` by default, and its props intersected
 * with `undefined` are `never`, so a mount names this extra-props type: `<WebView<object> ...>`.
 */
export type WebViewHandle = LibraryWebView<object>;

/**
 * Agreed with `VeloqWebViewManager.NAME` on Android and the manager's
 * `RCT_EXPORT_MODULE` name on iOS. Nothing else ties them.
 */
export const VELOQ_WEBVIEW_COMPONENT_NAME = 'VeloqWebView';

/**
 * The manager inherits the library's prop delegate, so the props it accepts are
 * the library's. `requireNativeComponent` cannot know that.
 */
type NativeWebViewComponent = NonNullable<WebViewNativeConfig['component']>;

/**
 * Agreed with `VeloqMap3DWebViewManager.NAME` on Android: the same manager, which also keeps
 * the last dropped 3D page for the next 3D mount. iOS has no such manager.
 */
export const VELOQ_MAP3D_WEBVIEW_COMPONENT_NAME = 'VeloqMap3DWebView';

/**
 * Empty on the web, where no component is named, so the library mounts its own
 * and the page keeps its existing tile transport.
 */
export const veloqWebViewNativeConfig: WebViewNativeConfig =
  Platform.OS === 'android' || Platform.OS === 'ios'
    ? {
        component: requireNativeComponent(
          VELOQ_WEBVIEW_COMPONENT_NAME
        ) as unknown as NativeWebViewComponent,
      }
    : {};

/**
 * What the 3D map mounts. A held page is handed only to another 3D page, so the
 * 2D surfaces and the snapshot workers keep `veloqWebViewNativeConfig`.
 */
export const veloqMap3DWebViewNativeConfig: WebViewNativeConfig =
  Platform.OS === 'android'
    ? {
        component: requireNativeComponent(
          VELOQ_MAP3D_WEBVIEW_COMPONENT_NAME
        ) as unknown as NativeWebViewComponent,
      }
    : veloqWebViewNativeConfig;
