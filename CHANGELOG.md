# Changelog

All notable changes to Veloq are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Planned as 0.4.0. On first launch the new section detector goes over the whole library, so some
sections are re-drawn and a feed card lists what moved. Every change can be reverted. A pass now
counts only when it covers the whole section, so some visit counts and PRs fall. Google no longer
restores the library on a new Android phone, so back up to `Documents/Veloq`. iOS 15 and earlier
stay on 0.3.8.

### Added

- **Activity recording.** Record with GPS, indoors or by hand. Recordings save on the phone first,
  list in a library, upload to intervals.icu and retry without ever deleting the local copy.
- Bluetooth heart rate, power and cadence sensors, with pairing, auto-reconnect and live tiles.
- Recording map with follow mode, recentre, and the nearest saved route drawn as an overlay.
- GPS accuracy presets, auto-pause, a signal-loss watchdog and battery settings for recording.
- Crash backups that survive stop and review, with offline gaps credited as paused time.
- Indoor recording keeps running with the phone locked.
- A pill to return to a recording in progress from anywhere in the app.
- Planned workouts from the intervals.icu calendar when starting a recording.
- Home screen shortcuts that start a recording from outside the app.
- Summary, Latest Activity, Insights and Strength home screen widgets on iOS and Android.
- Notifications built on the phone, with route and section names in the body and one notification
  per ride.
- iOS notification service extension so notifications arrive ready to open.
- Google Drive as a backup destination, and Save to device for exports.
- Automatic Android backups to `Documents/Veloq`, verified before the old copy is removed.
- Restore offer on a fresh install when a backup is found, naming where it was found.
- Backups and exports can be cancelled.
- Terrain 3D map, with a setting for when maps draw in 3D.
- Basemap tiles, glyphs and heatmap tiles served from the engine, so maps work offline.
- Heatmap tiles drawn on request at close zoom.
- Climbing bests and route insights.
- Lengths tab for pool swims.
- Section direction chevrons on maps, and track start and end markers.
- Section history that explains each re-cut, with Restore, Remove and Prefer on the detection map.
- Retired sections list, so a section the detector drops can be brought back.
- Distance or Time toggle on the activity chart, with the line coloured by grade.
- Undo on excluded attempts, and reversible section removal.
- App tour, offered from the feed, with notification and backup prompts.
- What's New and the tour as feed cards, shown after an update.
- Sync status pill, Retry on sync errors and Retry now on downloads.
- Crash screen with a shareable log.
- Experimental features page, each off until enabled: efficiency trends, section and wellness
  correlations, and a Garmin connector that fills in what intervals.icu cannot share.
- Delete-your-data page and a terms link from About.
- Pull to refresh on more screens.
- Dark and tinted app icons on iOS.
- Screen reader labels, roles and spoken charts across the app, with keyboard support.
- Haptics on navigation, destructive confirms and chart scrubs.
- Plural forms in every language, and regional locales stored as overrides of their base.

### Changed

- **Section detection.** One detector replaces the three methods from 0.3.7. Sections come out
  the same on every device, and the strictness setting is gone in favour of validated defaults.
- **New look.** Redesigned tab bar, Manrope type, a blue primary colour and a palette reworked for
  contrast.
- Tabs are Feed, Map, Fitness, Insights and Settings. Health is part of Fitness, which has four
  pages.
- Activity detail opens on the cached map picture straight away.
- Feed cards show cached basemap snapshots instead of live maps.
- Fitness and fatigue are read from intervals.icu.
- Sports are grouped into seven families. Electric mountain bike rides count as cycling and
  activities with no sport count as Other.
- Routes and sections lists page in from the engine, and empty lists explain why they are empty.
- Section performance panel rebuilt, with the line coloured where time was won or lost.
- Heatmap drawn in five steps per basemap.
- Map sheet docks beside the map on wide windows and opens rows as cards.
- Map layer choices persist across launches.
- Comparisons withhold partial periods.
- Dates show in the ride's own time zone.
- The app follows the phone's language, clock, number format, bold text and reduce motion settings.
- Content-shaped placeholders on first load, and content centred on wide windows.
- Launch prompts wait until the second day of use.
- Notifications ask for permission from the feed. On Android the insights channel is new, so a mute
  or sound set on the old channel is reset.
- Sign-in persists through app restarts.
- First sync downloads its backlog in one burst, newest activities first, and resumes after the
  intervals.icu request limit.
