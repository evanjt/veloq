# MapLibre React Native v11 Migration Plan

## Executive Summary

This document outlines the migration strategy from `@maplibre/maplibre-react-native` v10.4.2 to v11 (currently in alpha). The primary motivation is to fix the **Fabric view recycling crash** (`RCTComponentViewRegistry: Attempt to recycle a mounted view`) that occurs with v10's interoperability layer.

## Current State

### Library Version
- Current: `@maplibre/maplibre-react-native@^10.4.2`
- Target: `@maplibre/maplibre-react-native@^11.0.0` (stable when released)
- Latest Alpha: `v11.0.0-alpha.33`

### Active Workarounds

#### 1. Native iOS Patch (`src/plugins/with-maplibre-nil-safety.js`)
Adds nil safety checks to prevent `NSInvalidArgumentException: insertObject:atIndex: object cannot be nil` crash. Patches 3 files:
- `MLRNMapView.m` - insertReactSubview/removeReactSubview
- `MLRNSource.m` - insertReactSubview/removeReactSubview
- `MLRNPointAnnotation.m` - insertReactSubview/removeReactSubview

**Status**: May still be needed in v11 (requires testing)

#### 2. JS Defensive Patterns
- Always render ShapeSource/LineLayer with valid GeoJSON (minimal geometry instead of empty)
- Control visibility via opacity instead of conditional rendering
- IIFE patterns to build clean children arrays without nulls

**Status**: Should remain as good practice regardless of version

## Why Migrate to v11

### 1. Native Fabric Support
v10 uses an "interoperability layer" for React Native's new architecture (Fabric), which causes:
- `RCTComponentViewRegistry: Attempt to recycle a mounted view` crashes
- Performance overhead from bridge communication
- View reconciliation issues when rapidly toggling MapView children

v11 migrates components natively to Fabric:
- ShapeSource (alpha.27)
- Sources (alpha.31)
- OfflineManager (alpha.32)
- MapView uses proper codegen (alpha.30)

### 2. Bug Fixes
- Event bubbling fixes (alpha.29)
- Region change coordinate fixes (alpha.25)
- Event payload nil reference fixes (alpha.28)

### 3. Updated Native SDKs
- MapLibre Native Android: 12.2.3
- MapLibre Native iOS: 6.22.1

---

## API Changes Required

### MapView Component

| Prop | v10 | v11 | Change Required |
|------|-----|-----|-----------------|
| `mapStyle` | ✅ Used | ✅ Supported | None |
| `logoEnabled` | ✅ Used | ✅ Supported | None |
| `attributionEnabled` | ✅ Used | ✅ Supported | None |
| `compassEnabled` | ✅ Used | ✅ Supported | None |
| `onPress` | ✅ Used | ✅ Supported | None |
| `onRegionIsChanging` | ✅ Used | ⚠️ Check | Verify event payload |
| `onDidFailLoadingMap` | ✅ Used | ⚠️ Check | Verify callback signature |
| `compassHiddenFacingNorth` | Not used | ✅ New | Optional enhancement |

**Files to update**:
- `src/components/maps/BaseMapView.tsx`
- `src/components/maps/ActivityMapView.tsx`
- `src/components/maps/RegionalMapView.tsx`
- `src/components/routes/RouteMapView.tsx`
- `src/components/routes/SectionMapView.tsx`
- `src/components/activity/ActivityMapPreview.tsx`
- `src/app/heatmap.tsx`

### Camera Component

| Prop | v10 | v11 | Change Required |
|------|-----|-----|-----------------|
| `ref` | ✅ Used | ✅ Supported | None |
| `defaultSettings` | ✅ Used | ✅ Supported | None |
| `bounds` | ✅ Used | ✅ Supported | None |
| `padding` | ✅ Used | ✅ Supported | None |
| `animationDuration` | ✅ Used | ⚠️ Check | May need `animationMode` |

**Note**: On Android v11 alpha, `setCamera` with animations other than "moveTo" may not work properly. Test thoroughly.

