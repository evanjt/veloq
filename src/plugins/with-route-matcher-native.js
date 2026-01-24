const { execSync, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const https = require("https");
const { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } = fs;

/**
 * Expo config plugin for route-matcher-native module.
 *
 * This plugin:
 * 1. Detects local dev vs CI environment
 * 2. Downloads pre-built binaries (CI) or builds from source (local with Rust)
 * 3. Generates TypeScript/C++ bindings with uniffi-bindgen-react-native
 * 4. Patches generated files for React Native 0.81+ compatibility
 * 5. Injects iOS pod into Podfile
 */

const MODULE_DIR = path.resolve(__dirname, "../modules/route-matcher-native");
const PROJECT_ROOT = path.resolve(__dirname, "../..");

/**
 * Check if we're running in CI environment.
 */
function isCI() {
  return process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";
}

/**
 * Check if local Rust development is available.
 */
function hasLocalRust() {
  if (process.env.VELOQ_LOCAL_RUST === "1") return true;
  if (process.env.VELOQ_LOCAL_RUST === "0") return false;
  const cargoToml = path.resolve(PROJECT_ROOT, "../tracematch/Cargo.toml");
  if (!existsSync(cargoToml)) return false;
  try { execSync("cargo --version", { stdio: "ignore" }); return true; } catch { return false; }
}

/**
 * Get tracematch version from package.json.
 */
function getTracematchVersion() {
  const pkgPath = path.join(PROJECT_ROOT, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  return pkg.tracematchVersion;
}

/**
 * Download a file from URL.
 */
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);
    https
      .get(url, (response) => {
        // Handle redirects
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          file.close();
          fs.unlinkSync(dest);
          return downloadFile(response.headers.location, dest).then(resolve).catch(reject);
        }
        if (response.statusCode !== 200) {
          file.close();
          fs.unlinkSync(dest);
          return reject(new Error(`Failed to download: ${response.statusCode}`));
        }
        response.pipe(file);
        file.on("finish", () => {
          file.close();
          resolve();
        });
      })
      .on("error", (err) => {
        file.close();
        fs.unlinkSync(dest);
        reject(err);
      });
  });
}

/**
 * Download and extract Android native libraries.
 */
async function downloadAndroidLibs(version) {
  const url = `https://github.com/evanjt/tracematch/releases/download/${version}/tracematch-android-${version}.zip`;
  const jniLibsDir = path.join(MODULE_DIR, "android/src/main/jniLibs");
  const tempZip = path.join(PROJECT_ROOT, "tmp-android.zip");

  console.log(`  Downloading Android libs from ${url}...`);
  mkdirSync(path.dirname(tempZip), { recursive: true });

  await downloadFile(url, tempZip);

  // Extract using unzip
  const tempExtract = path.join(PROJECT_ROOT, "tmp-android-extract");
  mkdirSync(tempExtract, { recursive: true });
  execSync(`unzip -q -o "${tempZip}" -d "${tempExtract}"`);

  // Copy jniLibs
  mkdirSync(jniLibsDir, { recursive: true });
  const sourceJniLibs = path.join(tempExtract, "android/jniLibs");
  if (existsSync(sourceJniLibs)) {
    execSync(`cp -r "${sourceJniLibs}"/* "${jniLibsDir}/"`);
  }

  // Cleanup
  fs.unlinkSync(tempZip);
  fs.rmSync(tempExtract, { recursive: true, force: true });

  console.log("  Android libs installed");
}

/**
 * Download and extract iOS framework and bindings.
 */
