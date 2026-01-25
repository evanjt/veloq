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

## Running Tests

### Quick Start

1. Build and install the app on a simulator/emulator
2. Run smoke test:
   ```bash
   npm run maestro:smoke
   ```

### Available Test Commands

| Command | Description |
|---------|-------------|
| `npm run maestro:smoke` | Basic app launch + demo mode entry |
| `npm run maestro:auth` | Authentication flows (demo mode, API key) |
| `npm run maestro:navigation` | All screen navigation tests |
| `npm run maestro:data` | Data verification tests |
| `npm run maestro:screenshots` | Capture marketing screenshots |
| `npm run maestro:all` | Run entire test suite |

### Run Individual Flows

```bash
maestro test .maestro/smoke.yaml
maestro test .maestro/navigation-main-tabs.yaml
```

### Run All Tests

```bash
maestro test .maestro/
```

## Test Flows

| Flow | Purpose |
|------|---------|
| `smoke.yaml` | Basic sanity check |
| `auth-demo-mode.yaml` | Demo mode entry flow |
| `auth-api-key-validation.yaml` | API key error handling |
| `navigation-main-tabs.yaml` | Bottom tab navigation |
| `navigation-secondary.yaml` | Settings, About, etc. |
| `navigation-activity-detail.yaml` | Activity detail screens |
| `data-verification.yaml` | Verify data displays correctly |
| `screenshots-light.yaml` | Light theme screenshots |
| `screenshots-dark.yaml` | Dark theme screenshots |

## Screenshots

Screenshots are saved to `~/.maestro/tests/{timestamp}/screenshots/`

To capture for App Store:
```bash
npm run maestro:screenshots
```

## Debugging

### Interactive Mode (Maestro Studio)

Launch interactive test builder:
```bash
maestro studio
```

This opens a browser UI where you can:
- See the device screen in real-time
- Click elements to generate test commands
- Build tests visually

### Verbose Output

```bash
maestro test .maestro/smoke.yaml --debug-output ./debug
```

## CI Integration

### EAS Workflows

See [Expo E2E with Maestro docs](https://docs.expo.dev/eas/workflows/examples/e2e-tests/)

Example workflow (`.eas/workflows/e2e-maestro.yml`):
```yaml
build:
  name: Build for E2E
  type: build
  params:
    platform: android
    profile: e2e-test

test:
  name: Run Maestro Tests
  needs: [build]
  type: maestro
  params:
    flow_path: .maestro/
    app_path: ${{ needs.build.outputs.build_path }}
```

## Comparison to Detox

| Aspect | Detox (current) | Maestro |
|--------|-----------------|---------|
| Sync handling | Disabled (TanStack Query) | Not needed (black-box) |
| Test syntax | Jest + async/await | YAML |
| Setup | Complex | Install CLI only |
| Deep links | `device.openURL()` | `openLink:` |
| testID access | `by.id()` | `id:` selector |

## Migration Notes

The same `testID` props work with both frameworks, so existing instrumentation is reused.
