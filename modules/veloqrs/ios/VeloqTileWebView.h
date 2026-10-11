#import <react-native-webview/RNCWebViewImpl.h>

/**
 * The library's web view with the tile scheme handler registered.
 *
 * A `WKURLSchemeHandler` goes on the `WKWebViewConfiguration` before the
 * `WKWebView` exists, and the library builds that configuration in one
 * instance method, so this is the one place the handler can be attached
 * without editing the library. Its reload loads a page given as a string
 * again rather than asking the base URL, which serves no page.
 */
@interface VeloqTileWebView : RNCWebViewImpl
@end
