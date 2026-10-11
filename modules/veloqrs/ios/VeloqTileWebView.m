#import "VeloqTileWebView.h"
#import "VeloqTileSchemeHandler.h"

/**
 * The library defines these in its own implementation file and declares them
 * in no header. Naming them here lets `super` and `self` be sent to them; the
 * dispatch is by name at run time, so the library's own methods are what
 * answer.
 */
@interface RNCWebViewImpl (VeloqTileConfiguration)
- (WKWebViewConfiguration *)setUpWkWebViewConfig;
- (void)visitSource;
@end

@implementation VeloqTileWebView

- (WKWebViewConfiguration *)setUpWkWebViewConfig
{
  WKWebViewConfiguration *config = [super setUpWkWebViewConfig];
  [config setURLSchemeHandler:[VeloqTileSchemeHandler new] forURLScheme:VeloqTileScheme];
  return config;
}

/**
 * A page given as a string has no address to fetch again. WebKit's reload asks
 * the base URL for it, which the tile scheme answers with an empty image, and
 * after its content process has gone it navigates nowhere at all. Loading the
 * string again is the reload a map page needs on both paths.
 */
- (void)reload
{
  if ([self.source[@"html"] isKindOfClass:[NSString class]]) {
    [self visitSource];
    return;
  }
  [super reload];
}

@end