async function downloadIOSFramework(version) {
  const url = `https://github.com/evanjt/tracematch/releases/download/${version}/tracematch-ios-${version}.zip`;
  const frameworksDir = path.join(MODULE_DIR, "ios/Frameworks");
  const generatedDir = path.join(MODULE_DIR, "ios/Generated");
  const tempZip = path.join(PROJECT_ROOT, "tmp-ios.zip");

  console.log(`  Downloading iOS framework from ${url}...`);
  mkdirSync(path.dirname(tempZip), { recursive: true });

  await downloadFile(url, tempZip);

  // Extract using unzip
  const tempExtract = path.join(PROJECT_ROOT, "tmp-ios-extract");
  mkdirSync(tempExtract, { recursive: true });
  execSync(`unzip -q -o "${tempZip}" -d "${tempExtract}"`);

  // Install XCFramework (rename to match podspec expectation)
  mkdirSync(frameworksDir, { recursive: true });
  const xcframeworkDest = path.join(frameworksDir, "TracematchFFI.xcframework");
  if (existsSync(xcframeworkDest)) {
    fs.rmSync(xcframeworkDest, { recursive: true, force: true });
  }
  const sourceXcframework = path.join(tempExtract, "ios/RouteMatcherFFI.xcframework");
  if (existsSync(sourceXcframework)) {
    execSync(`cp -r "${sourceXcframework}" "${xcframeworkDest}"`);
  }

  // Install Swift bindings
  mkdirSync(generatedDir, { recursive: true });
  const sourceGenerated = path.join(tempExtract, "ios/Generated");
  if (existsSync(sourceGenerated)) {
    for (const file of ["tracematch.swift", "tracematchFFI.h", "tracematchFFI.modulemap"]) {
      const src = path.join(sourceGenerated, file);
      if (existsSync(src)) {
        fs.copyFileSync(src, path.join(generatedDir, file));
      }
    }
  }

  // Cleanup
  fs.unlinkSync(tempZip);
  fs.rmSync(tempExtract, { recursive: true, force: true });

  console.log("  iOS framework installed");
}

/**
 * Detect connected Android device architecture via ADB.
 */
function detectAndroidArch() {
  try {
    // Get list of connected devices
    const devices = execSync("adb devices 2>/dev/null", { encoding: "utf8" })
      .split("\n")
      .filter((line) => line.includes("\tdevice"))
      .map((line) => line.split("\t")[0]);

    if (devices.length === 0) return null;

    // Get primary ABI from first device
    const abi = execSync(`adb -s ${devices[0]} shell getprop ro.product.cpu.abi 2>/dev/null`, {
      encoding: "utf8",
    }).trim();

    return abi || null;
  } catch {
    return null;
  }
}

/**
 * Build Android native libraries from source using cargo-ndk.
 * Only builds for detected device arch, or all if no device connected.
 * Copies from tracematch/target if already built, otherwise builds.
 */
function buildAndroidFromSource() {
  const cratePath = path.resolve(PROJECT_ROOT, "../tracematch");
  const jniLibsDir = path.join(MODULE_DIR, "android/src/main/jniLibs");

  const allTargets = [
    { rust: "aarch64-linux-android", android: "arm64-v8a" },
    { rust: "armv7-linux-androideabi", android: "armeabi-v7a" },
    { rust: "x86_64-linux-android", android: "x86_64" },
    { rust: "i686-linux-android", android: "x86" },
  ];

  // Detect device architecture
  const detectedArch = detectAndroidArch();
  let targets = allTargets;

  if (detectedArch) {
    const target = allTargets.find((t) => t.android === detectedArch);
    if (target) {
      targets = [target];
      console.log(`  Detected device: ${detectedArch}`);
    }
  } else {
    console.log("  No device detected, building all architectures");
  }

  // Process each target
  for (const { rust, android } of targets) {
    const targetDir = path.join(jniLibsDir, android);
    const localSo = path.join(targetDir, "libtracematch.so");
    const tracematchSo = path.join(cratePath, "target", rust, "release", "libtracematch.so");

    // Always clear local copy first
    if (existsSync(localSo)) {
      fs.unlinkSync(localSo);
    }
    mkdirSync(targetDir, { recursive: true });

    // Check if pre-built exists in tracematch/target
    if (existsSync(tracematchSo)) {
      console.log(`    Copying ${android} from cache`);
      fs.copyFileSync(tracematchSo, localSo);
    } else {
      // Build this architecture
      console.log(`    Building ${android}...`);
      execSync(
        `cargo ndk -t ${rust} --platform 24 -o "${jniLibsDir}" build --release --features ffi`,
        { cwd: cratePath, stdio: "inherit" }
      );
    }
  }

  // Write build info
  const gitHash = execSync("git rev-parse --short HEAD", { cwd: cratePath, encoding: "utf8" }).trim();
  let dirty = "";
  try {
    execSync("git diff --quiet", { cwd: cratePath });
  } catch {
    dirty = "-dirty";
  }
  const timestamp = new Date().toISOString().replace(/[:-]/g, "").slice(0, 15);
  const buildInfo = path.join(jniLibsDir, "BUILD_INFO");
  writeFileSync(buildInfo, `Build: ${gitHash}${dirty}-${timestamp}\nArchs: ${targets.map((t) => t.android).join(" ")}\nDate: ${new Date()}\n`);

  console.log(`  Android ready: ${gitHash}${dirty}`);
}

