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
 *
 * Updated for MapLibre v11 file structure (ios/components/ instead of ios/MLRN/)
 */

// v11 uses different path structure
const MAPLIBRE_IOS_BASE = "node_modules/@maplibre/maplibre-react-native/ios";

// v11 MLRNMapView.m - note: uses UIView* instead of id<RCTComponent>
const MLRN_MAP_VIEW_ORIGINAL = `- (void)insertReactSubview:(UIView *)subview atIndex:(NSInteger)atIndex {
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

const MLRN_MAP_VIEW_PATCHED = `- (void)insertReactSubview:(UIView *)subview atIndex:(NSInteger)atIndex {
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

  // Regex to find insertReactSubview method and add nil check (handles UIView* or id<RCTComponent>)
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
      const maplibreBasePath = path.join(projectRoot, MAPLIBRE_IOS_BASE);

      console.log("[with-maplibre-nil-safety] Starting MapLibre iOS nil-safety patches...");
      console.log(`[with-maplibre-nil-safety] MapLibre path: ${maplibreBasePath}`);

      const results = {};

      // Try v11 path first, then v10 path
      const v11Path = path.join(maplibreBasePath, "components", "map-view", "MLRNMapView.m");
      const v10Path = path.join(projectRoot, "node_modules/@maplibre/maplibre-react-native/ios/MLRN/MLRNMapView.m");

      if (fs.existsSync(v11Path)) {
        results.MLRNMapView = patchFile(
          v11Path,
          MLRN_MAP_VIEW_ORIGINAL,
          MLRN_MAP_VIEW_PATCHED,
          "MLRNMapView.m",
          false // non-critical - v11 might have fixed the issue
        );
      } else if (fs.existsSync(v10Path)) {
        console.log("[with-maplibre-nil-safety] Using v10 path");
        results.MLRNMapView = patchFile(
          v10Path,
          MLRN_MAP_VIEW_ORIGINAL,
          MLRN_MAP_VIEW_PATCHED,
          "MLRNMapView.m",
          false
        );
      } else {
        console.log("[with-maplibre-nil-safety] MLRNMapView.m not found - skipping patch (v11 may not need it)");
        results.MLRNMapView = true; // Consider it "patched" if file doesn't exist
      }

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
