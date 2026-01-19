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
  const url = `https://github.com/evanjt/route-matcher/releases/download/${version}/tracematch-android-${version}.zip`;
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
  const url = `https://github.com/evanjt/route-matcher/releases/download/${version}/tracematch-ios-${version}.zip`;
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
 * Build Android native libraries from source using cargo-ndk.
 */
function buildAndroidFromSource() {
  console.log("  Building Android libs from source...");
  const cratePath = path.resolve(PROJECT_ROOT, "../tracematch");
  const jniLibsDir = path.join(MODULE_DIR, "android/src/main/jniLibs");

  const targets = [
    { rust: "aarch64-linux-android", android: "arm64-v8a" },
    { rust: "armv7-linux-androideabi", android: "armeabi-v7a" },
    { rust: "x86_64-linux-android", android: "x86_64" },
    { rust: "i686-linux-android", android: "x86" },
  ];

  for (const { rust, android } of targets) {
    console.log(`    Building for ${android}...`);
    execSync(
      `cargo ndk -t ${rust} --platform 24 -o "${jniLibsDir}" build --release`,
      { cwd: cratePath, stdio: "inherit" }
    );
  }

  console.log("  Android build complete");
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
    return existsSync(frameworksDir);
  }
  return false;
}

/**
 * Check if bindings already exist.
 */
function bindingsExist() {
  const generatedTs = path.join(MODULE_DIR, "src/generated/tracematch.ts");
  const generatedCpp = path.join(MODULE_DIR, "ios/cpp/tracematch.cpp");
  return existsSync(generatedTs) && existsSync(generatedCpp);
}

/**
 * Run the pre-build setup (downloads, builds, generates, patches).
 */
async function runPreBuildSetup(platform) {
  console.log("\n[route-matcher-native] Running pre-build setup...");
  console.log(`  Platform: ${platform}`);
  console.log(`  CI: ${isCI()}`);
  console.log(`  Local Rust: ${hasLocalRust()}`);

  const version = getTracematchVersion();
  console.log(`  Tracematch version: ${version}`);

  // Step 1: Get binaries (download or build)
  if (!binariesExist(platform)) {
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
  } else {
    console.log(`\n  ${platform} binaries already exist, skipping download/build`);
  }

  // Step 2: Generate bindings
  if (!bindingsExist()) {
    generateBindings();
  } else {
    console.log("  Bindings already exist, skipping generation");
  }

  // Step 3: Apply patches
  if (platform === "android") {
    patchCppAdapter();
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
