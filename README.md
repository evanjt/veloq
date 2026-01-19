<p align="center">
  <img src="docs/icon.png" width="80" alt="Veloq">
</p>

<h1 align="center">Veloq</h1>

<p align="center">
  <strong>Open-source mobile client for <a href="https://intervals.icu">Intervals.icu</a></strong><br>
  Maps, charts, and fitness tracking — open source, your data stays yours.
</p>

<p align="center">
  <a href="https://veloq.fit">Website</a> •
  <a href="https://github.com/evanjt/veloq/releases">Download</a> •
  <a href="https://veloq.fit/privacy">Privacy</a>
</p>

---

<p align="center">
  <img src="docs/screenshots/01-feed.png" width="19%" alt="Activity Feed">
  <img src="docs/screenshots/02-activity-map.png" width="19%" alt="Activity Map">
  <img src="docs/screenshots/04-charts.png" width="19%" alt="Charts">
  <img src="docs/screenshots/05-fitness.png" width="19%" alt="Fitness">
  <img src="docs/screenshots/07-routes.png" width="19%" alt="Routes">
</p>

## Features

- **Maps** — Interactive GPS visualization with 3D terrain and heatmaps
- **Charts** — Heart rate, power, pace, elevation with synchronized map scrubbing
- **Route Matching** — Automatic detection of repeated routes for progress tracking
- **Fitness** — CTL/ATL/TSB model with form zone visualization

See [veloq.fit](https://veloq.fit) for the full feature list.

## Getting Started

1. Download from [GitHub Releases](https://github.com/evanjt/veloq/releases)
2. Sign in with **OAuth** or use an **API key** from [Intervals.icu Settings](https://intervals.icu/settings)

## Development

```bash
npm install

npx expo run:android    # Run on Android
npm expo run:ios        # Run on iOS
```

**Stack:** React Native + Expo, TanStack Query, Zustand, Victory Native, MapLibre, Rust (route matching)

## Privacy

Veloq doesn't store your data — but we have no control over data stored on intervals.icu. All analytics and activity data is sourced from there. OAuth uses a lightweight proxy for token exchange; API key mode is fully serverless.

Routes and sections are generated on-device using [tracematch](https://github.com/evanjt/tracematch).

- [Privacy Policy](https://veloq.fit/privacy)
- [intervals.icu Terms](https://forum.intervals.icu/tos)

## License

[Apache 2.0](LICENSE)
