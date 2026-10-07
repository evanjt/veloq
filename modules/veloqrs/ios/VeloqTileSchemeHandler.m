#import "VeloqTileSchemeHandler.h"

NSString *const VeloqTileScheme = @"veloq-tile";

static NSString *const TilePath = @"/veloq-tile/";
static NSString *const AssetPath = @"/veloq-asset/";

/**
 * The store's own entry, exported by the Rust static library beside the UniFFI
 * surface. See `basemap/c.rs`. The bytes stay Rust's until they are freed.
 */
extern uint8_t *veloq_tile_get_or_fetch(const char *source, uint32_t z, uint32_t x, uint32_t y, size_t *len, uint16_t *status);
extern void veloq_tile_free(uint8_t *bytes, size_t len);

/**
 * A glyph range the bundle lacks, fetched and kept by the store on a miss.
 * Rust checks the stack and range against what the glyph host serves. The
 * bytes go back through `veloq_tile_free`.
 */
extern uint8_t *veloq_glyph_get_or_fetch(const char *fontstack, const char *range, size_t *len, uint16_t *status);

/**
 * What the bytes are, from the extension the page asked for, never from the
 * source name. The fallback is imagery because that is what a template naming
 * no extension is: several satellite hosts carry z/x/y in query parameters
 * and end in no path extension at all, while the vector source always names
 * `pbf`.
 */
static NSString *mimeFor(NSString *extension)
{
  if ([extension isEqualToString:@"pbf"] || [extension isEqualToString:@"mvt"]) return @"application/x-protobuf";
  if ([extension isEqualToString:@"png"]) return @"image/png";
  if ([extension isEqualToString:@"webp"]) return @"image/webp";
  return @"image/jpeg";
}

/** A tile index is digits and nothing else. `integerValue` would take "12abc". */
static BOOL parseIndex(NSString *text, uint32_t *out)
{
  if (text.length == 0 || text.length > 9) return NO;
  NSCharacterSet *digits = [NSCharacterSet decimalDigitCharacterSet];
  if ([text rangeOfCharacterFromSet:digits.invertedSet].location != NSNotFound) return NO;
  *out = (uint32_t)text.integerValue;
  return YES;
}

/** One answer, built off the main thread. */
@interface VeloqTileAnswer : NSObject
@property (nonatomic) NSInteger status;
@property (nonatomic, copy) NSString *mime;
@property (nonatomic, strong) NSData *body;
@end

@implementation VeloqTileAnswer
@end

static VeloqTileAnswer *answer(NSInteger status, NSString *mime, NSData *body)
{
  VeloqTileAnswer *a = [VeloqTileAnswer new];
  a.status = status;
  a.mime = mime;
  a.body = body ?: [NSData data];
  return a;
}

/**
 * What the bytes are, from the extension of the file asked for.
 */
static NSString *assetMimeFor(NSString *path)
{
  NSString *extension = path.pathExtension.lowercaseString;
  if ([extension isEqualToString:@"json"]) return @"application/json";
  if ([extension isEqualToString:@"png"]) return @"image/png";
  if ([extension isEqualToString:@"pbf"]) return @"application/x-protobuf";
  return @"application/octet-stream";
}

/**
 * The directory the sprite and glyphs are bundled in. The resource bundle keeps
 * the layout it was packed from, which is under `BasemapAssets`; the root of
 * the bundle is tried as well so a flattened copy still answers.
 */
static NSArray<NSString *> *assetRoots(void)
{
  static NSArray<NSString *> *roots;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    NSBundle *owner = [NSBundle bundleForClass:[VeloqTileSchemeHandler class]];
    NSString *bundlePath = [owner pathForResource:@"VeloqBasemap" ofType:@"bundle"];
    NSString *base = bundlePath ?: owner.resourcePath;
    roots = @[ [base stringByAppendingPathComponent:@"BasemapAssets"], base ];
  });
  return roots;
}

/**
 * The glyph range the bundle lacks, from the store or the glyph host. A path
 * that is not `fonts/<stack>/<range>.pbf` is a miss.
 */
static VeloqTileAnswer *answerGlyph(NSArray<NSString *> *segments)
{
  NSString *file = segments.lastObject;
  if (segments.count != 3 || ![segments[0] isEqualToString:@"fonts"] || ![file.pathExtension isEqualToString:@"pbf"]) {
    return answer(404, @"application/x-protobuf", nil);
  }
  size_t len = 0;
  uint16_t status = 502;
  uint8_t *bytes = veloq_glyph_get_or_fetch(segments[1].UTF8String, file.stringByDeletingPathExtension.UTF8String, &len, &status);
  if (bytes == NULL || len == 0) {
    return answer(status == 200 ? 404 : status, @"application/x-protobuf", nil);
  }
  NSData *body = [[NSData alloc] initWithBytesNoCopy:bytes length:len deallocator:^(void *p, NSUInteger n) {
    veloq_tile_free(p, n);
  }];
  return answer(200, @"application/x-protobuf", body);
}

/**
 * A file the app carries, a glyph range fetched on a miss, or a 404 at once
 * for a path it does not. The page
 * chooses the path, so a request stays inside the two directories the app
 * ships: an empty segment, `.`, `..`, a backslash, a NUL or any first segment
 * other than `sprites` or `fonts` is answered as a miss.
 */
