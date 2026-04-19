#!/bin/bash
# Fix generated files after uniffi-bindgen-react-native

# sed -i needs an empty argument on BSD/macOS but accepts none on GNU.
# Detect which by running a probe and set SED_INPLACE accordingly.
if sed --version >/dev/null 2>&1; then
  SED_INPLACE=(-i)
else
  SED_INPLACE=(-i '')
fi

# Fix include path in veloqrs.cpp
sed "${SED_INPLACE[@]}" 's|#include "/generated/veloqrs.hpp"|#include "generated/veloqrs.hpp"|g' cpp/veloqrs.cpp 2>/dev/null || true

# Rename CMake library to veloqrs_jni to avoid conflict with Rust's libveloqrs.so
if [ -f android/CMakeLists.txt ]; then
  sed "${SED_INPLACE[@]}" 's|add_library(veloqrs |add_library(veloqrs_jni |g' android/CMakeLists.txt
  sed "${SED_INPLACE[@]}" 's|target_link_libraries(veloqrs |target_link_libraries(veloqrs_jni |g' android/CMakeLists.txt
  sed "${SED_INPLACE[@]}" 's|target_link_libraries(veloqrs$|target_link_libraries(veloqrs_jni|g' android/CMakeLists.txt
  # Handle multiline format where veloqrs is on its own indented line
  sed "${SED_INPLACE[@]}" 's|^  veloqrs$|  veloqrs_jni|g' android/CMakeLists.txt
fi

# Ensure VeloqrsModule loads both libraries
if [ -f android/src/main/java/com/veloq/VeloqrsModule.kt ]; then
  if ! grep -q 'veloqrs_jni' android/src/main/java/com/veloq/VeloqrsModule.kt 2>/dev/null; then
    sed "${SED_INPLACE[@]}" 's|System.loadLibrary("veloqrs")|System.loadLibrary("veloqrs")\n      System.loadLibrary("veloqrs_jni")|' android/src/main/java/com/veloq/VeloqrsModule.kt
  fi
fi

# Restore custom iOS TurboModule files if uniffi-bindgen-react-native overwrote them.
# Our custom Veloqrs.h / Veloqrs.mm expose only installRustCrate/cleanupRustCrate;
# the generated ones declare NativeVeloqrsSpec which isn't produced by Codegen for
# monorepo-local modules and breaks the iOS build. The canonical versions live in git.
# The script runs from the modules/veloqrs directory (via `npm run fix-includes`),
# so the ios/ files are at modules/veloqrs/ios/Veloqrs.{h,mm} relative to the repo root.
if git rev-parse --show-toplevel >/dev/null 2>&1; then
  REPO_ROOT=$(git rev-parse --show-toplevel)
  MODULE_REL=$(pwd | sed "s|^$REPO_ROOT/||")
  git -C "$REPO_ROOT" checkout -- "$MODULE_REL/ios/Veloqrs.h" "$MODULE_REL/ios/Veloqrs.mm" 2>/dev/null || true
fi

echo "Fixed generated files"
