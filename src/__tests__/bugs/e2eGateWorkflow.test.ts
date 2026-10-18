/**
 * Static guards for the E2E gate that runs after every push to main.
 *
 * Scenario: a workflow whose jobs can be skipped (a path filter drops the map
 * suite), where a skipped job reports neutral, which reads as green.
 * Expected behaviour: one always-run job decides the gate, the suite is never
 * rerun wholesale from the previous run's device state, and the App Store
 * rejection regression flow is inside the blocking set.
 */

import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const GATE_PATH = path.join(REPO_ROOT, '.github/workflows/e2e-gate.yml');
const IAP_FLOW_PATH = path.join(REPO_ROOT, '.maestro/settings-support-iap.yaml');

const yaml = require('js-yaml') as { load: (source: string) => unknown };
// The matcher dorny/paths-filter uses, with the option it passes.
const picomatch = require('picomatch') as (
  glob: string[],
  options: { dot: boolean }
) => (file: string) => boolean;

type Step = {
  name?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  with?: { script?: string; name?: string; 'retention-days'?: number };
};
type Job = {
  needs?: string | string[];
  if?: string;
  'runs-on'?: string;
  uses?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
  steps?: Step[];
};
type FilterStep = Step & { id?: string; with?: { filters?: string } };

const gateSource = fs.readFileSync(GATE_PATH, 'utf8');
const gate = yaml.load(gateSource) as { jobs: Record<string, Job> };
const jobNames = Object.keys(gate.jobs);

const REQUIRED_JOB = 'gate-required';

function needsOf(job: Job): string[] {
  if (!job.needs) return [];
  return Array.isArray(job.needs) ? job.needs : [job.needs];
}

function scriptsOf(job: Job): string[] {
  return (job.steps ?? []).flatMap(
    (step) => [step.run, step.with?.script].filter(Boolean) as string[]
  );
}

// Where a step reads a job result: the `run` body, or the `env` block feeding it.
function resultRefsOf(job: Job): string {
  return (job.steps ?? [])
    .flatMap((step) => [step.run ?? '', ...Object.values(step.env ?? {})])
    .join('\n');
}

describe('e2e gate required job', () => {
  it('declares an always-run job for branch protection to point at', () => {
    expect(jobNames).toContain(REQUIRED_JOB);
    expect(gate.jobs[REQUIRED_JOB].if).toBe('always()');
  });

  it('depends on every other job, so none can be skipped into a green report', () => {
    const needs = needsOf(gate.jobs[REQUIRED_JOB]);
    const others = jobNames.filter((name) => name !== REQUIRED_JOB).sort();
    expect([...needs].sort()).toEqual(others);
  });

  it('treats a non-success result as a failure', () => {
    const refs = resultRefsOf(gate.jobs[REQUIRED_JOB]);
    for (const name of jobNames.filter((n) => n !== REQUIRED_JOB)) {
      expect(refs).toContain(`needs.${name}.result`);
    }
    expect(scriptsOf(gate.jobs[REQUIRED_JOB]).join('\n')).toMatch(/exit 1/);
  });
});

