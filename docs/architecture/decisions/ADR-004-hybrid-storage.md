# ADR-004: AsyncStorage + FileSystem Hybrid Storage

## Status
Accepted

## Context
Veloq caches GPS tracks locally for route matching. A single activity's GPS track contains:
- 500-2000 coordinate pairs (lat/lng)
- Metadata (timestamps, elevation, etc.)
- Total: ~10-40KB per activity

For a user with 1000 activities:
- Total storage: 10-40MB of coordinate data
- AsyncStorage limit: 6MB (iOS), slightly higher on Android
- **Problem**: GPS tracks alone would exceed AsyncStorage capacity

## Problem
**AsyncStorage Issues:**
- Size limits (6MB on iOS is hard limit)
- Synchronous API (can block if reading large values)
- No file structure (all key-value flat)
- Not designed for binary data

**FileSystem Issues:**
- Not guaranteed to persist across app updates (Android)
- Slower for small metadata reads
- More complex API (file handles, paths)
- No built-in query capability

## Decision
Use a hybrid storage strategy:
- **AsyncStorage**: Metadata, small JSON objects, queryable indexes
- **FileSystem**: Large GPS track data (polylines), cached per file

**Data Split:**
```
AsyncStorage (Metadata):
├── activity_index           → [id1, id2, id3, ...]
├── activity:<id>            → {name, date, distance, ...}
├── gps:<id>                 → {hasGps: true, trackFile: 'gps_<id>.dat'}
└── engine_state             → {lastSync: timestamp, ...}

FileSystem (GPS Tracks):
├── gps_data/
│   ├── gps_<id1>.dat        → [lat,lng,lat,lng,...]
│   ├── gps_<id2>.dat
│   └── ...
└── routes.db                  → SQLite database (Rust engine)
```

**Implementation:**
- `gpsStorage.ts` manages hybrid storage
- AsyncStorage stores file path references
- FileSystem stores actual coordinate arrays
- Cleanup routine removes orphaned files

## Consequences

### Positive
- **Scalability**: Can store thousands of activities (tested to 5000+)
- **Performance**: Small metadata reads avoid file system overhead
- **Queryability**: Activity list stored in AsyncStorage for fast queries
- **Flexibility**: Can swap storage layers independently

### Negative
- **Complexity**: Must maintain two storage systems in sync
- **Orphan Risk**: FileSystem files can become detached from AsyncStorage references
- **Cleanup Overhead**: Need background job to clean unused files
- **Race Conditions**: File write/delete can happen concurrently with reads

### Mitigation
- Use `Promise.allSettled` to tolerate individual file failures
- Atomic file writes (write to temp, then rename)
- Cleanup routine on app start removes files not referenced in AsyncStorage
- Try/catch around file operations with graceful degradation

## Storage Limits

| Platform | AsyncStorage | FileSystem | Total Practical Limit |
|----------|---------------|-------------|------------------------|
| iOS      | 6MB (hard limit) | No practical limit | ~1000 activities |
| Android  | ~10MB | No practical limit | ~1500 activities |

## Performance Characteristics

| Operation | AsyncStorage | FileSystem | Winner |
|-----------|---------------|-------------|--------|
| Read metadata (1KB) | ~2ms | ~10ms | AsyncStorage |
| Read GPS track (20KB) | ~50ms | ~15ms | FileSystem |
| Write metadata | ~3ms | ~12ms | AsyncStorage |
| Write GPS track | ~60ms | ~20ms | FileSystem |
| Query by key | O(1) | O(n) scan | AsyncStorage |

## File Naming Strategy

**GPS Track Files:**
```
gps_<activity_id>_<timestamp>.dat
```

- Activity ID ensures uniqueness
- Timestamp supports multiple versions (if needed)
- `.dat` extension indicates binary data

**Example:**
```
gps_1234567890abcdef_1704067200.dat
```

## Cleanup Strategy

**On App Start:**
1. Load all `gps:<id>` entries from AsyncStorage
2. Scan `gps_data/` directory
3. Delete files not in reference set
4. Remove broken AsyncStorage references

**On Activity Delete:**
1. Delete `activity:<id>` from AsyncStorage
2. Remove ID from `activity_index`
3. Delete `gps_<id>.dat` file
4. Update Rust engine (remove from SQLite)

## Alternatives Considered

### Alternative 1: FileSystem Only
**Pros**: Single storage system, simpler
**Cons**: Slow metadata queries, no built-in indexing

### Alternative 2: SQLite for Everything
**Pros**: ACID transactions, structured queries
**Cons**: Larger dependency (need SQLite JS library), FFI complexity

### Alternative 3: Realm Database
**Pros**: Object-oriented, sync APIs
**Cons**: Large library size, licensing costs for commercial use

### Alternative 4: IndexedDB (Capacitor)
**Pros**: Standard web API, structured data
**Cons**: Higher overhead, not available on React Native directly

## Future Improvements

**Phase 1 (Current):** Hybrid AsyncStorage + FileSystem
**Phase 2:** Consider SQLite for metadata if query complexity increases
**Phase 3:** Investigate mmap for large file access

## References
- AsyncStorage limits: https://react-native-async-storage.github.io/async-storage/docs/advanced/limits
- FileSystem docs: https://docs.expo.dev/versions/latest/sdk/file-system/
- Implementation: `src/lib/storage/gpsStorage.ts`