### ShapeSource Component

| Prop | v10 | v11 | Change Required |
|------|-----|-----|-----------------|
| `id` | ✅ Used | ✅ Supported | None |
| `shape` | ✅ Used | ✅ Supported | None |
| `onPress` | ✅ Used | ✅ Supported | None |
| `hitbox` | ✅ Used | ⚠️ Check | Verify behavior |

### LineLayer / CircleLayer Components

No breaking changes expected. Style props remain the same.

### MarkerView Component

| Prop | v10 | v11 | Change Required |
|------|-----|-----|-----------------|
| `coordinate` | ✅ Used | ✅ Supported | None |
| `anchor` | ✅ Used | ✅ Supported | None |

**Note**: v11 warns about defaultProps deprecation (Issue #430). May need to update to JavaScript default parameters.

---

## Files Requiring Modification

### High Priority (MapLibre Imports)

| File | Components Used | Estimated Changes |
|------|-----------------|-------------------|
| `src/components/maps/BaseMapView.tsx` | MapView, Camera, ShapeSource, LineLayer, MarkerView | Low |
| `src/components/maps/ActivityMapView.tsx` | MapView, Camera, ShapeSource, LineLayer, MarkerView | Low |
| `src/components/maps/RegionalMapView.tsx` | MapView, Camera, ShapeSource, LineLayer, CircleLayer, MarkerView | Low |
| `src/components/routes/RouteMapView.tsx` | MapView, Camera, ShapeSource, LineLayer | Low |
| `src/components/routes/SectionMapView.tsx` | MapView, Camera, ShapeSource, LineLayer | Low |
| `src/components/activity/ActivityMapPreview.tsx` | MapView, Camera, ShapeSource, LineLayer, MarkerView | Low |
| `src/components/maps/HeatmapLayer.tsx` | ShapeSource, CircleLayer | Low |
| `src/components/maps/HighlightRenderer.tsx` | MarkerView | Low |
| `src/components/maps/LocationHandler.tsx` | Camera type | None |
| `src/components/maps/regional/useMapHandlers.ts` | Camera type | None |
| `src/app/heatmap.tsx` | MapView, Camera | Low |
| `src/app/_layout.tsx` | Logger | None |

### Configuration

| File | Change |
|------|--------|
| `package.json` | Update dependency version |
| `app.json` | Verify plugin still works |
| `src/plugins/with-maplibre-nil-safety.js` | May need update or removal |

---

## Patch Assessment: Can We Remove `with-maplibre-nil-safety.js`?

### Analysis

The patch adds nil safety checks to `insertReactSubview` and `removeReactSubview` methods in Objective-C. This prevents crashes when React reconciliation passes nil children.

**v11 Status**:
- v11 rewrites these components for native Fabric support
- The code paths change significantly with native Fabric
- The old interop layer code that caused nil issues may be removed

**Recommendation**:
1. **Test first** - Build with v11 without the patch and run stress tests
2. **Keep patch ready** - If crashes occur, adapt patch for v11's code structure
3. **Monitor logs** - Our patch logs `[MLRNMapView] Warning: Attempted to insert nil subview`

### Patch Compatibility Check

The patch looks for specific code patterns. v11 may have:
- Different method signatures
- Different file structure
- Swift instead of Objective-C for some components

**Action**: After upgrading, run `npx expo prebuild --platform ios --clean` and check if patch applies cleanly.

---

## Migration Steps

### Phase 1: Preparation

1. **Create branch**: `git checkout -b feature/maplibre-v11`

2. **Update dependency**:
   ```bash
   npm install @maplibre/maplibre-react-native@^11.0.0-alpha.33
   ```

3. **Clean build**:
   ```bash
   npx expo prebuild --platform ios --clean
   npx expo prebuild --platform android --clean
   ```

### Phase 2: Code Updates

4. **Verify imports** - All imports should work unchanged:
   ```typescript
   import {
     MapView,
     Camera,
     ShapeSource,
     LineLayer,
     CircleLayer,
     MarkerView,
   } from '@maplibre/maplibre-react-native';
   ```

5. **Check event handlers** - Verify event payload structures haven't changed:
   - `onPress` event
   - `onRegionIsChanging` event
   - `onDidFailLoadingMap` callback

6. **Test Camera methods**:
   - `cameraRef.current?.setCamera()` - May need different animation options
   - `bounds` with `padding` - Verify works on both platforms

### Phase 3: Testing

7. **Run unit tests**:
   ```bash
   npm test
   ```

8. **iOS stress tests** (most critical):
   - [ ] Toggle activities on/off rapidly
   - [ ] Toggle sections on/off rapidly
   - [ ] Toggle routes on/off rapidly
   - [ ] Toggle heatmap mode on/off rapidly
   - [ ] Get/dismiss user location repeatedly
   - [ ] Pan/zoom while toggling controls
   - [ ] Switch tabs while map is loading
   - [ ] Background/foreground app on map screen

9. **Android stress tests**:
   - Same as iOS tests
   - Pay attention to `setCamera` animations
   - Check `fitBounds` behavior

### Phase 4: Patch Evaluation

10. **Test without nil safety patch**:
    - Temporarily disable `with-maplibre-nil-safety` in `app.json`
    - Run iOS prebuild
    - Execute stress tests
    - Check for crashes or warnings

11. **Decision point**:
    - If no crashes: Remove patch entirely
    - If crashes occur: Update patch for v11 code structure

### Phase 5: Finalization

12. **Update documentation**:
    - Update this plan with findings
    - Update CLAUDE.md if architecture changes
    - Remove outdated workaround comments in code

13. **Performance validation**:
    - Compare map load times
    - Check memory usage
    - Verify no regressions

---

## Known v11 Alpha Issues

Based on GitHub issues:

1. **Android fitBounds issues** (Issue #993):
   - `fitBounds`, `setCamera`, and style update re-renders don't work properly
   - After zooming in, `fitBounds` cannot update zoom
   - Workaround: Use `moveTo` animation mode

2. **flyTo animation limitation** (Issue #571):
   - `flyTo()` with unchanged parameters only works once on iOS
   - Subsequent calls are ignored

3. **defaultProps deprecation warning** (Issue #430):
   - MarkerView shows React 18 deprecation warning
   - Cosmetic only, doesn't affect functionality

4. **Heatmap shape issues on iOS** (Issue #1019):
   - Heatmap behavior differs between iOS and Android
   - May affect our HeatmapLayer component

---

## Rollback Plan

If v11 migration causes blocking issues:

1. Revert dependency:
   ```bash
   npm install @maplibre/maplibre-react-native@^10.4.2
   ```

2. Clean rebuild:
   ```bash
   npx expo prebuild --platform ios --clean
   npx expo prebuild --platform android --clean
   ```

3. Restore any reverted JS patterns

---

## Timeline Recommendation

**Wait for v11 stable release** before production migration. The alpha has known issues, particularly on Android.

**For development/testing**: Can experiment with alpha now to identify migration issues early.

**Monitoring**: Watch the [MapLibre React Native releases](https://github.com/maplibre/maplibre-react-native/releases) for v11.0.0 stable.

---

## Sources

- [MapLibre React Native GitHub](https://github.com/maplibre/maplibre-react-native)
- [GitHub Releases](https://github.com/maplibre/maplibre-react-native/releases)
- [Alpha Branch](https://github.com/maplibre/maplibre-react-native/tree/alpha)
- [Getting Started Documentation](https://maplibre.org/maplibre-react-native/docs/setup/getting-started/)
- [Camera Documentation](https://maplibre.org/maplibre-react-native/docs/components/general/camera/)
- [Issue #993 - fitBounds issues](https://github.com/maplibre/maplibre-react-native/issues/993)
- [Issue #571 - flyTo limitations](https://github.com/maplibre/maplibre-react-native/issues/571)
- [Issue #430 - defaultProps warning](https://github.com/maplibre/maplibre-react-native/issues/430)