- intervals.icu requests are budgeted per install.
- Engine work runs off the main thread at low priority, and the first window draws 220 ms sooner.
- Persisted and computed data (feed, activity detail, fitness, insights, strength, sections) is
  read from the Rust engine.
- Efficiency trend moved to the experimental features page.
- The app runs in portrait only. On iOS, intervals.icu links no longer open Veloq.
- Expo SDK 58 and React Native 0.88.
- iOS 16.4 or later is required.

### Removed

- Section detection method picker and strictness setting.
- Record widget.
- Tip links outside the App Store on iOS.

### Fixed

- Unreadable engine databases are quarantined and the app offers recovery instead of failing to
  open.
- Recovery from dead worker threads, poisoned locks, sync panics and partial load failures.
- The library is copied before migrations, and a failed restore rolls back.
- Engine start failure reaches the screen, and Retry reruns the full start.
- Engine start recovers from low memory.
- Map style load failures retry on Android.
- Section detection race on first launch.
- Sections that cannot be read are repaired.
- Sections that grow apart are split, and only full rides count in section lists.
- Old sections stay live when a rebuild finds none.
- Rides sync could not ready are marked with Retry.
- iOS launch abort.
- Android back navigation.
- Tip purchases.
- Card hold menus no longer block back or swipe.
- Charts stay left to right in right-to-left languages.
- Labels wrap and values fit at large text sizes.
- First row of the Android Sections list.

### Security

- OAuth uses PKCE, and push device tokens are verified.
- The permission upgrade trusts only the scope intervals.icu returns.
- Garmin keys are kept in the keychain.

## [0.3.8] - 2026-05-18

### Changed

- Section trim editor redesigned with a precision slider, step buttons and haptics. The map
  expands while editing.
- FTP is shown separately from eFTP, and insights are labelled by sport.

### Fixed

- FTP display uses current sport settings instead of stale activity values.
- Season comparison bars in the right order (previous left, current right).
- Swimming pace shown as min/100m.
- Duplicate cluster labels on the Android map.
- Map stability from orphaned retry timers and a missing camera.

## [0.3.7] - 2026-05-15

### Added

- Three section detection methods (Corridor, Density Grid, Flow Graph), each with its own sliders
  and a live preview.
- Reanalyse button that lights up when a setting has changed.

### Fixed

- Section detection across sports.
- Nearest-distance sort in the sections list.
- Empty section pages. Matched activities and effort history are back.
- Section performance charts after switching to demo or another athlete.

## [0.3.6] - 2026-05-12

### Changed

- Faster activity sync with batch ingestion.
- Fewer engine calls, batched notifications and deferred sparklines.

### Fixed

- In-app purchases on iOS.
- Crash when leaving demo mode, and a profile icon that lingered after.
- Crash on Android sign-out.
- Notification importance, and section detection stuck after a sync.

## [0.3.5] - 2026-05-08

### Changed

- Map settings compacted into an accordion with smaller previews.
- Data sources moved below support.

### Fixed

- Tip buttons not appearing in some configurations.

## [0.3.4] - 2026-05-05

### Changed

- Route PRs compare same-direction attempts only.
- Section PRs use fastest pace instead of shortest time.
- Route chart y-axis shows time, shorter higher.
- PR badge on activity cards shows the delta to the PR.

### Fixed

- PR consistent across card badges, charts and detail views.

## [0.3.3] - 2026-05-04

### Changed

- Support card wording and icon.

### Fixed

- Race when closing the store connection.

## [0.3.2] - 2026-05-01

### Changed

- Support section redesigned, with remind later and don't show again.

## [0.3.1] - 2026-04-30

### Added

- Tips from the home screen or settings.

### Changed

- UniFFI 0.31.

## [0.3.0] - 2026-04-28

### Added

- **Daily insights.** Section PRs, fitness milestones, period comparisons and more, each opening
  to show the data and method behind it.
- **Strength.** Exercise sets read from FIT files, body diagrams with muscle group volume,
  agonist and antagonist balance, and four-week progression.
- **Notifications.** Opt-in post-activity notifications through the OAuth proxy, with a toggle
  per category.
