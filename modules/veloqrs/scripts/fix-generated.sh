#!/bin/bash
# Fix generated files after uniffi-bindgen-react-native

# Rewrites FILE through the command that follows it, which reads FILE's
# contents on stdin and writes the fixed text to stdout, and replaces FILE only
# when the text differs. CMake and Ninja rebuild by modification time, and this
# runs on every bundle, so a file written back with the same bytes would
# reconfigure and recompile the JNI bridge for every ABI on every build.
rewrite() {
  local file="$1"
  shift
  [ -f "$file" ] || return 0
  local tmp
  tmp="$(mktemp)"
  if "$@" < "$file" > "$tmp" && ! cmp -s "$tmp" "$file"; then
    cat "$tmp" > "$file"
  fi
  rm -f "$tmp"
}

# Fix include path in veloqrs.cpp
rewrite cpp/veloqrs.cpp sed 's|#include "/generated/veloqrs.hpp"|#include "generated/veloqrs.hpp"|g'

# Rename CMake library to veloqrs_jni to avoid conflict with Rust's libveloqrs.so.
# Every rewrite here has to be a no-op on a file that already carries the fixed
# names, because this runs after every regeneration. The imported target is the
# Rust cdylib and keeps the name veloqrs: set_target_properties and the link
# line below it both name it, so renaming it breaks the CMake configure.
if [ -f android/CMakeLists.txt ]; then
  # The last expression handles the multiline format where veloqrs is on its
  # own indented line.
  rewrite android/CMakeLists.txt sed \
    -e '/SHARED IMPORTED/!s|add_library(veloqrs |add_library(veloqrs_jni |g' \
    -e 's|target_link_libraries(veloqrs |target_link_libraries(veloqrs_jni |g' \
    -e 's|target_link_libraries(veloqrs$|target_link_libraries(veloqrs_jni|g' \
    -e 's|^  veloqrs$|  veloqrs_jni|g'
fi

# Ensure VeloqrsModule loads both libraries
if [ -f android/src/main/java/com/veloq/VeloqrsModule.kt ]; then
  if ! grep -q 'veloqrs_jni' android/src/main/java/com/veloq/VeloqrsModule.kt 2>/dev/null; then
    rewrite android/src/main/java/com/veloq/VeloqrsModule.kt \
      sed 's|System.loadLibrary("veloqrs")|System.loadLibrary("veloqrs")\n      System.loadLibrary("veloqrs_jni")|'
  fi
fi

# The generator's own comments carry em dashes, which style.md bans and
# `scripts/lint-em-dashes.mjs` refuses across the whole index. These files are
# the generator's text rather than ours and are rewritten wholesale on every
# regeneration, so they are fixed here rather than by hand or by an exemption
# in a guard whose whole design is to have no exemption list. Spaced ones
# become a comma, which is how every one of them reads; anything left becomes a
# hyphen, so a form nobody has seen yet cannot fail a merge either.
for f in src/generated/veloqrs.ts src/generated/veloqrs-ffi.ts \
         cpp/generated/veloqrs.cpp cpp/generated/veloqrs.hpp; do
  rewrite "$f" sed -e 's/ \xe2\x80\x94 /, /g' -e 's/\xe2\x80\x94/-/g'
done

# The generator emits the error variants' `static instanceOf` without `override`, and
# it hides the static of the same name on `UniffiError`, so `noImplicitOverride` refuses
# it in the typechecked bindings. A class that extends `UniffiError` is one whose
# `extends` line names it; the next class opening ends that span. A line that already
# says `override` is left alone, so a second run changes nothing.
rewrite src/generated/veloqrs.ts awk '
  /^  (export )?class / { in_error = 0 }
  /extends UniffiError/ { in_error = 1 }
  in_error && /^    static instanceOf\(/ { sub(/static instanceOf/, "static override instanceOf") }
  { print }
'

# Restore the custom iOS TurboModule files, but only the ones the generator
# actually took. See restore-ios-turbomodule.sh for why that matters.
"$(dirname "$0")/restore-ios-turbomodule.sh" "$(pwd)"

echo "Fixed generated files"
