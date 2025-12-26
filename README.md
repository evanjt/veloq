# Veloq

A fast, offline-first mobile client for [Intervals.icu](https://intervals.icu) with a focus on maps and visual analytics.

## Features

### Map-First Visualization

- **Regional Activity Map** — View all your activities on an interactive map with timeline filtering. Slide through weeks, months, or years to see where you've trained.
- **Activity Heatmap** — Density visualization showing your most frequently traveled routes. Tap cells to see which activities passed through.
- **3D Terrain Mode** — Explore activities with elevation rendering and synchronized map-chart scrubbing.
- **Multiple Map Styles** — Switch between light, dark, and satellite views. Configure default styles per activity type.

### Rich Activity Analysis

- **Multi-Metric Charts** — Overlay heart rate, power, pace, elevation, and cadence on a single interactive chart. Toggle between combined and stacked views.
- **Synchronized Scrubbing** — Drag through charts to highlight your position on the map in real-time.
- **Zone Distribution** — Pie charts showing time spent in each power and heart rate zone.
- **Training Metrics** — TSS, intensity factor, efficiency factor, and aerobic decoupling calculated for each activity.
- **Lap Breakdown** — View per-lap statistics for structured workouts.

### Route Intelligence

- **Automatic Route Matching** — The app detects when you repeat a route, grouping activities regardless of start point or direction.
- **Performance Comparison** — Track your times on repeated routes to measure progress over months or years.
- **Frequent Sections** — Identify commonly traveled portions of routes with detailed match analysis.
- **GPS Geometry Analysis** — Route matching uses modified Hausdorff distance algorithms implemented in Rust for speed and accuracy.

### Fitness Tracking

- **CTL/ATL/TSB Model** — Monitor your chronic training load (fitness), acute training load (fatigue), and training stress balance (form).
- **Form Zone Visualization** — See at a glance whether you're fresh, fatigued, or peaked.
- **Long-Term Trends** — View fitness progression over weeks, months, or an entire year.

### Wellness Metrics

- **HRV & Resting Heart Rate** — Track heart rate variability and morning heart rate trends.
- **Sleep Data** — Duration, quality, and sleep score visualization.
- **Subjective Metrics** — Stress, fatigue, soreness, mood, and motivation tracking.
- **Body Metrics** — Weight, body fat, and blood pressure trends.

### Performance Analysis

- **Power Curves** — Best efforts at every duration from 1 second to multiple hours.
- **Pace Curves** — Running and swimming performance modeling with critical speed calculations.
- **FTP & Threshold Tracking** — Monitor functional threshold power and lactate threshold changes over time.
- **Sport-Specific Views** — Switch between cycling, running, and swimming with appropriate metrics for each.

### Offline-First Architecture

- **Aggressive Caching** — Activity data is stored locally for instant access without network.
- **Background Sync** — New activities download automatically when connected.
- **Checkpoint Resume** — Long sync operations resume where they left off if interrupted.
- **Configurable Storage** — Control how much data to cache and for how long.

## Screenshots

<!-- TODO: Add screenshots -->

## Getting Started

1. Get your API key from [Intervals.icu Settings](https://intervals.icu/settings) → Developer Settings
2. Install Veloq from [GitHub Releases](https://github.com/evanjt/veloq/releases) or F-Droid
3. Enter your athlete ID and API key

## Development

```bash
npm install
npm start

# Platform-specific
npm run android
npm run ios

# Build Rust module (required for native builds)
npm run build:rust:android
npm run build:rust:ios

# Tests
npm test
```

### Architecture

| Layer | Technology |
|-------|------------|
| UI Framework | React Native + Expo SDK 54 |
| Server State | TanStack Query with AsyncStorage persistence |
| Local State | Zustand |
| Charts | Victory Native + Skia |
| Maps | MapLibre GL |
| Route Matching | Custom Rust module with UniFFI bindings |
| UI Components | React Native Paper |

---

## Privacy Policy

**Last updated: December 26, 2025**

### Overview

Veloq operates entirely on your device. We do not run servers, collect data, or process your personal information.

### Data Handling

- All data is fetched directly from Intervals.icu using your credentials
- Data is cached locally for offline access
- No data is sent anywhere except Intervals.icu and map tile providers

### Local Storage

Stored on your device only:

- **API credentials** — Encrypted using platform secure storage
- **Activity data** — Cached for offline use
- **Preferences** — Theme, map settings

### Third-Party Services

- **Intervals.icu** — Your fitness data source ([privacy policy](https://intervals.icu/privacy))
- **Map tiles** — OpenStreetMap, Carto, Stadia (standard web requests)

No analytics, ads, crash reporting, or tracking SDKs.

### Data Sharing

None. The developer has no access to your data.

### Security

- Encrypted credential storage
- HTTPS for all network requests
- No background telemetry

### Children's Privacy

Not intended for users under 13. No data is collected from any user.

### Your Rights

Delete all local data by uninstalling the app or clearing app data in device settings.

### Changes

Policy may be updated. Check the "Last updated" date.

### Contact

[GitHub Issues](https://github.com/evanjt/veloq/issues) or [veloq@evanjt.com](mailto:veloq@evanjt.com)

---

## License

Apache License 2.0 — See [LICENSE](LICENSE)
