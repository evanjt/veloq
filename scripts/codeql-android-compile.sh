#!/usr/bin/env bash
# Compile the app's own Kotlin and Java for a CodeQL java-kotlin database, so
# the workflow and a local run trace the same tasks.
#
# Usage: scripts/codeql-android-compile.sh prepare|trace
#
#   prepare  untraced: compiles :app and every library it links, so each
#            autolinked library under node_modules is built and up to date
#            before tracing starts, then stops the Gradle daemon
#   trace    the run CodeQL traces: reruns the compile tasks of :app and our
#            own modules only, so third-party code never enters the database
#
# Both run on a tree that `CI=1 npx expo prebuild --platform android
# --no-install` has generated. No task here reaches the Rust library: it hangs
# off the CMake and native-lib merge tasks, never off a compile task.
#
# Locally, after the prebuild:
#   scripts/codeql-android-compile.sh prepare
#   codeql database create db --language=java-kotlin --build-mode=manual \
#     --command='scripts/codeql-android-compile.sh trace'
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

# The Gradle projects whose sources are ours.
PROJECTS=(
  :app
  :veloqrs
  :veloq-recording-notification
  :veloq-backup-exclusion
  :veloq-debug-crash
  :veloq-focus
  :veloq-display
  :veloq-memory
  :veloq-widget
  :veloq-accessibility
  :veloq-locale
)

# The shipped variant's source set is the one analysed.
TASKS=(compileReleaseKotlin compileReleaseJavaWithJavac)

# Tracked directories :app compiles where they are, so the database holds the
# files the repository holds rather than copies written elsewhere: the widget's
# Kotlin, which the prebuild copies into :app with its package filled in, and
# the sea-level altitude helper, which the postinstall patch copies into
# expo-location, a library that is not traced since nothing else in it is ours.
APP_SOURCES=(
  widget/android/java
  scripts/expo-location
)

# What the altitude helper imports, which expo-location declares and :app does not.
APP_DEPENDENCIES=(androidx.core:core-location-altitude:1.0.0)

[ -f "$root/android/settings.gradle" ] || {
  echo "android/ is not generated. Run: CI=1 npx expo prebuild --platform android --no-install" >&2
  exit 1
}

cd "$root/android"
case "${1:-}" in
  prepare)
    ./gradlew :app:compileReleaseKotlin :app:compileReleaseJavaWithJavac --build-cache
    ./gradlew --stop
    ;;
  trace)
    # The widget's Kotlin carries a package placeholder, so it is filled in
    # where it is tracked and the prebuild's copies are set aside, since :app
    # would otherwise declare every class twice. Both are put back on exit.
    pkg=$(sed -n "s/^ *namespace ['\"]\([^'\"]*\)['\"].*/\1/p" app/build.gradle)
    widget="$root/widget/android/java"
    copies="app/src/main/java/${pkg//.//}/widget"
    aside=$(mktemp -d)
    cp -a "$widget/." "$aside/widget"
    mv "$copies" "$aside/copies"
    trap 'cp -a "$aside/widget/." "$widget/" && mv "$aside/copies" "$copies" && rm -rf "$aside"' EXIT
    sed -i "s/__PKG__/$pkg/g" "$widget"/*.kt

    # Each task takes its own --rerun. kotlinc runs inside the Gradle process,
    # which the tracer sees, rather than in a Kotlin daemon started apart. Each
    # in-process compile loads the compiler again, so they run one at a time
    # and the metaspace the generated project caps at 512 MB is raised.
    args=()
    for project in "${PROJECTS[@]}"; do
      for task in "${TASKS[@]}"; do
        args+=("$project:$task" --rerun)
      done
    done
    sources=()
    for dir in "${APP_SOURCES[@]}"; do sources+=("$root/$dir"); done
    ./gradlew "${args[@]}" --no-daemon --no-build-cache --max-workers=1 \
      -Pkotlin.compiler.execution.strategy=in-process \
      '-Dorg.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=2g' \
      --init-script "$root/scripts/codeql-app-sources.gradle" \
      "-Pveloq.codeqlAppSources=$(IFS=,; echo "${sources[*]}")" \
      "-Pveloq.codeqlAppDependencies=$(IFS=,; echo "${APP_DEPENDENCIES[*]}")"

    # A source directory Gradle did not pick up compiles nothing and fails
    # nothing, so the widget's classes are looked for.
    compiled="app/build/tmp/kotlin-classes/release/${pkg//.//}/widget"
    compgen -G "$compiled/*.class" > /dev/null || {
      echo "No widget classes in android/$compiled: :app did not compile widget/android/java" >&2
      exit 1
    }
    ;;
  *)
    sed -n '5,13p' "${BASH_SOURCE[0]}" >&2
    exit 2
    ;;
esac
