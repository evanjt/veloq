#import <Foundation/Foundation.h>
#import <WebKit/WebKit.h>

/**
 * The scheme the map pages load on and ask their tiles under. Agreed with
 * `VELOQ_TILE_SCHEME` in `tileTransport.ts`. Nothing else ties the two.
 */
extern NSString *const VeloqTileScheme;

/**
 * Serves basemap tiles straight out of the Rust-owned store, and lets Rust
 * fetch and keep the tile when the store does not have it.
 *
 * `WKURLSchemeHandler` will not claim https, so the page itself loads on this
 * scheme and every tile it asks for is same-origin, which is the property the
 * Android interceptor gets for free from an https url on the page's origin.
 */
@interface VeloqTileSchemeHandler : NSObject <WKURLSchemeHandler>
@end