/**
 * Build iOS framework from source.
 */
function buildIOSFromSource() {
  console.log("  Building iOS framework from source...");
  const cratePath = path.resolve(PROJECT_ROOT, "../tracematch");
  const frameworksDir = path.join(MODULE_DIR, "ios/Frameworks");

  // Build for all iOS targets
  const targets = ["aarch64-apple-ios", "aarch64-apple-ios-sim", "x86_64-apple-ios"];

  for (const target of targets) {
    console.log(`    Building for ${target}...`);
    execSync(`cargo build --target ${target} --release`, {
      cwd: cratePath,
      stdio: "inherit",
    });
  }

  // Create XCFramework using xcodebuild
  mkdirSync(frameworksDir, { recursive: true });
  const xcframeworkPath = path.join(frameworksDir, "TracematchFFI.xcframework");

  // This is a simplified version - full xcframework creation requires lipo and xcodebuild
  console.log("    Creating XCFramework...");
  const targetDir = path.join(cratePath, "target");

  execSync(
    `xcodebuild -create-xcframework \
      -library ${targetDir}/aarch64-apple-ios/release/libtracematch.a -headers ${cratePath}/bindings/swift \
      -library ${targetDir}/aarch64-apple-ios-sim/release/libtracematch.a -headers ${cratePath}/bindings/swift \
      -output "${xcframeworkPath}"`,
    { stdio: "inherit" }
  );

  console.log("  iOS build complete");
}

/**
 * Generate TypeScript/C++ bindings using uniffi-bindgen-react-native.
 */
function generateBindings() {
  console.log("  Generating bindings with uniffi-bindgen-react-native...");

  // Run from module directory where ubrn.config.yaml is located
  execSync("npx uniffi-bindgen-react-native generate turbo-module tracematch", {
    cwd: MODULE_DIR,
    stdio: "inherit",
  });

  console.log("  Bindings generated");
}

/**
 * Copy cpp files from module's cpp directory to ios/cpp for Xcode build.
 * This must run AFTER generateBindings() since that creates the cpp files.
 */
function copyIOSCppFiles() {
  const moduleCppDir = path.join(MODULE_DIR, "cpp");
  const iosCppDir = path.join(MODULE_DIR, "ios/cpp");

  if (!existsSync(moduleCppDir)) {
    console.log("  Warning: cpp directory not found, skipping iOS cpp copy");
    return;
  }

  mkdirSync(iosCppDir, { recursive: true });
  const cppExtensions = [".h", ".hpp", ".cpp"];
  const files = fs.readdirSync(moduleCppDir);
  let copied = 0;
  for (const file of files) {
    if (cppExtensions.some((ext) => file.endsWith(ext))) {
      fs.copyFileSync(path.join(moduleCppDir, file), path.join(iosCppDir, file));
      copied++;
    }
  }
  if (copied > 0) {
    console.log(`  Copied ${copied} cpp files to ios/cpp`);
  }
}

/**
 * Patch generated route-matcher-native.cpp to fix include path.
 * uniffi-bindgen-react-native generates #include "/tracematch.hpp" which is wrong.
 */
function patchGeneratedCpp() {
  const cppFile = path.join(MODULE_DIR, "cpp/route-matcher-native.cpp");

  if (!existsSync(cppFile)) {
    return;
  }

  let content = readFileSync(cppFile, "utf8");
  if (content.includes('"/tracematch.hpp"')) {
    console.log("  Patching route-matcher-native.cpp include path...");
    content = content.replace('"/tracematch.hpp"', '"tracematch.hpp"');
    writeFileSync(cppFile, content);
    console.log("  route-matcher-native.cpp patched");
  }
}

/**
 * Patch CMakeLists.txt to use 'veloq' library name instead of 'route-matcher-native'.
 * VeloqModule.kt loads System.loadLibrary("veloq") so we need libveloq.so.
 */
