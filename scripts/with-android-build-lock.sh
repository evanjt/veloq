#!/usr/bin/env sh
# Run one Android build at a time on this machine.
#
# Every worktree shares the one `android/` tree, because `android/` is almost
# entirely gitignored and a worktree cannot build without the main checkout's
# copy. So two `assembleDebug` runs write the same
# `android/app/build/intermediates/incremental/debug/mergeDebugResources`, and
# the loser fails on whichever resource file the winner moved out from under
# it. That failure names the locale files and nothing about the collision, so
# it reads as a broken locale tree rather than as two builds.
#
# The lock is the build's own and is deliberately NOT the one `CLAUDE.md` tells
# an agent to wrap a build in by hand. Taking that same lock again from inside
# a build already wrapped in it deadlocks: the locks are per open file
# description, so the child blocks on the parent and the parent waits on the
# child. With a lock of its own, a hand-wrapped build takes both in a fixed
# order and a plain `npm run android:debug` takes only this one, so every
# build serialises either way and neither can wait on itself. It is not the
# merge lock for the same reason it never was: a build holds it for a quarter
# of an hour and merges must not queue behind that.

set -eu

# A fixed path, never one the environment chooses: a session with its own temp
# directory would take a lock nobody else can see, which is the same as no lock
# at all. `/tmp/claude-<uid>` is where the agent sessions already put it; plain
# `/tmp` is the fallback when that directory does not exist.
lock_dir="/tmp/claude-$(id -u)"
[ -d "$lock_dir" ] || lock_dir="/tmp"
# The override is for the test that proves this serialises: a test taking the
# real lock would queue behind whatever the fleet is building.
lock="${VELOQ_ANDROID_BUILD_LOCK:-$lock_dir/veloq-android-build.lock}"

if ! command -v flock >/dev/null 2>&1; then
  echo "with-android-build-lock: no flock, running unserialised" >&2
  exec "$@"
fi

if ! flock -n "$lock" true 2>/dev/null; then
  echo "with-android-build-lock: another build holds $lock, waiting" >&2
fi

exec flock "$lock" "$@"