describe('e2e gate suite runs', () => {
  const suiteJobs = jobNames.filter((name) => name !== REQUIRED_JOB && name !== 'changes');

  it.each(suiteJobs)('%s never reruns a whole suite on failure', (name) => {
    for (const script of scriptsOf(gate.jobs[name])) {
      for (const line of script.split('\n')) {
        const runs = line.match(/maestro" test |maestro test /g) ?? [];
        expect(runs.length).toBeLessThan(2);
      }
    }
  });

  it('retries the failed flows instead, from a clean launch', () => {
    const script = scriptsOf(gate.jobs.gate).join('\n');
    expect(script).toContain('.maestro/run-suite.sh');
    const runner = path.join(REPO_ROOT, '.maestro/run-suite.sh');
    expect(fs.existsSync(runner)).toBe(true);
    expect(fs.statSync(runner).mode & 0o111).toBeGreaterThan(0);
  });
});

describe('store rejection regression flow', () => {
  const header = fs.readFileSync(IAP_FLOW_PATH, 'utf8').split('\n---')[0];
  const tags = [...header.matchAll(/^\s*-\s*([\w-]+)\s*(?:#.*)?$/gm)].map((m) => m[1]);

  it('is not quarantined out of the blocking gate', () => {
    expect(tags).not.toContain('flaky');
  });

  it('carries a tier the gate selects', () => {
    const gateTags = gateSource.match(/--include-tags=(tier[\d,tier]*)/)?.[1].split(',') ?? [];
    expect(gateTags.length).toBeGreaterThan(0);
    expect(tags.some((tag) => gateTags.includes(tag))).toBe(true);
  });
});

describe('flake evidence', () => {
  // Promotion out of the flaky lane needs 95 per cent over at least 20 runs,
  // and the gate runs about once a day, so the reports have to outlive the
  // window with room for a quiet fortnight. The debug bundle beside them is
  // two hundred megabytes and is not evidence, so it keeps a short life.
  const PROMOTION_WINDOW_RUNS = 20;
  const MIN_REPORT_RETENTION_DAYS = PROMOTION_WINDOW_RUNS * 2;
  const MAX_DEBUG_RETENTION_DAYS = 7;

  const uploads = Object.values(gate.jobs)
    .flatMap((job) => job.steps ?? [])
    .filter((step) => step.uses?.startsWith('actions/upload-artifact'))
    .map((step) => ({ name: step.with?.name ?? '', retention: step.with?.['retention-days'] }));
  const reports = uploads.filter((u) => u.name.endsWith('-report'));
  const debugBundles = uploads.filter((u) => u.name.endsWith('-debug'));

  it('uploads a report for the gate and for each map suite', () => {
    expect(reports.map((r) => r.name).sort()).toEqual([
      'e2e-gate-report',
      'e2e-ios-map-report',
      'e2e-map-report',
    ]);
  });

  it.each(reports)('$name outlives the promotion window', ({ retention }) => {
    expect(retention).toBeGreaterThanOrEqual(MIN_REPORT_RETENTION_DAYS);
  });

  it.each(debugBundles)('$name stays short-lived, it is not evidence', ({ retention }) => {
    expect(retention).toBeDefined();
    expect(retention).toBeLessThanOrEqual(MAX_DEBUG_RETENTION_DAYS);
  });
});

/**
 * Scenario: the AVD takes its RAM from the `pixel_6` device profile, 2 GB, and
 * shares it between system_server, Play services, the launcher, the app and
 * Maestro's own driver app, all under software GL. Run 34360266980 lost the
 * device server six times in seven minutes and every failure it reported was
 * that loss, not an assertion.
 *
 * Expected behaviour: each emulator job asks for enough RAM that the driver is
 * not the thing squeezed out. The runner has 16 GB and boots one emulator.
 */
describe('the gate emulators', () => {
  const emulatorSteps = Object.values(gate.jobs)
    .flatMap((job) => job.steps ?? [])
    .filter((step) => String(step.uses).startsWith('reactivecircus/android-emulator-runner'));

  it('runs at least one', () => {
    expect(emulatorSteps.length).toBeGreaterThan(0);
  });

  it.each(emulatorSteps.map((step, index) => [step.name ?? `step ${index}`, step] as const))(
    'gives %s more RAM than the device profile default',
    (_name, step) => {
      const ram = Number((step.with as { 'ram-size'?: string | number })?.['ram-size']);
      expect(ram).toBeGreaterThanOrEqual(4096);
    }
  );
});

/**
 * Scenario: a push that edits only the map tab screen, or the tile store in
 * the engine. The `maps` filter reads false, `map-gate` is skipped,
 * `gate-required` passes, and none of the pack-map flows runs against the
 * change.
 *
 * Expected behaviour: every file a pack-map flow exercises turns the filter
 * on, from the screen down to the engine's tile store and the Android tile
 * interceptor, and a file no map draws from leaves it off.
 */
describe('the map suite path filter', () => {
  const filterStep = (gate.jobs.changes.steps ?? []).find(
    (step) => (step as FilterStep).id === 'filter'
  ) as FilterStep;
  const filters = yaml.load(filterStep.with?.filters ?? '') as { maps: string[] };
  const isMapChange = picomatch(filters.maps, { dot: true });

  const MAP_SURFACES = [
    'src/app/(tabs)/map.tsx',
    'src/app/map-settings.tsx',
    'src/features/maps/components/RegionalMapView.tsx',
    'src/features/activity/components/ActivityMapPreview.tsx',
    'src/features/settings/components/MapStylePreviewPicker.tsx',
    'src/features/recording/components/RecordingMap.tsx',
    'src/features/routes/components/RouteMapView.tsx',
    'src/features/routes/lib/tilePass.ts',
    'modules/veloqrs/rust/veloqrs/src/basemap/store.rs',
    'modules/veloqrs/rust/veloqrs/src/objects/basemap.rs',
    'modules/veloqrs/rust/veloqrs/src/objects/tiles.rs',
    'modules/veloqrs/rust/veloqrs/src/tiles.rs',
    'modules/veloqrs/rust/veloqrs/src/persistence/tiles.rs',
    'modules/veloqrs/android/src/main/java/com/veloq/VeloqTileWebViewClient.java',
    'modules/veloqrs/android/src/main/java/com/veloq/TileBridge.java',
    'modules/veloqrs/android/src/main/java/com/veloq/TileIntercept.java',
    'modules/veloqrs/rust/veloqrs/src/basemap/listener.rs',
  ];

  it.each(MAP_SURFACES)('runs the map suite for a change to %s', (file) => {
    expect(fs.existsSync(path.join(REPO_ROOT, file))).toBe(true);
    expect(isMapChange(file)).toBe(true);
  });

  it.each([
    'src/features/settings/components/NotificationSection.tsx',
    'modules/veloqrs/rust/veloqrs/src/persistence/screens.rs',
  ])('leaves it off for a change to %s', (file) => {
    expect(isMapChange(file)).toBe(false);
  });
});

/**
 * Scenario: a dependency bump changes `package-lock.json` and crashes the map
 * on iOS. The map flows ran after a push only on the Android emulator, and the
 * iOS sweep never finished, so nothing ran a map flow on iOS at all.
 *
 * Expected behaviour: a push that changes a map surface, the lockfile or a
 * native module runs the pack-map flows on an iOS simulator too, from the Dev
 * simulator app the shared iOS build makes, through `run-suite.sh`.
 */
describe('the iOS map suite', () => {
  const filterStep = (gate.jobs.changes.steps ?? []).find(
    (step) => (step as FilterStep).id === 'filter'
  ) as FilterStep;
  // paths-filter flattens a list pulled in through a YAML alias.
  const filters = Object.fromEntries(
    Object.entries(yaml.load(filterStep.with?.filters ?? '') as Record<string, unknown[]>).map(
      ([name, globs]) => [name, globs.flat() as string[]]
    )
  );
  const iosJobName = jobNames.find(
    (name) =>
      /^macos/.test(String(gate.jobs[name]['runs-on'])) &&
      scriptsOf(gate.jobs[name]).some((script) => script.includes('--include-tags=pack-map'))
  );

  it('runs the pack-map flows on a macOS runner', () => {
    expect(iosJobName).toBeDefined();
  });

  it('retries the failed flows through run-suite.sh against the simulator', () => {
    const job = gate.jobs[iosJobName!];
    expect(scriptsOf(job).join('\n')).toMatch(
      /\.maestro\/run-suite\.sh\s+\S+\s+\S+\s+--include-tags=pack-map/
    );
    // The boot action exports the simulator's health check and restart, since
    // run-suite.sh falls back to adb and a simulator has none.
    expect((job.steps ?? []).map((step) => step.uses)).toContain(
      './.github/actions/boot-ios-simulator'
    );
  });

  it('installs the Dev simulator app the shared iOS build makes', () => {
    const builds = needsOf(gate.jobs[iosJobName!]).filter(
      (name) => gate.jobs[name].uses === './.github/workflows/build-ios.yml'
    );
    expect(builds).toHaveLength(1);
    expect(gate.jobs[builds[0]].with?.variant).toBe('dev');
    expect(JSON.stringify(gate.jobs[iosJobName!].steps)).toContain(
      `needs.${builds[0]}.outputs.simulator-artifact`
    );
  });

  const filterName = Object.keys(filters).find((name) =>
    String(gate.jobs[iosJobName ?? '']?.if ?? '').includes(`outputs.${name}`)
  );

  it('runs on its own filter, which the iOS build is gated on too', () => {
    expect(filterName).toBeDefined();
    expect(gate.jobs.changes as { outputs?: Record<string, string> }).toHaveProperty(
      `outputs.${filterName}`
    );
    const build = needsOf(gate.jobs[iosJobName!]).find(
      (name) => gate.jobs[name].uses === './.github/workflows/build-ios.yml'
    );
    expect(String(gate.jobs[build!].if)).toContain(`outputs.${filterName}`);
  });

  it.each([
    'src/app/(tabs)/map.tsx',
    'src/features/maps/components/RegionalMapView.tsx',
    'modules/veloqrs/rust/veloqrs/src/tiles.rs',
    'package-lock.json',
    'modules/veloqrs/ios/VeloqTileSchemeHandler.m',
  ])('runs for a change to %s', (file) => {
    const isIosMapChange = picomatch(filters[filterName!] ?? [], { dot: true });
    expect(isIosMapChange(file)).toBe(true);
  });

  it('leaves it off for a change no map or native module draws from', () => {
    const isIosMapChange = picomatch(filters[filterName!] ?? [], { dot: true });
    expect(isIosMapChange('src/features/settings/components/NotificationSection.tsx')).toBe(false);
  });
});