static VeloqTileAnswer *answerAsset(NSString *rest)
{
  NSArray<NSString *> *segments = [rest componentsSeparatedByString:@"/"];
  if (segments.count < 2) return answer(404, @"application/octet-stream", nil);
  for (NSString *segment in segments) {
    if (segment.length == 0 || [segment isEqualToString:@"."] || [segment isEqualToString:@".."]) {
      return answer(404, @"application/octet-stream", nil);
    }
  }
  if ([rest containsString:@"\\"] || [rest containsString:@"\0"]) return answer(404, @"application/octet-stream", nil);
  if (![segments[0] isEqualToString:@"sprites"] && ![segments[0] isEqualToString:@"fonts"]) {
    return answer(404, @"application/octet-stream", nil);
  }
  for (NSString *root in assetRoots()) {
    NSData *data = [NSData dataWithContentsOfFile:[root stringByAppendingPathComponent:rest]];
    if (data.length > 0) return answer(200, assetMimeFor(rest), data);
  }
  return answerGlyph(segments);
}

/** Ask the store. Blocks, so never on the main thread. */
static VeloqTileAnswer *answerFor(NSURL *url)
{
  NSString *path = url.path;
  NSRange asset = [path rangeOfString:AssetPath];
  if (asset.location != NSNotFound) return answerAsset([path substringFromIndex:asset.location + asset.length]);
  NSRange at = [path rangeOfString:TilePath];
  if (at.location == NSNotFound) return answer(404, @"image/jpeg", nil);

  // <source>/<z>/<x>/<y>[.ext]
  NSArray<NSString *> *parts = [[path substringFromIndex:at.location + at.length] componentsSeparatedByString:@"/"];
  if (parts.count != 4) return answer(400, @"image/jpeg", nil);
  NSString *source = parts[0];
  NSString *last = parts[3];
  NSString *extension = @"";
  NSRange dot = [last rangeOfString:@"."];
  if (dot.location != NSNotFound) {
    extension = [last substringFromIndex:dot.location + 1].lowercaseString;
    last = [last substringToIndex:dot.location];
  }
  uint32_t z, x, y;
  if (!parseIndex(parts[1], &z) || !parseIndex(parts[2], &x) || !parseIndex(last, &y)) {
    return answer(400, @"image/jpeg", nil);
  }

  // What Rust says the page is to be told. A 429 or a 503 is the tile host
  // asking to be left alone, and the page's throttle backoff counts only
  // those, so they cross as themselves. It starts at 502 so a call that
  // returns without writing it reads as a failure, not a refusal.
  size_t len = 0;
  uint16_t status = 502;
  uint8_t *bytes = veloq_tile_get_or_fetch(source.UTF8String, z, x, y, &len, &status);
  if (bytes == NULL || len == 0) {
    return answer(status == 200 ? 404 : status, mimeFor(extension), nil);
  }
  // No copy: the data owns the Rust allocation and hands it back when it goes.
  NSData *body = [[NSData alloc] initWithBytesNoCopy:bytes length:len deallocator:^(void *p, NSUInteger n) {
    veloq_tile_free(p, n);
  }];
  return answer(200, mimeFor(extension), body);
}

@implementation VeloqTileSchemeHandler {
  /**
   * The tasks WebKit has started and not stopped. Answering a stopped task is
   * a WebKit exception, and the store call finishes on its own time, so the
   * answer checks membership first. WebKit starts and stops tasks on the main
   * thread and wants its answers there, so this set is only ever touched on
   * the main thread and needs no lock.
   */
  NSHashTable<id<WKURLSchemeTask>> *_live;
}

- (instancetype)init
{
  if (self = [super init]) {
    _live = [NSHashTable hashTableWithOptions:NSPointerFunctionsObjectPointerPersonality | NSPointerFunctionsStrongMemory];
  }
  return self;
}

- (void)webView:(WKWebView *)webView startURLSchemeTask:(id<WKURLSchemeTask>)task
{
  [_live addObject:task];
  NSURL *url = task.request.URL;
  __weak VeloqTileSchemeHandler *weakSelf = self;
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    VeloqTileAnswer *a = answerFor(url);
    dispatch_async(dispatch_get_main_queue(), ^{
      VeloqTileSchemeHandler *strongSelf = weakSelf;
      if (strongSelf == nil || ![strongSelf->_live containsObject:task]) return;
      [strongSelf->_live removeObject:task];

      // The page shares the scheme, so this never leaves the process, but
      // MapLibre reads the image back off a canvas and needs the header.
      NSDictionary *headers = @{
        @"Content-Type" : a.mime,
        @"Content-Length" : [NSString stringWithFormat:@"%lu", (unsigned long)a.body.length],
        @"Access-Control-Allow-Origin" : @"*",
        @"Cache-Control" : @"no-store",
      };
      NSHTTPURLResponse *response = [[NSHTTPURLResponse alloc] initWithURL:url
                                                                statusCode:a.status
                                                               HTTPVersion:@"HTTP/1.1"
                                                              headerFields:headers];
      [task didReceiveResponse:response];
      if (a.body.length > 0) [task didReceiveData:a.body];
      [task didFinish];
    });
  });
}

- (void)webView:(WKWebView *)webView stopURLSchemeTask:(id<WKURLSchemeTask>)task
{
  [_live removeObject:task];
}

@end
