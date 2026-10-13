#import "VeloqTileSchemeHandler.h"

NSString *const VeloqTileScheme = @"veloq-tile";

static NSString *const GeoPath = @"/veloq-geo/";
static NSString *const TilePath = @"/veloq-tile/";
static NSString *const AssetPath = @"/veloq-asset/";

/** Where the map renderer and its stylesheet sit, each named by its version. */
static NSString *const RendererDirectory = @"renderer";

/**
 * The renderer's file name changes with its version, so the web view may keep
 * it for good. Everything else is answered fresh every time.
 */
static NSString *const KeepForGood = @"public, max-age=31536000, immutable";
static NSString *const NoStore = @"no-store";

/**
 * The store's own entry, exported by the Rust static library beside the UniFFI
 * surface. See `basemap/c.rs`. `done` is called exactly once: before the call
 * returns for a tile that is held or refused, and later from a Rust thread for
 * one the tile host is asked for. The bytes it hands over go back through
 * `veloq_tile_free`.
 */
typedef void (*VeloqTileDone)(void *context, uint8_t *bytes, size_t len, uint16_t status);
extern void veloq_tile_answer(const char *source, uint32_t z, uint32_t x, uint32_t y, void *context, VeloqTileDone done);
extern void veloq_tile_free(uint8_t *bytes, size_t len);

/**
 * A glyph range the bundle lacks, fetched and kept by the store on a miss.
 * Rust checks the stack and range against what the glyph host serves. The
 * bytes go back through `veloq_tile_free`.
 */
extern uint8_t *veloq_glyph_get_or_fetch(const char *fontstack, const char *range, size_t *len, uint16_t *status);

/**
 * GeoJSON Rust writes from what it stores, for the path after the geo marker.
 * A pooled read with no network in it. The bytes go back through
 * `veloq_tile_free`.
 */
extern uint8_t *veloq_geo_get(const char *path, size_t *len, uint16_t *status);

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
@property (nonatomic, copy) NSString *cacheControl;
@end

@implementation VeloqTileAnswer
@end

static VeloqTileAnswer *answer(NSInteger status, NSString *mime, NSData *body)
{
  VeloqTileAnswer *a = [VeloqTileAnswer new];
  a.status = status;
  a.mime = mime;
  a.body = body ?: [NSData data];
  a.cacheControl = NoStore;
  return a;
}

typedef void (^VeloqTileReply)(VeloqTileAnswer *answer);

/** What a tile's answer needs once Rust hands it back, carried as the context. */
@interface VeloqTilePending : NSObject
@property (nonatomic, copy) NSString *mime;
@property (nonatomic, copy) VeloqTileReply reply;
@end

@implementation VeloqTilePending
@end

/**
 * Rust's answer to one tile. For a miss this runs on a Rust thread, which has
 * no autorelease pool of its own.
 */
static void tileDone(void *context, uint8_t *bytes, size_t len, uint16_t status)
{
  @autoreleasepool {
    VeloqTilePending *pending = (__bridge_transfer VeloqTilePending *)context;
    if (bytes == NULL || len == 0) {
      pending.reply(answer(status == 200 ? 404 : status, pending.mime, nil));
      return;
    }
    // No copy: the data owns the Rust allocation and hands it back when it goes.
    NSData *body = [[NSData alloc] initWithBytesNoCopy:bytes length:len deallocator:^(void *p, NSUInteger n) {
      veloq_tile_free(p, n);
    }];
    pending.reply(answer(200, pending.mime, body));
  }
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
  if ([extension isEqualToString:@"js"]) return @"text/javascript; charset=utf-8";
  if ([extension isEqualToString:@"css"]) return @"text/css; charset=utf-8";
  return @"application/octet-stream";
}

/**
 * The directory the renderer, sprite and glyphs are bundled in. The resource
 * bundle keeps the layout it was packed from, which is under `BasemapAssets`;
 * the root of the bundle is tried as well so a flattened copy still answers.
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
 * chooses the path, so a request stays inside the three directories the app
 * ships: an empty segment, `.`, `..`, a backslash, a NUL or any first segment
 * other than `renderer`, `sprites` or `fonts` is answered as a miss.
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
  BOOL renderer = [segments[0] isEqualToString:RendererDirectory];
  if (!renderer && ![segments[0] isEqualToString:@"sprites"] && ![segments[0] isEqualToString:@"fonts"]) {
    return answer(404, @"application/octet-stream", nil);
  }
  for (NSString *root in assetRoots()) {
    NSData *data = [NSData dataWithContentsOfFile:[root stringByAppendingPathComponent:rest]];
    if (data.length > 0) {
      VeloqTileAnswer *found = answer(200, assetMimeFor(rest), data);
      if (renderer) found.cacheControl = KeepForGood;
      return found;
    }
  }
  return answerGlyph(segments);
}

/**
 * One `veloq-geo` answer, such as an activity's line. `url.path` carries no
 * query string, which is only the page's revision, so none reaches Rust.
 */
static VeloqTileAnswer *answerGeo(NSString *rest)
{
  size_t len = 0;
  uint16_t status = 502;
  uint8_t *bytes = veloq_geo_get(rest.UTF8String, &len, &status);
  if (bytes == NULL || len == 0) {
    return answer(status == 200 ? 502 : status, @"application/geo+json", nil);
  }
  NSData *body = [[NSData alloc] initWithBytesNoCopy:bytes length:len deallocator:^(void *p, NSUInteger n) {
    veloq_tile_free(p, n);
  }];
  return answer(200, @"application/geo+json", body);
}

