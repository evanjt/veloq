const { withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

/**
 * Expo config plugin that adds nil safety checks to MapLibre React Native iOS code.
 *
 * Fixes iOS crash: NSInvalidArgumentException: insertObject:atIndex: object cannot be nil
 * This occurs when React Native reconciliation adds/removes children from MapView
 * during gestures or state changes.
 *
 * Reference: https://github.com/react-native-maps/react-native-maps/issues/5217
 */

const MAPLIBRE_IOS_PATH = "node_modules/@maplibre/maplibre-react-native/ios/MLRN";

// Patch for MLRNMapView.m
const MLRN_MAP_VIEW_ORIGINAL = `#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wobjc-missing-super-calls"
- (void)insertReactSubview:(id<RCTComponent>)subview atIndex:(NSInteger)atIndex {
  [self addToMap:subview];
  [_reactSubviews insertObject:(UIView *)subview atIndex:(NSUInteger)atIndex];
}
#pragma clang diagnostic pop

#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wobjc-missing-super-calls"
- (void)removeReactSubview:(id<RCTComponent>)subview {
  // similarly, when the children are being removed we have to do the appropriate
  // underlying mapview action here.
  [self removeFromMap:subview];
  [_reactSubviews removeObject:(UIView *)subview];
  [(UIView *)subview removeFromSuperview];
}
#pragma clang diagnostic pop`;

const MLRN_MAP_VIEW_PATCHED = `#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wobjc-missing-super-calls"
- (void)insertReactSubview:(id<RCTComponent>)subview atIndex:(NSInteger)atIndex {
  // Nil safety check to prevent crash during React reconciliation
  // https://github.com/react-native-maps/react-native-maps/issues/5217
  if (subview == nil) {
    NSLog(@"[MLRNMapView] Warning: Attempted to insert nil subview at index %ld", (long)atIndex);
    return;
  }
  [self addToMap:subview];
  NSUInteger safeIndex = MIN((NSUInteger)atIndex, [_reactSubviews count]);
  [_reactSubviews insertObject:(UIView *)subview atIndex:safeIndex];
}
#pragma clang diagnostic pop

#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wobjc-missing-super-calls"
- (void)removeReactSubview:(id<RCTComponent>)subview {
  // Nil safety check to prevent crash during React reconciliation
  if (subview == nil) {
    NSLog(@"[MLRNMapView] Warning: Attempted to remove nil subview");
    return;
  }
  // similarly, when the children are being removed we have to do the appropriate
  // underlying mapview action here.
  [self removeFromMap:subview];
  [_reactSubviews removeObject:(UIView *)subview];
  [(UIView *)subview removeFromSuperview];
}
#pragma clang diagnostic pop`;

// Patch for MLRNSource.m
const MLRN_SOURCE_ORIGINAL = `#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wobjc-missing-super-calls"
- (void)insertReactSubview:(id<RCTComponent>)subview atIndex:(NSInteger)atIndex {
  if ([subview isKindOfClass:[MLRNLayer class]]) {
    MLRNLayer *layer = (MLRNLayer *)subview;

    if (_map.style != nil) {
      [layer addToMap:_map style:_map.style];
    }

    [_layers addObject:layer];
    [_reactSubviews insertObject:layer atIndex:atIndex];
  }
}
#pragma clang diagnostic pop

#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wobjc-missing-super-calls"
- (void)removeReactSubview:(id<RCTComponent>)subview {
  if ([subview isKindOfClass:[MLRNLayer class]]) {
    MLRNLayer *layer = (MLRNLayer *)subview;
    [layer removeFromMap:_map.style];
    [_layers removeObject:layer];
    [_reactSubviews removeObject:layer];
  }
}
#pragma clang diagnostic pop`;

const MLRN_SOURCE_PATCHED = `#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wobjc-missing-super-calls"
- (void)insertReactSubview:(id<RCTComponent>)subview atIndex:(NSInteger)atIndex {
  // Nil safety check to prevent crash during React reconciliation
  if (subview == nil) {
    NSLog(@"[MLRNSource] Warning: Attempted to insert nil subview at index %ld", (long)atIndex);
    return;
  }
  if ([subview isKindOfClass:[MLRNLayer class]]) {
    MLRNLayer *layer = (MLRNLayer *)subview;

    if (_map.style != nil) {
      [layer addToMap:_map style:_map.style];
    }

    [_layers addObject:layer];
    NSUInteger safeIndex = MIN((NSUInteger)atIndex, [_reactSubviews count]);
    [_reactSubviews insertObject:layer atIndex:safeIndex];
  }
}
#pragma clang diagnostic pop

#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wobjc-missing-super-calls"
- (void)removeReactSubview:(id<RCTComponent>)subview {
  // Nil safety check to prevent crash during React reconciliation
  if (subview == nil) {
    NSLog(@"[MLRNSource] Warning: Attempted to remove nil subview");
    return;
  }
  if ([subview isKindOfClass:[MLRNLayer class]]) {
    MLRNLayer *layer = (MLRNLayer *)subview;
    [layer removeFromMap:_map.style];
    [_layers removeObject:layer];
    [_reactSubviews removeObject:layer];
  }
}
#pragma clang diagnostic pop`;

// Patch for MLRNPointAnnotation.m
const MLRN_POINT_ANNOTATION_ORIGINAL = `- (void)insertReactSubview:(UIView *)subview atIndex:(NSInteger)atIndex {
  if ([subview isKindOfClass:[MLRNCallout class]]) {
    self.calloutView = (MLRNCallout *)subview;
    self.calloutView.representedObject = self;
  } else {
    [super insertReactSubview:subview atIndex:0];
  }
}

- (void)removeReactSubview:(UIView *)subview {
  if ([subview isKindOfClass:[MLRNCallout class]]) {
    self.calloutView = nil;
  } else {
    [super removeReactSubview:subview];
  }
}`;

const MLRN_POINT_ANNOTATION_PATCHED = `- (void)insertReactSubview:(UIView *)subview atIndex:(NSInteger)atIndex {
  // Nil safety check to prevent crash during React reconciliation
  if (subview == nil) {
    NSLog(@"[MLRNPointAnnotation] Warning: Attempted to insert nil subview at index %ld", (long)atIndex);
    return;
  }
  if ([subview isKindOfClass:[MLRNCallout class]]) {
    self.calloutView = (MLRNCallout *)subview;
    self.calloutView.representedObject = self;
  } else {
    [super insertReactSubview:subview atIndex:0];
  }
}

- (void)removeReactSubview:(UIView *)subview {
  // Nil safety check to prevent crash during React reconciliation
  if (subview == nil) {
    NSLog(@"[MLRNPointAnnotation] Warning: Attempted to remove nil subview");
    return;
  }
  if ([subview isKindOfClass:[MLRNCallout class]]) {
    self.calloutView = nil;
  } else {
    [super removeReactSubview:subview];
  }
}`;

function patchFile(filePath, original, patched, fileName) {
  if (!fs.existsSync(filePath)) {
    console.warn(`[with-maplibre-nil-safety] ${fileName} not found at ${filePath}`);
    return false;
  }

  let contents = fs.readFileSync(filePath, "utf8");

  // Check if already patched
  if (contents.includes("Nil safety check to prevent crash")) {
    console.log(`[with-maplibre-nil-safety] ${fileName} already patched`);
    return true;
  }

  // Apply patch
  if (contents.includes(original)) {
    contents = contents.replace(original, patched);
    fs.writeFileSync(filePath, contents);
    console.log(`[with-maplibre-nil-safety] Patched ${fileName}`);
    return true;
  } else {
    console.warn(`[with-maplibre-nil-safety] Could not find expected code in ${fileName}`);
    return false;
  }
}

function withMapLibreNilSafety(config) {
  return withDangerousMod(config, [
    "ios",
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const maplibrePath = path.join(projectRoot, MAPLIBRE_IOS_PATH);

      // Patch MLRNMapView.m
      patchFile(
        path.join(maplibrePath, "MLRNMapView.m"),
        MLRN_MAP_VIEW_ORIGINAL,
        MLRN_MAP_VIEW_PATCHED,
        "MLRNMapView.m"
      );

      // Patch MLRNSource.m
      patchFile(
        path.join(maplibrePath, "MLRNSource.m"),
        MLRN_SOURCE_ORIGINAL,
        MLRN_SOURCE_PATCHED,
        "MLRNSource.m"
      );

      // Patch MLRNPointAnnotation.m
      patchFile(
        path.join(maplibrePath, "MLRNPointAnnotation.m"),
        MLRN_POINT_ANNOTATION_ORIGINAL,
        MLRN_POINT_ANNOTATION_PATCHED,
        "MLRNPointAnnotation.m"
      );

      return config;
    },
  ]);
}

module.exports = withMapLibreNilSafety;
