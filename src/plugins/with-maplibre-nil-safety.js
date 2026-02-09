const { withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

/**
 * Expo config plugin that adds nil safety and index clamping to MapLibre React Native iOS code.
 *
 * Fixes two iOS crashes:
 * 1. NSInvalidArgumentException: insertObject:atIndex: object cannot be nil
 * 2. NSRangeException: index N beyond bounds [0 .. M] in insertReactSubview:atIndex:
 *
 * Both occur when React Native reconciliation adds/removes children from MapView
 * during gestures, state changes, or viewport culling.
 *
 * Reference: https://github.com/react-native-maps/react-native-maps/issues/5217
 *
 * Patches: MLRNMapView.m (insert/remove) and MLRNSource.m (insert)
 * Supports both v10 (id<RCTComponent>) and v11 (UIView*) signatures.
 */

const MAPLIBRE_IOS_BASE = "node_modules/@maplibre/maplibre-react-native/ios";
const LOG_PREFIX = "[with-maplibre-nil-safety]";

// ============================================================
// MLRNMapView.m exact match strings
// ============================================================

// v10 uses id<RCTComponent> parameter type
const MLRN_MAP_VIEW_V10_ORIGINAL = `- (void)insertReactSubview:(id<RCTComponent>)subview atIndex:(NSInteger)atIndex {
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
}`;

const MLRN_MAP_VIEW_V10_PATCHED = `- (void)insertReactSubview:(id<RCTComponent>)subview atIndex:(NSInteger)atIndex {
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
}`;

// v11 uses UIView* parameter type
const MLRN_MAP_VIEW_V11_ORIGINAL = `- (void)insertReactSubview:(UIView *)subview atIndex:(NSInteger)atIndex {
  [self addToMap:subview];
  [_reactSubviews insertObject:(UIView *)subview atIndex:(NSUInteger)atIndex];
}
#pragma clang diagnostic pop

#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wobjc-missing-super-calls"
- (void)removeReactSubview:(UIView *)subview {
  // similarly, when the children are being removed we have to do the appropriate
  // underlying mapview action here.
  [self removeFromMap:subview];
  [_reactSubviews removeObject:(UIView *)subview];
  [(UIView *)subview removeFromSuperview];
}`;

const MLRN_MAP_VIEW_V11_PATCHED = `- (void)insertReactSubview:(UIView *)subview atIndex:(NSInteger)atIndex {
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
- (void)removeReactSubview:(UIView *)subview {
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
}`;

// ============================================================
// MLRNSource.m exact match strings
// ============================================================

const MLRN_SOURCE_ORIGINAL = `- (void)insertReactSubview:(id<RCTComponent>)subview atIndex:(NSInteger)atIndex {
  if ([subview isKindOfClass:[MLRNLayer class]]) {
    MLRNLayer *layer = (MLRNLayer *)subview;

    if (_map.style != nil) {
      [layer addToMap:_map style:_map.style];
    }

    [_layers addObject:layer];
    [_reactSubviews insertObject:layer atIndex:atIndex];
  }
}`;

const MLRN_SOURCE_PATCHED = `- (void)insertReactSubview:(id<RCTComponent>)subview atIndex:(NSInteger)atIndex {
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
}`;

// ============================================================
// Patching logic
// ============================================================

function patchMapView(filePath, fileName) {
  console.log(`${LOG_PREFIX} Processing ${fileName}...`);

  if (!fs.existsSync(filePath)) {
    console.error(`${LOG_PREFIX} ERROR: ${fileName} not found at ${filePath}`);
    return false;
  }

  let contents = fs.readFileSync(filePath, "utf8");
  console.log(`${LOG_PREFIX} ${fileName} size: ${contents.length} bytes`);

  // Check if already patched
  if (contents.includes("Nil safety check to prevent crash")) {
    console.log(`${LOG_PREFIX} \u2713 ${fileName} already patched`);
    return true;
  }

  // Try v10 exact match first (id<RCTComponent>)
  if (contents.includes(MLRN_MAP_VIEW_V10_ORIGINAL)) {
    contents = contents.replace(
      MLRN_MAP_VIEW_V10_ORIGINAL,
      MLRN_MAP_VIEW_V10_PATCHED,
    );
    fs.writeFileSync(filePath, contents);
    console.log(`${LOG_PREFIX} \u2713 Patched ${fileName} (exact match, v10)`);
    return true;
  }

  // Try v11 exact match (UIView*)
  if (contents.includes(MLRN_MAP_VIEW_V11_ORIGINAL)) {
    contents = contents.replace(
      MLRN_MAP_VIEW_V11_ORIGINAL,
      MLRN_MAP_VIEW_V11_PATCHED,
    );
    fs.writeFileSync(filePath, contents);
    console.log(`${LOG_PREFIX} \u2713 Patched ${fileName} (exact match, v11)`);
    return true;
  }

  // Fallback: regex-based patching for insertReactSubview
  console.log(
    `${LOG_PREFIX} Exact match failed for ${fileName}, trying regex fallback...`,
  );

  let patched = false;

  // Regex to add nil check + index clamping to insertReactSubview
  const insertRegex =
    /(- \(void\)insertReactSubview:\([^)]+\)subview atIndex:\([^)]+\)atIndex \{\n)([\s\S]*?)(\[_reactSubviews insertObject:\(UIView \*\)subview atIndex:\(NSUInteger\)atIndex\])/;

  if (insertRegex.test(contents)) {
    contents = contents.replace(
      insertRegex,
      `$1  // Nil safety check to prevent crash during React reconciliation\n` +
        `  if (subview == nil) {\n` +
        `    NSLog(@"[${fileName.replace(".m", "")}] Warning: Attempted to insert nil subview at index %ld", (long)atIndex);\n` +
        `    return;\n` +
        `  }\n` +
        `$2NSUInteger safeIndex = MIN((NSUInteger)atIndex, [_reactSubviews count]);\n` +
        `  [_reactSubviews insertObject:(UIView *)subview atIndex:safeIndex]`,
    );
    patched = true;
    console.log(
      `${LOG_PREFIX} \u2713 Patched ${fileName} insertReactSubview (regex fallback)`,
    );
  }

  // Regex to add nil check to removeReactSubview
  const removeRegex = /(- \(void\)removeReactSubview:\([^)]+\)subview \{\n)/;
  if (
    removeRegex.test(contents) &&
    !contents.includes("Attempted to remove nil subview")
  ) {
    contents = contents.replace(
      removeRegex,
      `$1  // Nil safety check to prevent crash during React reconciliation\n` +
        `  if (subview == nil) {\n` +
        `    NSLog(@"[${fileName.replace(".m", "")}] Warning: Attempted to remove nil subview");\n` +
        `    return;\n` +
        `  }\n`,
    );
    patched = true;
    console.log(
      `${LOG_PREFIX} \u2713 Patched ${fileName} removeReactSubview (regex fallback)`,
    );
  }

  if (patched) {
    fs.writeFileSync(filePath, contents);
    return true;
  }

  // If we get here, patching failed
  console.error(
    `${LOG_PREFIX} ERROR: Could not patch ${fileName} - no matching pattern found`,
  );

  const idx = contents.indexOf("insertReactSubview");
  if (idx > -1) {
    console.error(`${LOG_PREFIX} Found insertReactSubview at index ${idx}`);
    console.error(
      `${LOG_PREFIX} Context: ${contents.substring(Math.max(0, idx - 50), idx + 200).replace(/\n/g, "\\n")}`,
    );
  } else {
    console.error(`${LOG_PREFIX} insertReactSubview not found in file at all`);
  }

  return false;
}

