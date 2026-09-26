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
import type { WebViewNativeConfig } from 'react-native-webview/lib/WebViewTypes';

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
 * Undefined on the web, where the library's own component is mounted and the
 * page keeps its existing tile transport.
 */
export const veloqWebViewNativeConfig: WebViewNativeConfig | undefined =
  Platform.OS === 'android' || Platform.OS === 'ios'
    ? {
        component: requireNativeComponent(
          VELOQ_WEBVIEW_COMPONENT_NAME
        ) as unknown as NativeWebViewComponent,
      }
    : undefined;
