const { execSync, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { existsSync, mkdirSync, readFileSync, writeFileSync } = fs;

/**
 * Expo config plugin for veloqrs native module.
 *
 * This plugin:
 * 1. Detects local dev vs CI environment
 * 2. Builds from source (local with Rust) or uses pre-built binaries (CI)
 * 3. Generates TypeScript/C++ bindings with uniffi-bindgen-react-native
 * 4. Patches generated files for React Native 0.81+ compatibility
 */

const MODULE_DIR = path.resolve(__dirname, "../../modules/veloqrs");
const PROJECT_ROOT = path.resolve(__dirname, "../..");
const RUST_DIR = path.join(MODULE_DIR, "rust");

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
  const cargoToml = path.join(RUST_DIR, "veloqrs/Cargo.toml");
  if (!existsSync(cargoToml)) return false;
  try { execSync("cargo --version", { stdio: "ignore" }); return true; } catch { return false; }
}

/**
 * Detect connected Android device architecture via ADB.
 */
function detectAndroidArch() {
  try {
    const devices = execSync("adb devices 2>/dev/null", { encoding: "utf8" })
      .split("\n")
      .filter((line) => line.includes("\tdevice"))
      .map((line) => line.split("\t")[0]);

    if (devices.length === 0) return null;

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
 */
function buildAndroidFromSource() {
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
    const localSo = path.join(targetDir, "libveloqrs.so");
    const builtSo = path.join(RUST_DIR, "target", rust, "release", "libveloqrs.so");

    // Always clear local copy first
    if (existsSync(localSo)) {
      fs.unlinkSync(localSo);
    }
    mkdirSync(targetDir, { recursive: true });

    // Check if pre-built exists in rust/target
    if (existsSync(builtSo)) {
      console.log(`    Copying ${android} from cache`);
      fs.copyFileSync(builtSo, localSo);
    } else {
      // Build this architecture
      console.log(`    Building ${android}...`);
      execSync(
        `cargo ndk -t ${rust} --platform 24 -o "${jniLibsDir}" build --release -p veloqrs`,
        { cwd: RUST_DIR, stdio: "inherit" }
      );
    }
  }

  // Write build info
  const gitHash = execSync("git rev-parse --short HEAD", { cwd: RUST_DIR, encoding: "utf8" }).trim();
  let dirty = "";
  try {
    execSync("git diff --quiet", { cwd: RUST_DIR });
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
  const frameworksDir = path.join(MODULE_DIR, "ios/Frameworks");

  const targets = ["aarch64-apple-ios", "aarch64-apple-ios-sim", "x86_64-apple-ios"];

  for (const target of targets) {
    console.log(`    Building for ${target}...`);
    execSync(`cargo build --target ${target} --release -p veloqrs`, {
      cwd: RUST_DIR,
      stdio: "inherit",
    });
  }

  // Create XCFramework using xcodebuild
  mkdirSync(frameworksDir, { recursive: true });
  const xcframeworkPath = path.join(frameworksDir, "VeloqrsFFI.xcframework");
  const targetDir = path.join(RUST_DIR, "target");

  // Remove existing xcframework
  if (existsSync(xcframeworkPath)) {
    fs.rmSync(xcframeworkPath, { recursive: true, force: true });
  }

  console.log("    Creating XCFramework...");
  execSync(
    `xcodebuild -create-xcframework \
      -library ${targetDir}/aarch64-apple-ios/release/libveloqrs.a \
      -library ${targetDir}/aarch64-apple-ios-sim/release/libveloqrs.a \
      -output "${xcframeworkPath}"`,
    { stdio: "inherit" }
  );

  console.log("  iOS build complete");
}

/**
 * Generate TypeScript/C++ bindings using uniffi-bindgen-react-native.
 * Uses the build command with --and-generate which properly generates all bindings.
 */
function generateBindings() {
  console.log("  Generating bindings with uniffi-bindgen-react-native...");

  // The library file must exist for binding generation
  const libPath = path.join(MODULE_DIR, "android/src/main/jniLibs/arm64-v8a/libveloqrs.so");

  if (!existsSync(libPath)) {
    console.log("  Warning: Library not found, skipping bindings generation");
    return;
  }

  // Use the build command with --and-generate to generate all bindings correctly
  // This generates both C++ (cpp/generated/) and TypeScript (src/generated/) bindings
  execSync(
    `npx uniffi-bindgen-react-native build android --release --and-generate --targets arm64-v8a`,
    { cwd: MODULE_DIR, stdio: "inherit" }
  );

  // Run the fix-includes script
  execSync("./scripts/fix-generated.sh", { cwd: MODULE_DIR, stdio: "inherit" });

  console.log("  Bindings generated");
}

/**
 * Copy cpp files from module's cpp directory to ios/cpp for Xcode build.
 * Handles both cpp/ (turbo module) and cpp/generated/ (bindings) directories.
 */
function copyIOSCppFiles() {
  const moduleCppDir = path.join(MODULE_DIR, "cpp");
  const moduleGeneratedDir = path.join(MODULE_DIR, "cpp/generated");
  const iosCppDir = path.join(MODULE_DIR, "ios/cpp");

  if (!existsSync(moduleCppDir)) {
    console.log("  Warning: cpp directory not found, skipping iOS cpp copy");
    return;
  }

  mkdirSync(iosCppDir, { recursive: true });
  const cppExtensions = [".h", ".hpp", ".cpp"];
  let copied = 0;

  // Copy turbo module files from cpp/
  const turboFiles = fs.readdirSync(moduleCppDir);
  for (const file of turboFiles) {
    const filePath = path.join(moduleCppDir, file);
    if (fs.statSync(filePath).isFile() && cppExtensions.some((ext) => file.endsWith(ext))) {
      fs.copyFileSync(filePath, path.join(iosCppDir, file));
      copied++;
    }
  }

  // Copy bindings files from cpp/generated/
  if (existsSync(moduleGeneratedDir)) {
    const generatedFiles = fs.readdirSync(moduleGeneratedDir);
    for (const file of generatedFiles) {
      if (cppExtensions.some((ext) => file.endsWith(ext))) {
        fs.copyFileSync(path.join(moduleGeneratedDir, file), path.join(iosCppDir, file));
        copied++;
      }
    }
  }

  if (copied > 0) {
    console.log(`  Copied ${copied} cpp files to ios/cpp`);
  }
}

/**
 * Patch generated cpp files for include path issues.
 * uniffi-bindgen-react-native sometimes generates incorrect include paths.
 */
function patchGeneratedCpp() {
  const cppFile = path.join(MODULE_DIR, "cpp/veloqrs.cpp");

  if (!existsSync(cppFile)) {
    return;
  }

  let content = readFileSync(cppFile, "utf8");
  let modified = false;

  // Fix absolute include path bug in uniffi-bindgen-react-native
  if (content.includes('"/generated/veloqrs.hpp"')) {
    content = content.replace('"/generated/veloqrs.hpp"', '"generated/veloqrs.hpp"');
    modified = true;
  }

  if (modified) {
    console.log("  Patching veloqrs.cpp include paths...");
    writeFileSync(cppFile, content);
  }
}

/**
 * Restore custom index.ts if it was overwritten by uniffi generation.
 */
function restoreCustomIndexTs() {
  const indexTs = path.join(MODULE_DIR, "src/index.ts");
  if (existsSync(indexTs)) {
    const content = readFileSync(indexTs, "utf8");
    // Our custom index.ts exports routeEngine - if it's missing, restore from git
    if (!content.includes("routeEngine")) {
      console.log("  Restoring custom index.ts from git...");
      try {
        execSync("git checkout HEAD -- src/index.ts", { cwd: MODULE_DIR, stdio: "ignore" });
        console.log("  Restored custom index.ts");
      } catch {
        console.log("  Warning: Could not restore index.ts from git");
      }
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
#include "veloqrs.hpp"

namespace jsi = facebook::jsi;
namespace react = facebook::react;
namespace jni = facebook::jni;

extern "C"
JNIEXPORT jboolean JNICALL
Java_com_veloq_VeloqrsModule_nativeInstallRustCrate(
    JNIEnv *env,
    jclass type,
    jlong rtPtr,
    jobject callInvokerHolderJavaObj
) {
    auto callInvokerHolder = jni::static_ref_cast<react::CallInvokerHolder::javaobject>(
        jni::make_local(callInvokerHolderJavaObj)
    );
    auto jsCallInvoker = callInvokerHolder->cthis()->getCallInvoker();

    auto runtime = reinterpret_cast<jsi::Runtime *>(rtPtr);
    NativeVeloqrs::registerModule(*runtime, jsCallInvoker);
    return true;
}

extern "C"
JNIEXPORT jboolean JNICALL
Java_com_veloq_VeloqrsModule_nativeCleanupRustCrate(JNIEnv *env, jclass type, jlong rtPtr) {
    auto runtime = reinterpret_cast<jsi::Runtime *>(rtPtr);
    NativeVeloqrs::unregisterModule(*runtime);
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
    return existsSync(path.join(jniLibsDir, "libveloqrs.so"));
  } else if (platform === "ios") {
    const frameworksDir = path.join(MODULE_DIR, "ios/Frameworks/VeloqrsFFI.xcframework");
    const iosCppDir = path.join(MODULE_DIR, "ios/cpp");
    return (
      existsSync(frameworksDir) &&
      existsSync(path.join(iosCppDir, "veloqrs.cpp")) &&
      existsSync(path.join(iosCppDir, "veloqrs.hpp"))
    );
  }
  return false;
}

/**
 * Check if bindings already exist (both TypeScript AND C++).
 */
function bindingsExist() {
  const generatedTs = path.join(MODULE_DIR, "src/generated/veloqrs.ts");
  const generatedCpp = path.join(MODULE_DIR, "cpp/generated/veloqrs.cpp");
  const generatedHpp = path.join(MODULE_DIR, "cpp/generated/veloqrs.hpp");
  const indexTs = path.join(MODULE_DIR, "src/index.ts");

  // Must have both TypeScript and C++ bindings
  if (!existsSync(generatedTs)) return false;
  if (!existsSync(generatedCpp) || !existsSync(generatedHpp)) return false;

  if (existsSync(indexTs)) {
    const content = readFileSync(indexTs, "utf8");
    if (content.includes("NativeVeloq")) {
      return true;
    }
  }

  return false;
}

/**
 * Check if all patches are already applied.
 */
function allPatchesApplied(platform) {
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
 * Run the pre-build setup.
 */
async function runPreBuildSetup(platform) {
  const hasBinaries = binariesExist(platform);
  const hasBindings = bindingsExist();
  const hasPatches = allPatchesApplied(platform);

  if (hasBinaries && hasBindings && hasPatches) {
    console.log(`[veloqrs] ${platform} ready`);
    return;
  }

  console.log("\n[veloqrs] Running pre-build setup...");
  console.log(`  Platform: ${platform}`);
  console.log(`  CI: ${isCI()}`);
  console.log(`  Local Rust: ${hasLocalRust()}`);

  // For local development: build + generate in one step
  // Rust incremental build is fast if nothing changed
  if (!hasBinaries || !hasBindings) {
    if (isCI()) {
      // In CI, binaries should be pre-built by separate workflow jobs
      console.log("  Warning: Binaries/bindings not found in CI - they should be pre-built");
    } else if (hasLocalRust()) {
      console.log("\n  Building and generating bindings...");
      if (platform === "android") {
        // Single command: builds Rust (incremental), copies .so, generates all bindings
        const arch = detectAndroidArch() || "arm64-v8a";
        console.log(`  Target architecture: ${arch}`);
        execSync(
          `npx uniffi-bindgen-react-native build android --release --and-generate --targets ${arch}`,
          { cwd: MODULE_DIR, stdio: "inherit" }
        );
        execSync("./scripts/fix-generated.sh", { cwd: MODULE_DIR, stdio: "inherit" });
      } else if (platform === "ios") {
        buildIOSFromSource();
        generateBindings();
      }
    } else {
      console.log("  Error: No pre-built binaries and no local Rust available");
      console.log("  Please install Rust or ensure CI has built the binaries");
    }
  }

  // Step 3: Apply patches
  patchGeneratedCpp();
  restoreCustomIndexTs();
  if (platform === "android") {
    patchCppAdapter();
  } else if (platform === "ios") {
    copyIOSCppFiles();
  }

  console.log("\n[veloqrs] Pre-build setup complete!\n");
}

/**
 * Main plugin function.
 */
module.exports = function withVeloqrs(config) {
  const platform = process.env.EXPO_PLATFORM || "android";

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
      console.warn("[veloqrs] Pre-build setup had warnings or errors");
    }
  } catch (error) {
    console.warn("[veloqrs] Pre-build setup failed:", error.message);
  }

  return config;
};

// Export for synchronous setup call
module.exports._runSetupSync = function (platform) {
  runPreBuildSetup(platform)
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("Setup failed:", error);
      process.exit(1);
    });
};

// Export for testing
module.exports._runPreBuildSetup = runPreBuildSetup;