function patchSource(filePath, fileName) {
  console.log(`${LOG_PREFIX} Processing ${fileName}...`);

  if (!fs.existsSync(filePath)) {
    console.log(`${LOG_PREFIX} ${fileName} not found - skipping`);
    return true; // Not critical
  }

  let contents = fs.readFileSync(filePath, "utf8");

  // Check if already patched
  if (contents.includes("Nil safety check to prevent crash")) {
    console.log(`${LOG_PREFIX} \u2713 ${fileName} already patched`);
    return true;
  }

  // Try exact match
  if (contents.includes(MLRN_SOURCE_ORIGINAL)) {
    contents = contents.replace(MLRN_SOURCE_ORIGINAL, MLRN_SOURCE_PATCHED);
    fs.writeFileSync(filePath, contents);
    console.log(`${LOG_PREFIX} \u2713 Patched ${fileName} (exact match)`);
    return true;
  }

  // Fallback: regex for the insertObject line in MLRNSource
  const sourceInsertRegex =
    /(\[_reactSubviews insertObject:layer atIndex:)(atIndex)(\])/;
  if (sourceInsertRegex.test(contents)) {
    // Add nil check at method start
    const methodRegex =
      /(- \(void\)insertReactSubview:\([^)]+\)subview atIndex:\([^)]+\)atIndex \{\n)/;
    if (methodRegex.test(contents)) {
      contents = contents.replace(
        methodRegex,
        `$1  // Nil safety check to prevent crash during React reconciliation\n` +
          `  if (subview == nil) {\n` +
          `    NSLog(@"[MLRNSource] Warning: Attempted to insert nil subview at index %ld", (long)atIndex);\n` +
          `    return;\n` +
          `  }\n`,
      );
    }
    // Clamp index
    contents = contents.replace(
      sourceInsertRegex,
      `NSUInteger safeIndex = MIN((NSUInteger)atIndex, [_reactSubviews count]);\n    $1safeIndex$3`,
    );
    fs.writeFileSync(filePath, contents);
    console.log(`${LOG_PREFIX} \u2713 Patched ${fileName} (regex fallback)`);
    return true;
  }

  console.log(
    `${LOG_PREFIX} WARNING: Could not patch ${fileName} - no matching pattern found`,
  );
  return false;
}

