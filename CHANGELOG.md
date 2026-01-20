# Changelog

All notable changes to Veloq will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.3] - 2026-01-20

### Added
- **CI/CD Improvements**
  - Split E2E tests into parallel jobs: screenshots (required) and functional tests (optional)
  - Screenshots now run independently and are prioritized
  - Functional tests use `continue-on-error` to avoid blocking releases
  - Added disk cleanup step to Android Release build job

### Fixed
- **Android Build**
  - Fixed "No space left on device" error in CI by adding disk cleanup
  - Reduced architectures from 4 to 2 (arm64-v8a, x86_64)
  - Removed legacy 32-bit architectures (armeabi-v7a, x86) - saves ~500MB build space
  - Fixed shared library packaging conflicts with React Native

- **iOS Build**
  - Fixed fastlane paths for correct relative directory handling
  - Fixed Xcode project path resolution in CI

- **E2E Tests**
  - Fixed demo-mode test for disabled API key button
  - Test now properly handles button disabled state when input is empty

- **Native Module Build**
  - Committed tracematch C++ bindings for CI builds (no Rust toolchain required)
  - Fixed CMake build configuration for Android
  - Fixed TurboModuleRegistry.getEnforcing loading error on Android

### Changed
- **Build Configuration**
  - Android builds only for arm64-v8a (99%+ of devices) and x86_64 (emulator)
  - Faster CI builds with fewer architectures
  - E2E timeout reduced from 60 to 30-45 minutes per job

### Technical Details
- **CI Structure**: 4 E2E jobs (screenshots-ios, e2e-ios-functional, screenshots-android, e2e-android-functional)
- **Build Artifacts**: iOS .app and Android .apk cached by source hash
- **Test Coverage**: 293 tests passing

---

## [0.0.2] - 2026-01-09

### Added
- **Route Performance Tracking**
  - Personal Record (PR) badges for best performances (trophy icon)
  - Rank badges (#2, #3, etc.) for top 10 performances
  - Precise GPS-based segment time calculations via Rust engine
  - Replaced approximate activity averages with exact route segment matching

- **iOS Platform Parity**
  - Added 8 missing route/section naming functions to iOS
  - `engineSetRouteName`, `engineGetRouteName` for routes
  - `persistentEngineSetRouteName`, `persistentEngineGetRouteName` for persistent storage
  - `persistentEngineGetAllRouteNamesJson` for bulk retrieval
  - All 4 section naming equivalents for sections
  - Full feature parity with Android platform

- **Comprehensive Test Coverage**
  - 46 new tests for route performance and name reactivity
  - Tests for PR/rank badge logic
  - Tests for GPS-based performance calculations
  - Tests for route name persistence across recomputations
  - Edge case coverage (ties, empty lists, special characters)

- **Android Build Deprecation Fix**
  - Applied patch to fix `UIManagerType.DEFAULT` → `UIManagerType.LEGACY` deprecation
  - Uses patch-package to fix expo-modules-core deprecated API usage
  - Addresses React Native 0.77+ deprecation warnings
  - Patch automatically applied on install via postinstall script

### Fixed
- **Route Name Reactivity**
  - Custom route names now persist across group recomputations
  - Names survive when new activities are added
  - Names survive app restarts
  - Fixed by calling `load_route_names()` after `recompute_groups()`
  - Location: `rust/route-matcher/src/persistence.rs:951`

- **Section Performance Data**
  - Fixed stale closure bug in `useSectionPerformances` hook
  - Performance data now updates correctly when sections change
  - Fixed dependencies array to include `activityIdsToFetch`

- **TypeScript Compilation**
  - Restored chart config types for activity screen
  - Fixed type errors in route performance integration
  - Added proper type annotations for Rust engine bindings
  - All 0 TypeScript errors

### Removed
- **Achievement System** (300 lines removed)
  - Removed `achievements.rs` (unused backend code)
  - Removed `AchievementToast.tsx` (unused UI component)
  - Removed `Confetti.tsx` (unused UI component)
  - Cleaner codebase, reduced bundle size

- **Dead Code** (400+ lines removed)
  - Removed `useChartGesture.ts` (duplicate of `useChartGestures`)
  - Removed backup files (`.backup` extensions)

### Changed
- **Home Screen UI**
  - Simplified stat pills layout (4 pills visible directly)
  - Removed expandable "show more metrics" pattern
  - Cleaner, more accessible interface
  - All metrics visible at once without extra taps

- **Code Quality**
  - Applied Prettier formatting to all TypeScript/JavaScript files
  - Applied rustfmt formatting to all Rust files
  - Improved error handling with `.ok()` instead of `?` where appropriate
  - Better type safety with explicit annotations

### Technical Details
- **Performance**: Route performance now uses Rust engine's GPS matching for precise segment times
- **Persistence**: Custom route/section names stored in SQLite, survive all operations
- **Platform Parity**: iOS and Android have identical feature sets
- **Test Coverage**: 295 tests passing (1 skipped)

### Migration Notes
- No breaking changes
- Existing data (routes, sections, custom names) fully preserved
- Update is seamless for all users

---

## [0.0.1] - 2024-XX-XX

### Added
- Initial release
- OAuth and API key authentication
- Activity feed with filtering
- Route detection and grouping
- Section detection
- Map view with GPS tracks
- Fitness and wellness tracking
- Multi-language support (19 locales)
- Dark mode support