/**
 * Ask the store, and hand the answer to `reply`. A file, a glyph range, a geo
 * answer or a tile the store holds is answered before this returns. A tile the
 * host is asked for is answered later from a Rust thread, and this returns at
 * once. It can still wait on the disk or a glyph host, so never on the main
 * thread. The geo marker is matched first: a geo path is not `source/z/x/y`,
 * so the tile parser would refuse it as a 400.
 */
static void answerFor(NSURL *url, VeloqTileReply reply)
{
  NSString *path = url.path;
  NSRange geo = [path rangeOfString:GeoPath];
  if (geo.location != NSNotFound) {
    reply(answerGeo([path substringFromIndex:geo.location + geo.length]));
    return;
  }
  NSRange asset = [path rangeOfString:AssetPath];
  if (asset.location != NSNotFound) {
    reply(answerAsset([path substringFromIndex:asset.location + asset.length]));
    return;
  }
  NSRange at = [path rangeOfString:TilePath];
  if (at.location == NSNotFound) {
    reply(answer(404, @"image/jpeg", nil));
    return;
  }

  // <source>/<z>/<x>/<y>[.ext]
  NSArray<NSString *> *parts = [[path substringFromIndex:at.location + at.length] componentsSeparatedByString:@"/"];
  if (parts.count != 4) {
    reply(answer(400, @"image/jpeg", nil));
    return;
  }
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
    reply(answer(400, @"image/jpeg", nil));
    return;
  }

  // What Rust says the page is to be told. A 429 or a 503 is the tile host
  // asking to be left alone, and the page's throttle backoff counts only
  // those, so they cross as themselves.
  VeloqTilePending *pending = [VeloqTilePending new];
  pending.mime = mimeFor(extension);
  pending.reply = reply;
  veloq_tile_answer(source.UTF8String, z, x, y, (__bridge_retained void *)pending, tileDone);
}

@implementation VeloqTileSchemeHandler {
  /**
   * The tasks WebKit has started and not stopped, each with the operation that
   * answers it. Answering a stopped task is a WebKit exception, and a tile
   * host answers on its own time, so the answer checks membership first.
   * WebKit starts and stops tasks on the main thread and wants its answers
   * there, so this table is only ever touched on the main thread and needs no
   * lock.
   */
  NSMapTable<id<WKURLSchemeTask>, NSOperation *> *_live;
  /**
   * Where the store is asked, a few at a time. A tile miss leaves it at once,
   * but a disk read, a glyph fetch or the daily TileJSON still waits here, and
   * a fast pan starts and stops tasks far quicker than those finish. A shared
   * global queue would take a thread per waiting task. This caps them, and a
   * task stopped before its turn is dropped without asking anything.
   */
  NSOperationQueue *_work;
}

- (instancetype)init
{
  if (self = [super init]) {
    _live = [NSMapTable mapTableWithKeyOptions:NSPointerFunctionsObjectPointerPersonality | NSPointerFunctionsStrongMemory
                                  valueOptions:NSPointerFunctionsStrongMemory];
    _work = [NSOperationQueue new];
    _work.name = @"veloq-tile";
    _work.maxConcurrentOperationCount = 6;
    _work.qualityOfService = NSQualityOfServiceUserInitiated;
  }
  return self;
}

- (void)webView:(WKWebView *)webView startURLSchemeTask:(id<WKURLSchemeTask>)task
{
  NSURL *url = task.request.URL;
  __weak VeloqTileSchemeHandler *weakSelf = self;
  VeloqTileReply reply = ^(VeloqTileAnswer *a) {
    dispatch_async(dispatch_get_main_queue(), ^{
      VeloqTileSchemeHandler *strongSelf = weakSelf;
      if (strongSelf == nil || [strongSelf->_live objectForKey:task] == nil) return;
      [strongSelf->_live removeObjectForKey:task];

      // The page shares the scheme, so this never leaves the process, but
      // MapLibre reads the image back off a canvas and needs the header.
      NSDictionary *headers = @{
        @"Content-Type" : a.mime,
        @"Content-Length" : [NSString stringWithFormat:@"%lu", (unsigned long)a.body.length],
        @"Access-Control-Allow-Origin" : @"*",
        @"Cache-Control" : a.cacheControl,
      };
      NSHTTPURLResponse *response = [[NSHTTPURLResponse alloc] initWithURL:url
                                                                statusCode:a.status
                                                               HTTPVersion:@"HTTP/1.1"
                                                              headerFields:headers];
      [task didReceiveResponse:response];
      if (a.body.length > 0) [task didReceiveData:a.body];
      [task didFinish];
    });
  };

  NSBlockOperation *operation = [NSBlockOperation new];
  __weak NSBlockOperation *weakOperation = operation;
  [operation addExecutionBlock:^{
    if (weakOperation.isCancelled) return;
    answerFor(url, reply);
  }];
  [_live setObject:operation forKey:task];
  [_work addOperation:operation];
}

- (void)webView:(WKWebView *)webView stopURLSchemeTask:(id<WKURLSchemeTask>)task
{
  [[_live objectForKey:task] cancel];
  [_live removeObjectForKey:task];
}

@end
