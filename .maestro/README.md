# Maestro E2E Tests

Mobile UI testing using [Maestro](https://maestro.mobile.dev/).

## Prerequisites

Install Maestro CLI:
```bash
curl -Ls "https://get.maestro.mobile.dev" | bash
```

Verify installation:
```bash
maestro --version
```

Requires Java 17+ (Maestro 2.x dependency).

## Tier System

Flows are organized into tiers via tags. CI runs different tiers based on the event type.

| Tier | Tag | When | Purpose |
|------|-----|------|---------|
| **tier0** | `tier0` | Every push | Smoke test — app launches |
| **tier1** | `tier1` | Every push | Critical path — auth, navigation |
| **tier2** | `tier2` | PRs to main | Feature coverage — all screens |
| **tier3** | `tier3` | Nightly / manual | Stress tests — rapid interactions |
| **tier4** | `tier4` | Manual only | Marketing screenshots |

## Running Tests

### Quick Start

1. Build and install the app on a simulator/emulator
2. Run smoke test:
   ```bash
   npm run maestro:smoke
   ```

### Available Commands

| Command | Tiers | Description |
|---------|-------|-------------|
| `npm run maestro:smoke` | tier0 | Basic app launch + demo mode |
| `npm run maestro:critical` | tier0+tier1 | Smoke + critical path |
| `npm run maestro:tier2` | tier2 | Feature tests only |
| `npm run maestro:regression` | tier0+tier1+tier2 | Full regression suite |
| `npm run maestro:stress` | tier3 | Stress tests only |
| `npm run maestro:screenshots` | tier4 | Marketing screenshots |
| `npm run maestro:all` | tier0-tier3 | Everything except screenshots |

### Run Individual Flows

```bash
maestro test .maestro/smoke.yaml
maestro test .maestro/navigation-main-tabs.yaml
```

### Run by Tag

```bash
maestro test .maestro/ --include-tags=tier0,tier1
```

## Shared Helpers

Sub-flows in `.maestro/helpers/` provide reusable setup and navigation. They have no `appId` header so they cannot be run standalone.

| Helper | Purpose |
|--------|---------|
| `helpers/setup-demo-mode.yaml` | clearState, dismiss dialogs, enter demo mode, wait for home |
| `helpers/setup-demo-mode-warm.yaml` | Same but without clearState (for warm restarts) |
| `helpers/navigate-to-fitness.yaml` | Deep link to fitness screen |
| `helpers/navigate-to-training.yaml` | Deep link to training screen |
| `helpers/navigate-to-map.yaml` | Deep link to map screen |
| `helpers/navigate-to-routes.yaml` | Deep link to routes screen |
| `helpers/navigate-to-settings.yaml` | Deep link to settings screen |

Usage in a flow:
```yaml
- runFlow:
    file: helpers/setup-demo-mode.yaml

- runFlow:
    file: helpers/navigate-to-fitness.yaml
```

## Test Flows (41 total)

### Smoke & Auth (tier0, tier1)

| Flow | Tier | Purpose |
|------|------|---------|
| `smoke.yaml` | tier0 | Basic app launch, demo mode entry |
| `critical-path.yaml` | tier1 | Full navigation through all tabs |
| `auth-demo-mode.yaml` | tier1 | Demo mode authentication flow |
| `auth-api-key-validation.yaml` | tier1 | API key error handling |

### Navigation (tier2)

| Flow | Tier | Purpose |
|------|------|---------|
| `navigation-main-tabs.yaml` | tier2 | Bottom tab bar navigation |
| `navigation-secondary.yaml` | tier2 | Settings, About screens |
| `navigation-activity-detail.yaml` | tier2 | Activity detail screen flows |

### Feature Tests (tier2)

| Flow | Tier | Purpose |
|------|------|---------|
| `home-weekly-summary.yaml` | tier2 | Home screen weekly stats |
| `fitness-metrics.yaml` | tier2 | Fitness/form tracking |
| `fitness-collapsible-sections.yaml` | tier2 | Expand/collapse fitness sections |
| `fitness-time-range.yaml` | tier2 | Switch fitness time ranges |
| `wellness-dashboard.yaml` | tier2 | Wellness data display |
| `training-wellness-dashboard.yaml` | tier2 | Wellness indicators on training |
| `training-wellness-trends.yaml` | tier2 | Wellness trends chart |
| `routes-list.yaml` | tier2 | Routes listing |
| `sections-list.yaml` | tier2 | Sections listing |
| `route-detail.yaml` | tier2 | Route detail navigation |
| `section-detail.yaml` | tier2 | Section detail navigation |
| `section-rename.yaml` | tier2 | Section rename flow |
| `activity-charts.yaml` | tier2 | Activity chart rendering |
| `activity-card-stats.yaml` | tier2 | Activity card statistics |
| `activity-gpx-export.yaml` | tier2 | GPX export button |
| `activity-section-matches.yaml` | tier2 | Section matches on activity |
| `stats-power-curve.yaml` | tier2 | Power curve display |
| `data-verification.yaml` | tier2 | Data display verification |

### Settings (tier2)

| Flow | Tier | Purpose |
|------|------|---------|
| `settings-theme.yaml` | tier2 | Theme switching |
| `settings-logout.yaml` | tier2 | Logout returns to login |
| `settings-cache.yaml` | tier2 | Cache clear button |
| `settings-language.yaml` | tier2 | Language options |

### Map Tests (tier2)

| Flow | Tier | Purpose |
|------|------|---------|
| `map-comprehensive.yaml` | tier2 | Full map functionality |
| `map-timeline.yaml` | tier2 | Map timeline scrubbing |

### Stress Tests (tier3)

| Flow | Tier | Purpose |
|------|------|---------|
| `stress-activity-cycling.yaml` | tier3 | Rapid activity switching |
| `stress-activity-sections.yaml` | tier3 | Section loading under stress |
| `stress-chart-scrubbing.yaml` | tier3 | Rapid chart scrubbing |
| `stress-map-marker-taps.yaml` | tier3 | Rapid map marker interaction |
| `stress-map-toggles.yaml` | tier3 | Map toggle stress test |
| `stress-navigation-rapid.yaml` | tier3 | Rapid navigation switching |
| `stress-timeline-scrub.yaml` | tier3 | Timeline scrubbing performance |

### Screenshots (tier4)

| Flow | Tier | Purpose |
|------|------|---------|
| `screenshots-light.yaml` | tier4 | Marketing screenshots (light) |
| `screenshots-dark.yaml` | tier4 | Marketing screenshots (dark) |

## Writing New Flows

### Template

```yaml
# Flow Name
# Description of what this test verifies

appId: com.veloq.app
tags:
  - tier2
---
- runFlow:
    file: helpers/setup-demo-mode.yaml

# Navigate to feature
- runFlow:
    file: helpers/navigate-to-fitness.yaml

# Wait for content
- extendedWaitUntil:
    visible:
      id: "expected-element"
    timeout: 10000

# Verify behavior
- assertVisible:
    id: "expected-result"

# Document result
- takeScreenshot: "test-complete"
```

### Conventions

1. **Always use a helper** for setup and navigation
2. **Always add a tier tag** — no untagged flows
3. **Use testID** over text matching when possible
4. **Set generous timeouts** for React Native boot (30s) and data loading (15s)
5. **Handle system dialogs** with conditional flows in the setup helper
6. **Take screenshots** at the end of each flow for debugging
7. **Keep flows focused** — one feature per flow

## Screenshots

Screenshots are saved to `~/.maestro/tests/{timestamp}/screenshots/`

To capture for App Store:
```bash
npm run maestro:screenshots
```

## Debugging

### Interactive Mode (Maestro Studio)

```bash
maestro studio
```

Opens browser UI for real-time device view and visual test building.

### Verbose Output

```bash
maestro test .maestro/smoke.yaml --debug-output ./debug
```

## CI Integration

E2E tests run in `.github/workflows/simulator.yml`:

- **Every push**: tier0 + tier1 (smoke + critical path)
- **Pull requests**: tier0 + tier1 + tier2 (full regression)
- **Nightly (3am UTC)**: all tiers
- **Manual dispatch**: all tiers

Results are reported as GitHub Check annotations via JUnit reports. PRs get a sticky summary comment with pass/fail counts for both platforms.
