#!/usr/bin/env node

/**
 * Verifies that the MapLibre nil-safety patches have been applied.
 * Run this after npm install or prebuild to ensure the patches are in place.
 *
 * Exit codes:
 *   0 - All patches verified
 *   1 - One or more patches missing
 */

const fs = require("fs");
const path = require("path");

const MAPLIBRE_IOS_PATH = "node_modules/@maplibre/maplibre-react-native/ios/MLRN";
const PATCH_MARKER = "Nil safety check to prevent crash";

const FILES_TO_CHECK = [
  "MLRNMapView.m",
  "MLRNSource.m",
  "MLRNPointAnnotation.m",
];

function verifyPatch(fileName) {
  const filePath = path.join(MAPLIBRE_IOS_PATH, fileName);

  if (!fs.existsSync(filePath)) {
    console.log(`⚠️  ${fileName}: File not found (this is OK if not building for iOS)`);
    return null; // Not an error - file might not exist on non-iOS builds
  }

  const contents = fs.readFileSync(filePath, "utf8");
  const hasNilSafety = contents.includes(PATCH_MARKER);

  if (hasNilSafety) {
    console.log(`✓  ${fileName}: Patched`);
    return true;
  } else {
    console.log(`✗  ${fileName}: NOT PATCHED`);
    return false;
  }
}

function main() {
  console.log("Verifying MapLibre nil-safety patches...\n");

  const results = FILES_TO_CHECK.map((file) => ({
    file,
    status: verifyPatch(file),
  }));

  console.log("");

  // Check if any file that exists is not patched
  const unpatched = results.filter((r) => r.status === false);
  const patched = results.filter((r) => r.status === true);
  const notFound = results.filter((r) => r.status === null);

  if (unpatched.length > 0) {
    console.error("❌ Some MapLibre files are NOT patched!");
    console.error("   This will cause iOS crashes with error:");
    console.error("   -[__NSArrayM insertObject:atIndex:]: object cannot be nil");
    console.error("");
    console.error("   To fix, run: npx expo prebuild --clean");
    process.exit(1);
  }

  if (patched.length > 0) {
    console.log(`✅ All ${patched.length} MapLibre iOS file(s) are patched.`);
  }

  if (notFound.length === FILES_TO_CHECK.length) {
    console.log("ℹ️  No MapLibre iOS files found (not building for iOS?)");
  }

  process.exit(0);
}

main();
