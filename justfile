# Veloq dev commands. Run `just --list` to see them all.
# npm scripts stay for CI and git hooks; this is the curated human surface.
# Install just with `brew install just` or `cargo install just`.

# Show the command list
default:
    @just --list

# --- Build & run ---

# Build and run on Android (Rust rebuilds automatically on source change)
android:
    npx expo run:android

# Build and run on iOS
ios:
    npx expo run:ios

# Clear native caches then rebuild+run Android (rarely needed now)
rebuild-android:
    npm run clean:rust && npx expo run:android

# Clear native caches then rebuild+run iOS
rebuild-ios:
    npm run clean:rust && npx expo run:ios

# Clear native build caches (Rust .so/.a, hash markers, iOS DerivedData)
clean:
    npm run clean:rust

# Full clean including the Rust compilation cache (recompiles from scratch)
clean-full:
    npm run clean:rust:full

# --- Quality ---

# Run every static guard (expo SDK, FFI manifest, crash patterns, engine bridge)
audit:
    npm run audit

# Type-check + tests (what the pre-commit hook runs)
check:
    npx tsc --noEmit && npm test

# Format all source with Prettier
format:
    npm run format

# Regenerate the FFI manifest after adding/removing a #[uniffi::export]
ffi-manifest:
    npm run ffi:manifest

# --- E2E (Maestro) ---

# Smoke test (tier0)
e2e-smoke:
    npm run maestro:smoke

# Full E2E run (tier0–2)
e2e:
    npm run maestro:test

# --- Occasional / manual tools ---

# Compare perf-test results to baseline (run `npm run test:perf:ci` first)
perf-compare:
    npx tsx scripts/perf-compare.ts

# Capture UI hierarchy snapshots for visual-regression diffing
capture-hierarchy:
    ./scripts/capture-hierarchy.sh

# Set up StoreKit config for local iOS IAP testing (after prebuild)
setup-storekit:
    ./scripts/setup-storekit.sh

# Verify a pulled backup export is valid SQLite (after the Maestro backup flow)
verify-backup:
    ./scripts/verify-backup-export.sh

# Verify a pulled GPX export is valid (after the Maestro export flow)
verify-gpx:
    ./scripts/verify-gpx-export.sh
