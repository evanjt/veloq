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
 * Remove obsolete iOS files from old turboModule.name config.
 * With turboModule.name: Veloqrs (matching crate name), ubrn generates
 * correct Veloqrs.h/Veloqrs.mm. The old Veloq.h/Veloq.mm are no longer needed.
 */
function cleanupIOSGeneratedConflicts() {
  const obsoleteFiles = [
    path.join(MODULE_DIR, "ios/Veloq.h"),
    path.join(MODULE_DIR, "ios/Veloq.mm"),
  ];

  for (const file of obsoleteFiles) {
    if (existsSync(file)) {
      console.log(`  Removing obsolete file: ${path.basename(file)}`);
      fs.unlinkSync(file);
    }
  }
}

/**
 * Move XCFramework to the location expected by the podspec.
 * ubrn puts it at module root, podspec expects it in ios/Frameworks/.
 */
function moveIOSXCFramework() {
  const srcPath = path.join(MODULE_DIR, "VeloqrsFFI.xcframework");
  const destDir = path.join(MODULE_DIR, "ios/Frameworks");
  const destPath = path.join(destDir, "VeloqrsFFI.xcframework");

  if (!existsSync(srcPath)) {
    console.log("  Warning: XCFramework not found at module root");
    return;
  }

  // Remove existing if present
  if (existsSync(destPath)) {
    fs.rmSync(destPath, { recursive: true, force: true });
  }

  mkdirSync(destDir, { recursive: true });
  fs.renameSync(srcPath, destPath);
  console.log("  Moved XCFramework to ios/Frameworks/");
}

/**
 * Rename the library inside the XCFramework to avoid case-insensitive conflict.
 *
 * Problem: On macOS (case-insensitive), the linker finds libVeloqrs.a (the Pod output)
 * when searching for -lveloqrs, instead of libveloqrs.a (the Rust library).
 *
 * Solution: Rename libveloqrs.a to libveloqrs_ffi.a inside the XCFramework.
 */
function renameXCFrameworkLibrary() {
  const xcframeworkPath = path.join(MODULE_DIR, "ios/Frameworks/VeloqrsFFI.xcframework");

  if (!existsSync(xcframeworkPath)) {
    console.log("  Warning: XCFramework not found, skipping library rename");
    return;
  }

  const slices = ["ios-arm64", "ios-arm64_x86_64-simulator"];

  for (const slice of slices) {
    const oldPath = path.join(xcframeworkPath, slice, "libveloqrs.a");
    const newPath = path.join(xcframeworkPath, slice, "libveloqrs_ffi.a");

    if (existsSync(oldPath) && !existsSync(newPath)) {
      fs.renameSync(oldPath, newPath);
      console.log(`  Renamed ${slice}/libveloqrs.a -> libveloqrs_ffi.a`);
    }
  }

  // Update Info.plist
  const infoPlistPath = path.join(xcframeworkPath, "Info.plist");
  if (existsSync(infoPlistPath)) {
    let content = readFileSync(infoPlistPath, "utf8");
    if (content.includes("libveloqrs.a")) {
      content = content.replace(/libveloqrs\.a/g, "libveloqrs_ffi.a");
      writeFileSync(infoPlistPath, content);
      console.log("  Updated Info.plist with new library name");
    }
  }
}

/**
 * Copy cpp files from module's cpp directory to ios/cpp for Xcode build.
 * Creates proper subdirectory structure to avoid naming conflicts:
 * - ios/cpp/veloqrs_entry.cpp (renamed from veloqrs.cpp to avoid conflict)
 * - ios/cpp/veloqrs.h, veloq.h
 * - ios/cpp/generated/veloqrs.cpp, veloqrs.hpp
 */
