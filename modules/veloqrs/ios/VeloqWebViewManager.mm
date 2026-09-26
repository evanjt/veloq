#import <react-native-webview/RNCWebViewManager.h>

#import "VeloqTileWebView.h"

/**
 * The library's view manager creating our web view instead of its own.
 *
 * Under Fabric the library's own component never goes through a manager, so
 * a manager of ours is reached by the legacy interop layer, which mounts any
 * registered `RCTViewManager` under its module name. The props, the ref
 * commands and the events are all inherited, so a mount that selects this
 * component through `nativeConfig` behaves exactly as the library's own does.
 */
@interface VeloqWebViewManager : RNCWebViewManager
@end

@implementation VeloqWebViewManager

/** Agreed with `VELOQ_WEBVIEW_COMPONENT_NAME` in `veloqWebView.ts`. */
RCT_EXPORT_MODULE(VeloqWebView)

- (UIView *)view
{
  return [[VeloqTileWebView alloc] init];
}

@end
