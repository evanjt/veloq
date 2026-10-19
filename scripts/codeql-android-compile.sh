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

# The Gradle projects whose sources are ours. The widget sources compile in
# :app, where the prebuild copies them.
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
    ./gradlew "${args[@]}" --no-daemon --no-build-cache --max-workers=1 \
      -Pkotlin.compiler.execution.strategy=in-process \
      '-Dorg.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=2g'
    ;;
  *)
    sed -n '5,13p' "${BASH_SOURCE[0]}" >&2
    exit 2
    ;;
esac
