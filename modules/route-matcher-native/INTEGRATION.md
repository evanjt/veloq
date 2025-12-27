# Route Matcher Native Integration

This module provides high-performance GPS route matching using a Rust library with automatic fallback to JavaScript.

## Quick Start (JavaScript Fallback)

The module works immediately without any native build steps - it uses a JavaScript implementation by default:

```typescript
import RouteMatcher from 'route-matcher-native';

// Check if native module is being used
console.log('Using native:', RouteMatcher.isNative());

// Create signatures from GPS points
const sig1 = RouteMatcher.createSignature('activity-1', [
  { latitude: 51.5074, longitude: -0.1278 },
  { latitude: 51.5080, longitude: -0.1290 },
  // ... more points
]);

// Compare routes
const result = RouteMatcher.compareRoutes(sig1, sig2);
if (result) {
  console.log(`Match: ${result.matchPercentage}% (${result.direction})`);
}

// Group similar routes
const groups = RouteMatcher.groupSignatures(signatures);
```

## Enabling Native Performance

For production apps with many routes (100+), enable the native Rust implementation:

### Prerequisites

1. Install Rust: https://rustup.rs
2. Add targets:
   ```bash
   # iOS
   rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios

   # Android
   rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android i686-linux-android
   cargo install cargo-ndk
   ```

### Build Steps

#### iOS (requires macOS)

```bash
cd rust/route-matcher
./scripts/build-ios.sh
```

Then copy the output to the module:
```bash
cp -r target/ios/RouteMatcherFFI.xcframework modules/route-matcher-native/ios/
cp -r target/ios/swift/* modules/route-matcher-native/ios/
```

#### Android

```bash
cd rust/route-matcher
./scripts/build-android.sh
```

Then copy the output:
```bash
cp -r target/android/jniLibs/* modules/route-matcher-native/android/src/main/jniLibs/
cp -r target/android/kotlin/* modules/route-matcher-native/android/src/main/java/
```

### App Configuration

Add the module to your app's `package.json`:

```json
{
  "dependencies": {
    "route-matcher-native": "file:./modules/route-matcher-native"
  }
}
```

Rebuild your app:
```bash
npx expo prebuild --clean
npx expo run:ios  # or run:android
```

## API Reference

### `createSignature(activityId, points, config?)`

Create a simplified route signature from GPS points.

```typescript
const signature = RouteMatcher.createSignature(
  'activity-123',
  [{ latitude: 51.5074, longitude: -0.1278 }, ...],
  { maxSimplifiedPoints: 50 }  // optional config
);
```

### `compareRoutes(sig1, sig2, config?)`

Compare two signatures and return match result.

```typescript
const result = RouteMatcher.compareRoutes(sig1, sig2);
// result: { matchPercentage: 95.5, direction: 'forward', frechetDistance: 12.3, ... }
```

### `groupSignatures(signatures, config?)`

Group similar routes together.

```typescript
const groups = RouteMatcher.groupSignatures(allSignatures);
// groups: [{ groupId: 'activity-1', activityIds: ['activity-1', 'activity-5', ...] }, ...]
```

### `getDefaultConfig()`

Get default configuration values.

### `isNative()`

Returns `true` if using the native Rust implementation.

## Configuration Options

```typescript
interface MatchConfig {
  maxFrechetDistance: number;      // Max distance in meters (default: 100)
  minMatchPercentage: number;      // Min match % to consider similar (default: 80)
  simplificationTolerance: number; // Douglas-Peucker tolerance (default: 0.0001)
  maxSimplifiedPoints: number;     // Max points after simplification (default: 50)
}
```

## Performance Comparison

| Dataset Size | JS Fallback | Native Rust |
|--------------|-------------|-------------|
| 100 routes   | ~500ms      | ~50ms       |
| 500 routes   | ~12s        | ~200ms      |
| 1000 routes  | ~50s        | ~500ms      |

The native implementation uses:
- Parallel processing with rayon
- R-tree spatial indexing for O(log n) pre-filtering
- SIMD-optimized Fréchet distance calculation