- Pin, accept or disable sections, adjust detection sensitivity, and set a reference effort.
- Trim and extend sections, and exclude an activity from a section.
- Search and sort the sections list.
- Best Efforts: power and pace PRs across all activities, tapping through to the source.
- Map heatmap, gradient polylines, activity clustering and separate route and section toggles.
- Ramp rate, form percentage, temperature and gradient charts.
- PR trophies, trend pills and sparkline section cards in the feed.
- Sync progress shown stage by stage.
- Backup and restore of settings and decisions, with a warning that backups are not encrypted.

### Changed

- Insights tab replaces Routes.
- Section cards split by direction.
- Faster transfers and section loading.
- Dark mode contrast.

### Fixed

- Section delete, extend and trim highlight.
- Pull to refresh emptying the feed.
- 403 responses treated as network errors.

## [0.2.2] - 2026-03-13

### Added

- Activity heatmap on the Health page, linked to scrubbing the wellness charts.
- Fitness, fatigue and form in the hero row with zone labels.
- Fatigue line on the summary sparkline.
- Smart 3D terrain mode (Off, Smart, Always), and map style and 3D per activity.
- Satellite and vector tile caching.
- What's New panel with tips.
- Error boundaries on every screen.

### Changed

- 3D maps on MapLibre GL JS 5, with terrain fixes and circle markers.
- Cyan scrub highlight on 2D and 3D maps.
- Settings reorganised with cache details.
- Rust engine split into domain objects.

### Fixed

- Offline mode reliability, with pull to refresh available offline.
- Activity map not responding to touch.
- Memory leak in render timing.
- 3D renders that stalled when rate limited now retry later.

## [0.2.1] - 2026-02-27

### Changed

- 3D map styling and background colours across all map themes.
- Full map tile resolution restored for previews.

### Fixed

- Dark halo around activity card text on iOS with the light theme.

## [0.2.0] - 2026-02-21

### Added

- Change indicators on each activity card metric.
- Time or distance x-axis on activity charts, with the average drawn on the line.
- Power zones and intervals table in activity detail.
- Season bests alongside personal records.

### Changed

- Fitness chart combines fitness and fatigue, with form as a line and zone markers.
- Feed filters unnested, search bar collapsible, sparklines longer.
- Map expands into the card, with a contrasting trace border.
- Cards without a map are minimised.
- Feed card re-renders down from 400 ms to 50 ms.

## [0.1.4] - 2026-02-16

### Fixed

- Weekly stats appear straight after activity sync instead of showing 0 until GPS download ends.
- Memory leak on the map page.
- Routes and sections loading on first launch.

## [0.1.3] - 2026-02-13

### Changed

- Hold to highlight sections in the section list, replacing scrubbing.

### Fixed

- Section pace shows the pace of each effort.
- Duplicate entries in performance history charts.

## [0.1.2] - 2026-02-13

### Added

- Export every activity as GPX in one go.
- GPX export of sections.
- Scrollable stats on feed cards.
- Debug dashboard.

### Changed

- Routes screen faster, with better paging.
- Export buttons moved to the bottom of detail pages.
- Sections grouped into time periods.
- Rendering work across the feed, charts, maps and Health page.

### Fixed

- Backup restore for custom sections.
- Crash scrubbing the season comparison chart.
- Section detail crash with many traversals.
- Health page crashes on older devices.

## [0.1.1] - 2026-02-05

### Fixed

- Mini traces disappearing when highlighting routes and sections.
- Section direction not persisting.
- Cache clear and sign-out races.
- Custom section activity matching.
- Stale cache.

## [0.1.0] - 2026-02-01

Upgrading from 0.0.7 may need a re-sync if a migration fails: Settings, Clear Cache, then sync.

### Added

- Imperial or metric units, detected from intervals.icu and overridable in settings.
- Per-direction statistics on sections.
- SQLite migrations for schema upgrades.
- Third-party licences screen.
- Y-axis labels, average line and scrub tooltip on activity charts.
- Combined markers and zoom out on the global map.

### Changed

- Initial sync about ten times faster.
- Fitness tab reorganised with power and pace curves and training zones.
- Routes and sections sorted by pace for running.
- Weekly stats use calendar weeks (Monday to Sunday), and year comparisons use calendar years.
- Tab navigation, with a hero card on the home screen.
- MapLibre 10 on both platforms.
- Lower memory use.

### Removed

- Heatmap, until its data is validated.

### Fixed

- Section persistence, creation, naming and reference selection.
- Map rendering in lists, marker taps on iOS and attribution switching.
- Scrubbing in season comparison and the section list.
- Camera snapping when adding sections.
- Imperial calculations for section results.

