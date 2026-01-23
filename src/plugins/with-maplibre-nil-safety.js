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

function patchFile(filePath, original, patched, fileName, isCritical = false) {
  console.log(`[with-maplibre-nil-safety] Processing ${fileName}...`);

  if (!fs.existsSync(filePath)) {
    const msg = `[with-maplibre-nil-safety] ERROR: ${fileName} not found at ${filePath}`;
    console.error(msg);
    if (isCritical) {
      throw new Error(msg);
    }
    return false;
  }

  let contents = fs.readFileSync(filePath, "utf8");
  console.log(`[with-maplibre-nil-safety] ${fileName} size: ${contents.length} bytes`);

  // Check if already patched
  if (contents.includes("Nil safety check to prevent crash")) {
    console.log(`[with-maplibre-nil-safety] ✓ ${fileName} already patched`);
    return true;
  }

  // Try exact string match first
  if (contents.includes(original)) {
    contents = contents.replace(original, patched);
    fs.writeFileSync(filePath, contents);
    console.log(`[with-maplibre-nil-safety] ✓ Patched ${fileName} (exact match)`);
    return true;
  }

  // Fallback: try regex-based patching for insertReactSubview
  console.log(`[with-maplibre-nil-safety] Exact match failed for ${fileName}, trying regex fallback...`);

  // Regex to find insertReactSubview method and add nil check
  const insertRegex = /(- \(void\)insertReactSubview:\([^)]+\)subview atIndex:\([^)]+\)atIndex \{\n)/;
  const nilCheck = `$1  // Nil safety check to prevent crash during React reconciliation
  // https://github.com/react-native-maps/react-native-maps/issues/5217
  if (subview == nil) {
    NSLog(@"[${fileName.replace('.m', '')}] Warning: Attempted to insert nil subview at index %ld", (long)atIndex);
    return;
  }
`;

  if (insertRegex.test(contents)) {
    contents = contents.replace(insertRegex, nilCheck);
    fs.writeFileSync(filePath, contents);
    console.log(`[with-maplibre-nil-safety] ✓ Patched ${fileName} (regex fallback)`);
    return true;
  }

  // If we get here, patching failed
  const msg = `[with-maplibre-nil-safety] ERROR: Could not patch ${fileName} - no matching pattern found`;
  console.error(msg);

  // Log a snippet of the file around insertReactSubview for debugging
  const idx = contents.indexOf("insertReactSubview");
  if (idx > -1) {
    console.error(`[with-maplibre-nil-safety] Found insertReactSubview at index ${idx}`);
    console.error(`[with-maplibre-nil-safety] Context: ${contents.substring(Math.max(0, idx - 50), idx + 200).replace(/\n/g, '\\n')}`);
  } else {
    console.error(`[with-maplibre-nil-safety] insertReactSubview not found in file at all`);
  }

  if (isCritical) {
    throw new Error(msg);
  }
  return false;
}

function withMapLibreNilSafety(config) {
  return withDangerousMod(config, [
    "ios",
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const maplibrePath = path.join(projectRoot, MAPLIBRE_IOS_PATH);

      console.log("[with-maplibre-nil-safety] Starting MapLibre iOS nil-safety patches...");
      console.log(`[with-maplibre-nil-safety] MapLibre path: ${maplibrePath}`);

      const results = {};

      // Patch MLRNMapView.m - CRITICAL (this is the primary crash site)
      results.MLRNMapView = patchFile(
        path.join(maplibrePath, "MLRNMapView.m"),
        MLRN_MAP_VIEW_ORIGINAL,
        MLRN_MAP_VIEW_PATCHED,
        "MLRNMapView.m",
        true // critical - throw error if fails
      );

      // Patch MLRNSource.m
      results.MLRNSource = patchFile(
        path.join(maplibrePath, "MLRNSource.m"),
        MLRN_SOURCE_ORIGINAL,
        MLRN_SOURCE_PATCHED,
        "MLRNSource.m",
        false
      );

      // Patch MLRNPointAnnotation.m
      results.MLRNPointAnnotation = patchFile(
        path.join(maplibrePath, "MLRNPointAnnotation.m"),
        MLRN_POINT_ANNOTATION_ORIGINAL,
        MLRN_POINT_ANNOTATION_PATCHED,
        "MLRNPointAnnotation.m",
        false
      );

      // Summary
      console.log("[with-maplibre-nil-safety] ========== PATCH SUMMARY ==========");
      for (const [file, success] of Object.entries(results)) {
        console.log(`[with-maplibre-nil-safety] ${success ? "✓" : "✗"} ${file}.m`);
      }
      console.log("[with-maplibre-nil-safety] ====================================");

      return config;
    },
  ]);
}

module.exports = withMapLibreNilSafety;
