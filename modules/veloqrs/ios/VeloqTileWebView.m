#import "VeloqTileWebView.h"
#import "VeloqTileSchemeHandler.h"

/**
 * The library defines this in its own implementation file and declares it in
 * no header. Naming it here lets `super` be sent to it; the dispatch is by
 * name at run time, so the library's own method is what answers.
 */
@interface RNCWebViewImpl (VeloqTileConfiguration)
- (WKWebViewConfiguration *)setUpWkWebViewConfig;
@end

@implementation VeloqTileWebView

- (WKWebViewConfiguration *)setUpWkWebViewConfig
{
  WKWebViewConfiguration *config = [super setUpWkWebViewConfig];
  [config setURLSchemeHandler:[VeloqTileSchemeHandler new] forURLScheme:VeloqTileScheme];
  return config;
}

@end
