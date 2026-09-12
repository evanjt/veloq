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

# Rename CMake library to veloqrs_jni to avoid conflict with Rust's libveloqrs.so.
# Every rewrite here has to be a no-op on a file that already carries the fixed
# names, because this runs after every regeneration. The imported target is the
# Rust cdylib and keeps the name veloqrs: set_target_properties and the link
# line below it both name it, so renaming it breaks the CMake configure.
if [ -f android/CMakeLists.txt ]; then
  sed "${SED_INPLACE[@]}" '/SHARED IMPORTED/!s|add_library(veloqrs |add_library(veloqrs_jni |g' android/CMakeLists.txt
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

# Restore the custom iOS TurboModule files, but only the ones the generator
# actually took. See restore-ios-turbomodule.sh for why that matters.
"$(dirname "$0")/restore-ios-turbomodule.sh" "$(pwd)"

echo "Fixed generated files"