## [0.0.7] - 2026-01-22

### Added

- Activity toggle on the regional map.
- Aerial and satellite basemaps.
- Custom section creation with a map legend.

### Changed

- Fewer GPS points needed to create a section.

### Fixed

- iOS crashes from the location button, fullscreen charts and section creation.
- Map stability when switching states.

## [0.0.6] - 2026-01-22

### Fixed

- iOS crash on activities with invalid GPS data.
- Map stability, with stricter GeoJSON validation.

## [0.0.5] - 2026-01-21

### Added

- 3D terrain without selecting an activity, with routes, sections and traces.
- Section endpoint markers, chart scrubbing and time gap compression.
- Forward and reverse section directions.

### Changed

- Map centres on the most recent activity.
- Heatmap disabled until its data is validated.

### Fixed

- Scrubbing lag, by caching time streams in the engine.
- Yesterday's activities showing as today.
- MapLibre crash on sparse polylines.

## [0.0.4] - 2026-01-20

### Added

- Every screen orientation.
- 16 KB page alignment for newer Android devices.

### Changed

- Traversal direction detection for sections.

### Fixed

- Android native module loading.

## [0.0.3] - 2026-01-20

### Changed

- Android builds for `arm64-v8a` and `x86_64` only.

### Fixed

- Android packaging conflicts with React Native libraries.

## [0.0.2] - 2026-01-14

### Added

- PR trophy and rank badges on route performances, timed from GPS matching.
- Route and section naming on iOS.

### Changed

- Home screen shows four stat pills without expanding.

### Fixed

- Custom route names survive regrouping and restarts.
- Section performance data refreshes when sections change.

### Removed

- Unused achievement system.

## 0.0.1 - 2025-12-22

### Added

- Initial build.
- API key and OAuth sign-in.
- Activity feed with filters.
- Activity detail with maps, charts and scrubbing.
- Route matching and section detection in Rust.
- Fitness, wellness, power and pace curves.
- Regional map with every activity and 3D terrain.
- Demo mode.
- Translations and dark mode.

[unreleased]: https://github.com/evanjt/veloq/compare/0.3.8...HEAD
[0.3.8]: https://github.com/evanjt/veloq/compare/0.3.7...0.3.8
[0.3.7]: https://github.com/evanjt/veloq/compare/0.3.6...0.3.7
[0.3.6]: https://github.com/evanjt/veloq/compare/0.3.5...0.3.6
[0.3.5]: https://github.com/evanjt/veloq/compare/0.3.4...0.3.5
[0.3.4]: https://github.com/evanjt/veloq/compare/0.3.3...0.3.4
[0.3.3]: https://github.com/evanjt/veloq/compare/0.3.2...0.3.3
[0.3.2]: https://github.com/evanjt/veloq/compare/0.3.1...0.3.2
[0.3.1]: https://github.com/evanjt/veloq/compare/0.3.0...0.3.1
[0.3.0]: https://github.com/evanjt/veloq/compare/0.2.2...0.3.0
[0.2.2]: https://github.com/evanjt/veloq/compare/0.2.1...0.2.2
[0.2.1]: https://github.com/evanjt/veloq/compare/0.2.0...0.2.1
[0.2.0]: https://github.com/evanjt/veloq/compare/0.1.4...0.2.0
[0.1.4]: https://github.com/evanjt/veloq/compare/0.1.3...0.1.4
[0.1.3]: https://github.com/evanjt/veloq/compare/0.1.2...0.1.3
[0.1.2]: https://github.com/evanjt/veloq/compare/0.1.1...0.1.2
[0.1.1]: https://github.com/evanjt/veloq/compare/0.1.0...0.1.1
[0.1.0]: https://github.com/evanjt/veloq/compare/0.0.7...0.1.0
[0.0.7]: https://github.com/evanjt/veloq/compare/0.0.6...0.0.7
[0.0.6]: https://github.com/evanjt/veloq/compare/0.0.5...0.0.6
[0.0.5]: https://github.com/evanjt/veloq/compare/0.0.4...0.0.5
[0.0.4]: https://github.com/evanjt/veloq/compare/0.0.3...0.0.4
[0.0.3]: https://github.com/evanjt/veloq/compare/0.0.2...0.0.3
[0.0.2]: https://github.com/evanjt/veloq/releases/tag/0.0.2