function withMapLibreNilSafety(config) {
  return withDangerousMod(config, [
    "ios",
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const maplibreBasePath = path.join(projectRoot, MAPLIBRE_IOS_BASE);

      console.log(`${LOG_PREFIX} Starting MapLibre iOS nil-safety patches...`);
      console.log(`${LOG_PREFIX} MapLibre path: ${maplibreBasePath}`);

      const results = {};

      // ---- MLRNMapView.m ----
      // Try v10 path first (MLRN/), then v11 path (components/map-view/)
      const v10MapViewPath = path.join(
        maplibreBasePath,
        "MLRN",
        "MLRNMapView.m",
      );
      const v11MapViewPath = path.join(
        maplibreBasePath,
        "components",
        "map-view",
        "MLRNMapView.m",
      );

      if (fs.existsSync(v10MapViewPath)) {
        console.log(`${LOG_PREFIX} Using v10 path (ios/MLRN/)`);
        results.MLRNMapView = patchMapView(v10MapViewPath, "MLRNMapView.m");
      } else if (fs.existsSync(v11MapViewPath)) {
        console.log(`${LOG_PREFIX} Using v11 path (ios/components/map-view/)`);
        results.MLRNMapView = patchMapView(v11MapViewPath, "MLRNMapView.m");
      } else {
        console.log(
          `${LOG_PREFIX} MLRNMapView.m not found at either path - skipping`,
        );
        results.MLRNMapView = true;
      }

      // ---- MLRNSource.m ----
      const v10SourcePath = path.join(maplibreBasePath, "MLRN", "MLRNSource.m");
      const v11SourcePath = path.join(
        maplibreBasePath,
        "components",
        "MLRNSource.m",
      );

      if (fs.existsSync(v10SourcePath)) {
        results.MLRNSource = patchSource(v10SourcePath, "MLRNSource.m");
      } else if (fs.existsSync(v11SourcePath)) {
        results.MLRNSource = patchSource(v11SourcePath, "MLRNSource.m");
      } else {
        console.log(`${LOG_PREFIX} MLRNSource.m not found - skipping`);
        results.MLRNSource = true;
      }

      // Summary
      console.log(`${LOG_PREFIX} ========== PATCH SUMMARY ==========`);
      for (const [file, success] of Object.entries(results)) {
        console.log(`${LOG_PREFIX} ${success ? "\u2713" : "\u2717"} ${file}.m`);
      }
      console.log(`${LOG_PREFIX} ====================================`);

      return config;
    },
  ]);
}

module.exports = withMapLibreNilSafety;
