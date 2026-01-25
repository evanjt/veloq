#!/bin/bash
# Fix generated files after uniffi-bindgen-react-native

# Fix include path in veloqrs.cpp
sed -i 's|#include "/generated/veloqrs.hpp"|#include "generated/veloqrs.hpp"|g' cpp/veloqrs.cpp 2>/dev/null || true

# Rename CMake library to veloqrs_jni to avoid conflict with Rust's libveloqrs.so
sed -i 's|add_library(veloqrs |add_library(veloqrs_jni |g' android/CMakeLists.txt
sed -i 's|target_link_libraries(veloqrs |target_link_libraries(veloqrs_jni |g' android/CMakeLists.txt
sed -i 's|target_link_libraries(veloqrs$|target_link_libraries(veloqrs_jni|g' android/CMakeLists.txt
# Handle multiline format where veloqrs is on its own indented line
sed -i 's|^  veloqrs$|  veloqrs_jni|g' android/CMakeLists.txt

# Ensure VeloqrsModule loads both libraries
if ! grep -q 'veloqrs_jni' android/src/main/java/com/veloq/VeloqrsModule.kt 2>/dev/null; then
  sed -i 's|System.loadLibrary("veloqrs")|System.loadLibrary("veloqrs")\n      System.loadLibrary("veloqrs_jni")|' android/src/main/java/com/veloq/VeloqrsModule.kt
fi

echo "Fixed generated files"