function copyIOSCppFiles() {
  const moduleCppDir = path.join(MODULE_DIR, "cpp");
  const moduleGeneratedDir = path.join(MODULE_DIR, "cpp/generated");
  const iosCppDir = path.join(MODULE_DIR, "ios/cpp");
  const iosCppGeneratedDir = path.join(MODULE_DIR, "ios/cpp/generated");

  if (!existsSync(moduleCppDir)) {
    console.log("  Warning: cpp directory not found, skipping iOS cpp copy");
    return;
  }

  // Clean and recreate ios/cpp
  if (existsSync(iosCppDir)) {
    fs.rmSync(iosCppDir, { recursive: true, force: true });
  }
  mkdirSync(iosCppGeneratedDir, { recursive: true });

  let copied = 0;

  // Copy turbo module header files from cpp/
  const headerFiles = ["veloqrs.h", "veloq.h"];
  for (const file of headerFiles) {
    const srcPath = path.join(moduleCppDir, file);
    if (existsSync(srcPath)) {
      fs.copyFileSync(srcPath, path.join(iosCppDir, file));
      copied++;
    }
  }

  // Copy turbo module entry with renamed filename to avoid conflict with generated veloqrs.cpp
  const turboModuleEntry = path.join(moduleCppDir, "veloqrs.cpp");
  if (existsSync(turboModuleEntry)) {
    fs.copyFileSync(turboModuleEntry, path.join(iosCppDir, "veloqrs_entry.cpp"));
    copied++;
  }

  // Copy bindings files to generated/ subdirectory
  if (existsSync(moduleGeneratedDir)) {
    const generatedFiles = fs.readdirSync(moduleGeneratedDir);
    for (const file of generatedFiles) {
      const srcPath = path.join(moduleGeneratedDir, file);
      if (fs.statSync(srcPath).isFile()) {
        fs.copyFileSync(srcPath, path.join(iosCppGeneratedDir, file));
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
      try {
        execSync("git checkout HEAD -- src/index.ts", { cwd: MODULE_DIR, stdio: "ignore" });
      } catch {
        // Silently fail - git restore is optional
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
    return;
  }

  const content = readFileSync(adapterFile, "utf8");
  if (content.includes("jni::static_ref_cast")) {
    return; // Already patched
  }

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
}

/**
 * Check if binaries already exist for the detected architecture.
 */
function binariesExist(platform) {
  if (platform === "android") {
    // Check for detected device architecture, not hardcoded arm64-v8a
    const detectedArch = detectAndroidArch() || "arm64-v8a";
    const jniLibsDir = path.join(MODULE_DIR, "android/src/main/jniLibs", detectedArch);
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
    // Already built, skip silently
    return;
  }

  // Quiet mode: only show essential output
  const quiet = process.env.VELOQ_QUIET === "1";

  if (!quiet) {
    console.log("\n[veloqrs] Running pre-build setup...");
    console.log(`  Platform: ${platform}`);
    console.log(`  CI: ${isCI()}`);
    console.log(`  Local Rust: ${hasLocalRust()}`);
  }

  // For local development: build + generate in one step
  // Rust incremental build is fast if nothing changed
  if (!hasBinaries || !hasBindings) {
    if (isCI()) {
      // In CI, binaries should be pre-built by separate workflow jobs
      console.log("  Warning: Binaries/bindings not found in CI - they should be pre-built");
    } else if (hasLocalRust()) {
      if (!quiet) console.log("\n  Building and generating bindings...");
      if (platform === "android") {
        // Single command: builds Rust (incremental), copies .so, generates all bindings
        const arch = detectAndroidArch() || "arm64-v8a";
        if (!quiet) console.log(`  Target architecture: ${arch}`);
        try {
          execSync(
            `npx uniffi-bindgen-react-native build android --release --and-generate --targets ${arch}`,
            { cwd: MODULE_DIR, stdio: quiet ? "pipe" : "inherit" }
          );
          execSync("./scripts/fix-generated.sh", { cwd: MODULE_DIR, stdio: "pipe" });
        } catch (error) {
          // Show error output even in quiet mode
          if (quiet && error.stderr) console.error(error.stderr.toString());
          if (quiet && error.stdout) console.log(error.stdout.toString());
          throw error;
        }
      } else if (platform === "ios") {
        // Single command: builds Rust for iOS, creates XCFramework, generates all bindings
        if (!quiet) console.log("  Building iOS with uniffi-bindgen-react-native...");
        try {
          execSync(
            `npx uniffi-bindgen-react-native build ios --release --and-generate`,
            { cwd: MODULE_DIR, stdio: quiet ? "pipe" : "inherit" }
          );
          execSync("./scripts/fix-generated.sh", { cwd: MODULE_DIR, stdio: "pipe" });
        } catch (error) {
          if (quiet && error.stderr) console.error(error.stderr.toString());
          if (quiet && error.stdout) console.log(error.stdout.toString());
          throw error;
        }
        // Remove auto-generated Veloqrs.h/mm that conflict with handwritten Veloq.h/mm
        cleanupIOSGeneratedConflicts();
        // Move XCFramework from module root to ios/Frameworks/
        moveIOSXCFramework();
        // Rename library to avoid case-insensitive conflict with libVeloqrs.a
        renameXCFrameworkLibrary();
      }
    } else {
      console.log("  Error: No pre-built binaries and no local Rust available");
      console.log("  Please install Rust or ensure CI has built the binaries");
    }
  }

  // Step 3: Apply patches (silently)
  patchGeneratedCpp();
  restoreCustomIndexTs();
  if (platform === "android") {
    patchCppAdapter();
  } else if (platform === "ios") {
    copyIOSCppFiles();
  }

  if (!quiet) console.log("\n[veloqrs] Pre-build setup complete!\n");
}

/**
 * Detect platform from command line arguments or environment.
 */
function detectPlatform() {
  // Check environment variable first
  if (process.env.EXPO_PLATFORM) {
    return process.env.EXPO_PLATFORM;
  }

  // Check command line for run:ios or run:android
  const args = process.argv.join(" ");
  if (args.includes("run:ios") || args.includes("--platform ios")) {
    return "ios";
  }
  if (args.includes("run:android") || args.includes("--platform android")) {
    return "android";
  }

  // Default to ios since this is primarily for iOS builds
  return "ios";
}

/**
 * Main plugin function.
 */
module.exports = function withVeloqrs(config) {
  const platform = detectPlatform();

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
