# Veloq dev commands. Run `just --list` to see them all.
# npm scripts stay for CI and git hooks; this is the curated human surface.
# Install just with `brew install just` or `cargo install just`.

# Show the command list
default:
    @just --list

# --- Build & run ---

# Build and run on Android (Rust rebuilds automatically on source change)
android:
    npm run android

# Build and run on iOS
ios:
    npm run ios

# Clear native build caches (Rust library outputs, iOS DerivedData)
clean:
    npm run clean:rust

# Full clean including the Rust compilation cache (recompiles from scratch)
clean-full:
    npm run clean:rust:full

# --- Quality ---

# Run every static guard (expo SDK, crash patterns, engine bridge)
audit:
    npm run audit

# The pre-commit gates, run on the working tree
check:
    ./scripts/run-gates.sh "audit:node scripts/run-guards.mjs --set commit" "tsc:npx tsc -b" "lint:npm run lint" "test:npm run test:changed" "rustfmt:npm run lint:rust-fmt" "rusttests:npm run lint:rust-tests"

# Format all source with Prettier
format:
    npm run format

# --- E2E (Maestro) ---

# Smoke test (tier0)
e2e-smoke:
    npm run maestro:smoke

# Full E2E run (tier0–2)
e2e:
    npm run maestro:test

# --- Release ---

# Once per release, on a test handset with the dev debug build: back up, drop the record zip, restore, compare
release-backup-roundtrip serial:
    ANDROID_SERIAL={{serial}} ./scripts/android-backup-roundtrip.sh

# Once per release, on an emulator only: back up through LocalTransport, uninstall, reinstall the apk, restore, check what came back and what did not
release-backup-reinstall apk serial="emulator-5554":
    ANDROID_SERIAL={{serial}} ./scripts/android-backup-roundtrip.sh --reinstall {{apk}}

# --- Occasional / manual tools ---

# Compare perf-test results to baseline (run `npm run test:perf:ci` first)
perf-compare:
    npx tsx scripts/perf-compare.ts

# Capture UI hierarchy snapshots for visual-regression diffing
capture-hierarchy:
    ./scripts/capture-hierarchy.sh

# Verify a pulled backup export is valid SQLite (after the Maestro backup flow)
verify-backup:
    ./scripts/verify-backup-export.sh

# Verify a pulled GPX export is valid (after the Maestro export flow)
verify-gpx:
    ./scripts/verify-gpx-export.sh