function patchCMakeLists() {
  const cmakeFile = path.join(MODULE_DIR, "android/CMakeLists.txt");

  if (!existsSync(cmakeFile)) {
    return;
  }

  let content = readFileSync(cmakeFile, "utf8");
  if (content.includes("add_library(route-matcher-native")) {
    console.log("  Patching CMakeLists.txt to use veloq library name...");
    content = content.replace(/route-matcher-native\.cpp/g, "veloq.cpp");
    content = content.replace(/add_library\(route-matcher-native/g, "add_library(veloq");
    content = content.replace(/target_link_libraries\(route-matcher-native/g, "target_link_libraries(veloq");
    content = content.replace(/target_link_libraries\(\s*route-matcher-native/g, "target_link_libraries(\n  veloq");
    writeFileSync(cmakeFile, content);
    console.log("  CMakeLists.txt patched");
  }
}

/**
 * Remove auto-generated files that conflict with our custom Veloq module.
 * uniffi-bindgen-react-native generates RouteMatcherNative* files but we use Veloq*.
 */
function removeConflictingGeneratedFiles() {
  const filesToRemove = [
    path.join(MODULE_DIR, "src/NativeRouteMatcherNative.ts"),
    path.join(MODULE_DIR, "android/src/main/java/com/veloq/RouteMatcherNativeModule.kt"),
    path.join(MODULE_DIR, "android/src/main/java/com/veloq/RouteMatcherNativePackage.kt"),
    path.join(MODULE_DIR, "ios/RouteMatcherNative.h"),
    path.join(MODULE_DIR, "ios/RouteMatcherNative.mm"),
  ];

  for (const file of filesToRemove) {
    if (existsSync(file)) {
      console.log(`  Removing conflicting ${path.basename(file)}...`);
      fs.unlinkSync(file);
    }
  }
}

/**
 * Patch cpp-adapter.cpp for React Native 0.81+ compatibility.
 */
function patchCppAdapter() {
  const adapterFile = path.join(MODULE_DIR, "android/cpp-adapter.cpp");

  if (!existsSync(adapterFile)) {
    console.log("  cpp-adapter.cpp not found, skipping patch");
    return;
  }

  const content = readFileSync(adapterFile, "utf8");
  if (content.includes("jni::static_ref_cast")) {
    console.log("  cpp-adapter.cpp already patched");
    return;
  }

  console.log("  Patching cpp-adapter.cpp for RN 0.81+...");

  const patchedContent = `// Generated by uniffi-bindgen-react-native
// Patched for React Native 0.81+ compatibility (CallInvokerHolder changes)
#include <jni.h>
#include <jsi/jsi.h>
#include <fbjni/fbjni.h>
#include <ReactCommon/CallInvokerHolder.h>
#include "tracematch.hpp"

namespace jsi = facebook::jsi;
namespace react = facebook::react;
namespace jni = facebook::jni;

extern "C"
JNIEXPORT jboolean JNICALL
Java_com_veloq_VeloqModule_nativeInstallRustCrate(
    JNIEnv *env,
    jclass type,
    jlong rtPtr,
    jobject callInvokerHolderJavaObj
) {
    // Use fbjni to properly extract the CallInvoker from the Java holder object
    // This approach is compatible with React Native 0.76+ (new architecture)
    auto callInvokerHolder = jni::static_ref_cast<react::CallInvokerHolder::javaobject>(
        jni::make_local(callInvokerHolderJavaObj)
    );
    auto jsCallInvoker = callInvokerHolder->cthis()->getCallInvoker();

    auto runtime = reinterpret_cast<jsi::Runtime *>(rtPtr);
    NativeTracematch::registerModule(*runtime, jsCallInvoker);
    return true;
}

extern "C"
JNIEXPORT jboolean JNICALL
Java_com_veloq_VeloqModule_nativeCleanupRustCrate(JNIEnv *env, jclass type, jlong rtPtr) {
    auto runtime = reinterpret_cast<jsi::Runtime *>(rtPtr);
    NativeTracematch::unregisterModule(*runtime);
    return true;
}
`;

  writeFileSync(adapterFile, patchedContent);
  console.log("  cpp-adapter.cpp patched");
}

/**
 * Check if binaries already exist.
 */
function binariesExist(platform) {
  if (platform === "android") {
    const jniLibsDir = path.join(MODULE_DIR, "android/src/main/jniLibs/arm64-v8a");
    return existsSync(path.join(jniLibsDir, "libtracematch.so"));
  } else if (platform === "ios") {
    const frameworksDir = path.join(MODULE_DIR, "ios/Frameworks/TracematchFFI.xcframework");
    const iosCppDir = path.join(MODULE_DIR, "ios/cpp");
    // Check both xcframework and cpp files exist
    return (
      existsSync(frameworksDir) &&
      existsSync(path.join(iosCppDir, "veloq.cpp")) &&
      existsSync(path.join(iosCppDir, "tracematch.hpp"))
    );
  }
  return false;
}

/**
 * Check if bindings already exist.
 * We check for both the generated tracematch.ts AND our custom index.ts with routeEngine wrapper.
 */
function bindingsExist() {
  const generatedTs = path.join(MODULE_DIR, "src/generated/tracematch.ts");
  const indexTs = path.join(MODULE_DIR, "src/index.ts");

  // Check generated bindings exist
  if (!existsSync(generatedTs)) return false;

  // Check our custom index.ts exists and has the routeEngine wrapper
  if (existsSync(indexTs)) {
    const content = readFileSync(indexTs, "utf8");
    if (content.includes("routeEngine") && content.includes("NativeVeloq")) {
      return true; // Our custom version exists, don't regenerate
    }
  }

  return false;
}

/**
 * Check if all patches are already applied.
 */
function allPatchesApplied(platform) {
  // Check cpp-adapter.cpp is patched (Android only)
  if (platform === "android") {
    const adapterFile = path.join(MODULE_DIR, "android/cpp-adapter.cpp");
    if (existsSync(adapterFile)) {
      const content = readFileSync(adapterFile, "utf8");
      if (!content.includes("jni::static_ref_cast")) return false;
    }
  }
  return true;
}

/**
 * Run the pre-build setup (downloads, builds, generates, patches).
 */
async function runPreBuildSetup(platform) {
  const hasBinaries = binariesExist(platform);
  const hasBindings = bindingsExist();
  const hasPatches = allPatchesApplied(platform);

  // Quick exit if everything is ready - single line output
  if (hasBinaries && hasBindings && hasPatches) {
    console.log(`[route-matcher-native] ${platform} ready`);
    return;
  }

  // Verbose output only when work needs to be done
  console.log("\n[route-matcher-native] Running pre-build setup...");
  console.log(`  Platform: ${platform}`);
  console.log(`  CI: ${isCI()}`);
  console.log(`  Local Rust: ${hasLocalRust()}`);

  const version = getTracematchVersion();
  console.log(`  Tracematch version: ${version}`);

  // Step 1: Get binaries (download or build)
  if (!hasBinaries) {
    if (isCI() || !hasLocalRust()) {
      // Download pre-built binaries
      console.log("\n  Downloading pre-built binaries...");
      if (platform === "android") {
        await downloadAndroidLibs(version);
      } else if (platform === "ios") {
        await downloadIOSFramework(version);
      }
    } else {
      // Build from source
      console.log("\n  Building from source...");
      if (platform === "android") {
        buildAndroidFromSource();
      } else if (platform === "ios") {
        buildIOSFromSource();
      }
    }
  }

  // Step 2: Generate bindings
  if (!hasBindings) {
    generateBindings();
  }

  // Step 3: Apply patches
  patchGeneratedCpp();
  removeConflictingGeneratedFiles();
  if (platform === "android") {
    patchCMakeLists();
    patchCppAdapter();
  } else if (platform === "ios") {
    // Copy cpp files to ios/cpp after bindings are generated
    copyIOSCppFiles();
  }

  console.log("\n[route-matcher-native] Pre-build setup complete!\n");
}

/**
 * Main plugin function.
 */
module.exports = function withRouteMatcherNative(config) {
  // Determine platform from environment or config
  const platform = process.env.EXPO_PLATFORM || "android";

  // Run pre-build setup synchronously (Expo plugins don't support async well)
  // We use a workaround with spawnSync to handle the async download
  const setupScript = `
    const setup = require('${__filename.replace(/\\/g, "\\\\")}');
    setup._runPreBuildSetup('${platform}').catch(console.error);
  `;

  // For now, run setup synchronously in a subprocess
  try {
    const result = spawnSync(
      "node",
      ["-e", `require('${__filename.replace(/'/g, "\\'")}')._runSetupSync('${platform}')`],
      {
        stdio: "inherit",
        cwd: PROJECT_ROOT,
        env: { ...process.env, FORCE_COLOR: "1" },
      }
    );

    if (result.status !== 0) {
      console.warn("[route-matcher-native] Pre-build setup had warnings or errors");
    }
  } catch (error) {
    console.warn("[route-matcher-native] Pre-build setup failed:", error.message);
  }

  // iOS pod is auto-linked via expo-modules-autolinking, no manual injection needed
  return config;
};

// Export for synchronous setup call
module.exports._runSetupSync = function (platform) {
  // Run the async setup and wait for it
  runPreBuildSetup(platform)
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("Setup failed:", error);
      process.exit(1);
    });
};

// Export for testing
module.exports._runPreBuildSetup = runPreBuildSetup;
