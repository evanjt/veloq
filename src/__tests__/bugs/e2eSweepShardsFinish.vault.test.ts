/**
 * Scenario: a scheduled sweep ran every flow tagged tier0 to tier3 in one job.
 * The iOS job was cancelled at 120 minutes and then at 180 every time, and the
 * Android job at 120 inside its retry pass, so neither platform ever reported a
 * complete result, and a cancelled job leaves a partial report at best.
 *
 * Expected behaviour: each platform's sweep is split into shards by pack tag,
 * every swept flow lands in exactly one shard, each shard's measured flow time
 * fits its run step's timeout with room for the retry pass, each shard runs
 * through `run-suite.sh`, uploads under its own names, and the summary reads
 * every shard's report and is red when a shard did not succeed.
 */

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const E2E_PATH = path.join(REPO_ROOT, '.github/workflows/e2e.yml');
const MAESTRO_DIR = path.join(REPO_ROOT, '.maestro');

const yaml = require('js-yaml') as { load: (source: string) => unknown };

type Step = {
  name?: string;
  run?: string;
  uses?: string;
  env?: Record<string, string>;
  with?: { name?: string; pattern?: string; script?: string };
  if?: string;
  'timeout-minutes'?: number;
};
type Shard = { name: string; packs: string; tiers: string };
type Job = {
  needs?: string | string[];
  if?: string;
  'runs-on'?: string;
  'timeout-minutes'?: number;
  strategy?: { 'fail-fast'?: boolean; matrix?: { shard?: Shard[] } };
  env?: Record<string, string>;
  steps?: Step[];
};
const workflow = yaml.load(fs.readFileSync(E2E_PATH, 'utf8')) as { jobs: Record<string, Job> };

const SWEPT_TIERS = ['tier0', 'tier1', 'tier2', 'tier3'];
const DEFAULT_TIERS = SWEPT_TIERS.join(',');

/**
 * Seconds per flow on the hosted macOS runner: the first pass that passed in
 * scheduled runs 39923331651 (2026-10-23) and 40075903317 (2026-10-24), the
 * larger where both passed. Each is the Maestro result line for the flow in its
 * shard log, which times the flow and not the retry pass. A flow whose first
 * pass failed in both runs, or was not reached, has no entry and counts as
 * UNMEASURED_SECONDS, since a failed first pass times the assertion it waits on.
 */
const IOS_SECONDS: Record<string, number> = {
  'about-links': 82,
  'activity-chart-types': 269,
  'activity-detail-scroll': 106,
  'activity-gpx-export-validation': 123,
  'activity-map-interactions': 171,
  'activity-map-long-press-highlight': 124,
  'activity-section-clipped-swipe': 159,
  'activity-sections-scrub': 174,
  'activity-zone-distributions': 151,
  'backup-local-now': 85,
  'dark-mode-contrast': 226,
  'data-values-activity': 203,
  'data-values-fitness': 110,
  'data-values-weekly-summary': 161,
  'data-verification': 167,
  'detection-preview-discard': 129,
  'error-invalid-activity': 122,
  'fitness-collapsible-sections': 110,
  'fitness-curves-zones': 173,
  'fitness-metrics': 137,
  'fitness-sport-filter': 147,
  'fitness-time-range': 126,
  'fitness-wellness-trends': 118,
  'home-weekly-summary': 184,
  'input-section-rename-edge': 143,
  'insights-display': 116,
  'insights-panel': 121,
  'map-activity-popup': 113,
  'map-comprehensive': 134,
  'map-section-popup': 129,
  'map-style-switching': 87,
  'map-visual-validation': 296,
  'navigation-deep-links': 205,
  'preview-parameter-gestures': 1012,
  'recording-entry-response': 124,
  'recording-library': 124,
  'recording-live-metrics': 231,
  'recording-lock-overlay': 203,
  'recording-manual-entry': 219,
  'recording-manual-entry-submit': 297,
  'recording-sensor-settings': 171,
  'recording-settings': 159,
  'recording-start-stop': 270,
  'regional-map-heatmap-trace-color': 166,
  'regional-map-no-route-markers': 123,
  'regional-map-sections-visible': 102,
  'regional-map-toggles': 103,
  'regional-map-world-zoom-heatmap': 91,
  'routes-list': 137,
  'section-change-card': 201,
  'section-encounter-cards': 112,
  'section-exclude-lap': 452,
  'section-history': 156,
  'section-management': 198,
  'section-record-mark': 139,
  'section-swipe-hide': 149,
  'settings-cache': 88,
  'settings-logout': 124,
  'settings-notifications': 71,
  'settings-persistence': 95,
  'settings-profile-storage': 72,
  'settings-scroll': 77,
  'settings-summary-card-config': 105,
  'settings-support-iap': 348,
  'settings-theme': 82,
  'settings-units-toggle': 91,
  'stats-power-curve': 127,
  'storage-display': 65,
  'strength-inline-panel': 84,
  'stress-activity-sections': 148,
  'stress-chart-scrubbing': 1107,
  'stress-navigation-rapid': 783,
  'stress-map-toggles': 228,
  'training-wellness-dashboard': 111,
  'v030-feature-tour': 375,
};

/**
 * Seconds per flow on the hosted Ubuntu emulator, the larger of scheduled runs
 * 38702505116 and 38870155868, from the flows that ran past the home screen.
 * Most flows in both failed waiting for the home screen at about 85 s, which
 * measures the wait and not the flow, and a death or a stall measures the
 * device, so those flows take their iOS figure.
 */
const ANDROID_SECONDS: Record<string, number> = {
  'activity-gpx-export-validation': 58,
  'feed-card-indicators': 86,
  'map-activity-popup': 127,
  'recording-live-metrics': 112,
  'regional-map-sections-visible': 62,
  'regional-map-toggles': 64,
  'section-history': 120,
  'stats-power-curve': 80,
};

/** A flow the measured run never reached counts above nine in ten of those it did. */
const UNMEASURED_SECONDS = 240;

/** A failed flow is retried once, so half the shard failing costs half again. */
const RETRY_SHARE = 0.5;

/** A shard that fits inside this never meets the hosted runner's cancellation. */
const SHARD_CEILING_MINUTES = 60;

type Sweep = {
  job: string;
  runName: string;
  /** Where a flow's seconds come from, in order, before the unmeasured figure. */
  seconds: Record<string, number>[];
  /**
   * Minutes the run step spends before its first flow. The emulator boots inside
   * the run step, 2.4 and 2.5 minutes before the first flow on the two runs
   * above; the simulator boots in a step of its own.
   */
  setupInRunMinutes: number;
  /** The steps before the run and after it. */
  outsideRunMinutes: number;
  runnerOs: RegExp;
};

const SWEEPS: Sweep[] = [
  {
    job: 'e2e-ios',
    runName: 'Run Maestro tests',
    seconds: [IOS_SECONDS],
    setupInRunMinutes: 0,
    // About seven minutes, four measured.
    outsideRunMinutes: 15,
    runnerOs: /^macos/,
  },
  {
    job: 'e2e-android',
    runName: 'Run Maestro tests on emulator',
    seconds: [ANDROID_SECONDS, IOS_SECONDS],
    setupInRunMinutes: 3,
    // 23 s before the run on both runs above, 8 s and 12 s after it.
    outsideRunMinutes: 10,
    runnerOs: /^ubuntu/,
  },
];

type Flow = { name: string; tags: string[] };

function flowTags(source: string): string[] {
  const header = source.split('\n---')[0];
  return [...header.matchAll(/^\s*-\s*([\w-]+)\s*(?:#.*)?$/gm)].map((m) => m[1]);
}

const sweptFlows: Flow[] = fs
  .readdirSync(MAESTRO_DIR)
  .filter((f) => f.endsWith('.yaml') && f !== 'config.yaml')
  .map((f) => ({
    name: f.replace(/\.yaml$/, ''),
    tags: flowTags(fs.readFileSync(path.join(MAESTRO_DIR, f), 'utf8')),
  }))
  .filter((flow) => flow.tags.some((tag) => SWEPT_TIERS.includes(tag)));

const BOOT_ACTION = './.github/actions/boot-ios-simulator';

const runStepOf = (sweep: Sweep) =>
  (workflow.jobs[sweep.job].steps ?? []).find((step) => step.name === sweep.runName);

/** A job with no shard matrix is one shard holding whatever its run selects. */
const shardsOf = (sweep: Sweep): Shard[] =>
  workflow.jobs[sweep.job].strategy?.matrix?.shard ?? [{ name: sweep.job, packs: '', tiers: '' }];

/**
 * The shell the run step hands the suite. A `run` body is one bash script; the
 * emulator action runs each line of its `script` as its own `sh -c`, so only
 * the lines that start the suite are taken, each on its own.
 */
function suiteScripts(step: Step | undefined): { shell: string; body: string }[] {
  if (step?.run) return [{ shell: 'bash', body: step.run }];
  return (step?.with?.script ?? '')
    .split('\n')
    .filter((line) => /\.maestro\/run-/.test(line))
    .map((body) => ({ shell: 'sh', body }));
}

/**
 * Runs the job's own step body with a stub runner in place of Maestro and
 * returns the arguments it was handed, or null when the step ran nothing.
 */
function runnerArgs(sweep: Sweep, shard: Shard, tiers: string): string[] | null {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-sweep-shard-'));
  fs.mkdirSync(path.join(dir, '.maestro'));
  for (const script of fs.readdirSync(MAESTRO_DIR).filter((f) => f.endsWith('.sh')))
    fs.copyFileSync(path.join(MAESTRO_DIR, script), path.join(dir, '.maestro', script));
  const argsFile = path.join(dir, 'args');
  const stub = path.join(dir, '.maestro/run-suite.sh');
  fs.writeFileSync(stub, `#!/usr/bin/env bash\nprintf '%s\\n' "$@" > "${argsFile}"\n`);
  fs.chmodSync(stub, 0o755);
  const scripts = suiteScripts(runStepOf(sweep));
  expect(scripts.length).toBeGreaterThan(0);
  for (const { shell, body } of scripts) {
    const run = spawnSync(shell, ['-e', '-c', body], {
      cwd: dir,
      encoding: 'utf8',
      env: {
        ...process.env,
        PACKS: shard.packs,
        SHARD_TIERS: shard.tiers,
        TIERS: tiers,
        GITHUB_ENV: path.join(dir, 'github-env'),
      },
    });
    expect(run.status).toBe(0);
  }
  if (!fs.existsSync(argsFile)) return null;
  return fs.readFileSync(argsFile, 'utf8').trim().split('\n');
}

/** Maestro includes a flow carrying any included tag and drops one carrying any excluded tag. */
function selectedBy(args: string[]): Flow[] {
  const list = (flag: string) =>
    (args.find((a) => a.startsWith(`${flag}=`)) ?? `${flag}=`)
      .slice(flag.length + 1)
      .split(',')
      .filter(Boolean);
  const include = list('--include-tags');
  const exclude = list('--exclude-tags');
  return sweptFlows.filter(
    (flow) =>
      flow.tags.some((tag) => include.includes(tag)) &&
      !flow.tags.some((tag) => exclude.includes(tag))
  );
}

describe.each(SWEEPS.map((sweep) => [sweep.job, sweep] as const))(
  'the scheduled %s sweep',
  (_job, sweep) => {
    const job = workflow.jobs[sweep.job];
    const runStep = runStepOf(sweep);
    const shards = shardsOf(sweep);
    const selections = shards.map((shard) => {
      const args = runnerArgs(sweep, shard, DEFAULT_TIERS);
      return { shard, args, flows: args ? selectedBy(args) : [] };
    });
    const secondsOf = (flow: Flow) =>
      sweep.seconds.map((table) => table[flow.name]).find((s) => s !== undefined) ??
      UNMEASURED_SECONDS;

    it('is split into shards that run side by side', () => {
      expect(shards.length).toBeGreaterThan(1);
      // One shard's failure would otherwise cancel the rest, and a cancelled
      // shard reports only the flows it finished.
      expect(job.strategy?.['fail-fast']).toBe(false);
      expect(job['runs-on']).toMatch(sweep.runnerOs);
      expect(runStep?.env?.PACKS).toBe('${{ matrix.shard.packs }}');
      expect(runStep?.env?.SHARD_TIERS).toBe('${{ matrix.shard.tiers }}');
    });

    it('runs every swept flow in exactly one shard', () => {
      expect(sweptFlows.length).toBeGreaterThan(50);
      const owners = new Map<string, string[]>();
      for (const { shard, flows } of selections) {
        for (const flow of flows)
          owners.set(flow.name, [...(owners.get(flow.name) ?? []), shard.name]);
      }
      const unowned = sweptFlows.filter((flow) => !owners.has(flow.name)).map((f) => f.name);
      const shared = [...owners].filter(([, names]) => names.length > 1);
      expect(unowned).toEqual([]);
      expect(shared).toEqual([]);
    });

    it.each(selections.map((s) => [s.shard.name, s] as const))(
      'gives shard %s time for its measured flows and the retry pass',
      (_name, { flows }) => {
        expect(flows.length).toBeGreaterThan(0);
        const seconds = flows.reduce((sum, flow) => sum + secondsOf(flow), 0);
        const needed = Math.ceil((seconds / 60) * (1 + RETRY_SHARE)) + sweep.setupInRunMinutes;
        const timeout = runStep?.['timeout-minutes'] ?? Infinity;
        expect(job['timeout-minutes'] ?? Infinity).toBeLessThanOrEqual(SHARD_CEILING_MINUTES);
        expect(timeout).toBeGreaterThanOrEqual(needed);
      }
    );

    it('runs each shard through run-suite.sh, which retries the failed flows', () => {
      // The stub stands in for run-suite.sh, so a selection is only seen when
      // the step reached it.
      expect(selections.every(({ args }) => args !== null)).toBe(true);
      const bodies = suiteScripts(runStep)
        .map((s) => s.body)
        .join('\n');
      expect(bodies).not.toMatch(/maestro"? test \.maestro\//);
    });

    it('honours a dispatched tier selection inside each shard', () => {
      for (const shard of shards) {
        const args = runnerArgs(sweep, shard, 'tier0,tier1');
        const flows = args ? selectedBy(args) : [];
        for (const flow of flows) {
          expect(flow.tags.some((tag) => tag === 'tier0' || tag === 'tier1')).toBe(true);
        }
      }
      const tierTwoOnly = shards.find((shard) => !/tier[01]/.test(shard.tiers));
      expect(tierTwoOnly).toBeDefined();
      expect(runnerArgs(sweep, tierTwoOnly!, 'tier0,tier1')).toBeNull();
    });

    const uploads = (job.steps ?? []).filter((step) =>
      String(step.uses).startsWith('actions/upload-artifact')
    );
    const reportUpload = uploads.find((step) => step.name === 'Upload test report');

    it('uploads each shard under its own artefact names', () => {
      const names = uploads.map((step) => step.with?.name).filter((n): n is string => Boolean(n));
      expect(names.length).toBeGreaterThan(0);
      for (const name of names) expect(name).toContain('matrix.shard.name');
    });

    it("reads every shard's report into the summary, and is red when a shard did not succeed", () => {
      const steps = workflow.jobs['e2e-summary'].steps ?? [];
      const prefix = (reportUpload?.with?.name ?? '').split('${{')[0];
      expect(prefix).toMatch(/-$/);
      const download = steps.find((step) => step.with?.pattern === `${prefix}*`);
      expect(download).toBeDefined();
      const table = steps.find((step) => step.name === 'Generate summary');
      expect(table?.run).toContain(`${prefix}*`);

      const result = `\${{ needs.${sweep.job}.result }}`;
      const verdict = steps.find((step) => /exit 1/.test(step.run ?? ''));
      expect(verdict).toBeDefined();
      // A cancelled job is the shape this guards, and it is neither `failure`
      // nor `skipped`, so the check is for `success` rather than a list of the
      // ways a job can go wrong.
      expect(verdict?.run).toMatch(/success/);
      expect(Object.values(verdict?.env ?? {})).toContain(result);

      // The table says so too, rather than only reporting the shards that wrote one.
      const resultVar = Object.entries(table?.env ?? {}).find(([, v]) => v === result)?.[0];
      expect(resultVar).toBeDefined();
      expect(table?.run).toContain(resultVar!);
    });
  }
);

describe('the scheduled iOS sweep', () => {
  it('boots the simulator through the action that tells run-suite.sh how to revive it', () => {
    const boot = (workflow.jobs['e2e-ios'].steps ?? []).find((step) => step.uses === BOOT_ACTION);
    expect(boot).toBeDefined();
  });
});

/**
 * Scenario: a shard's device server dies and run-suite.sh, told nothing about
 * the device, checks and restarts it through adb, which a macOS runner does
 * not have. The health check fails before every retried flow and the restart
 * reaches nothing.
 *
 * Expected behaviour: the action that boots the simulator exports the device,
 * a health check that answers for that simulator, and a restart that reboots
 * it, in the form run-suite.sh evaluates.
 */
describe('the simulator boot action', () => {
  const action = yaml.load(
    fs.readFileSync(path.join(REPO_ROOT, BOOT_ACTION, 'action.yml'), 'utf8')
  ) as { runs: { steps: { id?: string; run?: string }[] } };
  const bootScript = action.runs.steps.find((step) => step.id === 'simulator')?.run ?? 'exit 9';
  const UDID = 'AAAA1111-BB22-CC33-DD44-EEEEEE555555';

  function stubbedRunner() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-simctl-'));
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin);
    const booted = path.join(dir, 'booted');
    const calls = path.join(dir, 'calls');
    fs.writeFileSync(
      path.join(bin, 'xcrun'),
      [
        '#!/usr/bin/env bash',
        `echo "$*" >> "${calls}"`,
        'case "$*" in',
        `  "simctl list devices available") echo "    iPhone 17 Pro Max (${UDID}) (Shutdown)" ;;`,
        `  "simctl list devices booted") cat "${booted}" 2>/dev/null ;;`,
        `  "simctl boot ${UDID}") echo "    iPhone 17 Pro Max (${UDID}) (Booted)" > "${booted}" ;;`,
        `  "simctl shutdown ${UDID}") : > "${booted}" ;;`,
        'esac',
        '',
      ].join('\n')
    );
    fs.chmodSync(path.join(bin, 'xcrun'), 0o755);
    const githubEnv = path.join(dir, 'github-env');
    const env = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      GITHUB_ENV: githubEnv,
      GITHUB_OUTPUT: path.join(dir, 'github-output'),
    };
    const run = spawnSync('bash', ['-e', '-c', bootScript], { env, encoding: 'utf8' });
    expect(run.status).toBe(0);
    const exported = Object.fromEntries(
      fs
        .readFileSync(githubEnv, 'utf8')
        .trim()
        .split('\n')
        .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)])
    );
    // The way run-suite.sh runs either command.
    const evaluate = (name: string) =>
      spawnSync('bash', ['-c', `eval "$${name}"`], {
        env: { ...env, ...exported },
        encoding: 'utf8',
      }).status;
    return { exported, evaluate, booted, calls };
  }

  it('pins run-suite.sh to the simulator it booted', () => {
    expect(stubbedRunner().exported.MAESTRO_DEVICE).toBe(UDID);
  });

  it('answers healthy while the simulator is booted and not once it is down', () => {
    const { evaluate, booted } = stubbedRunner();
    expect(evaluate('MAESTRO_HEALTH_CMD')).toBe(0);
    fs.writeFileSync(booted, '');
    expect(evaluate('MAESTRO_HEALTH_CMD')).not.toBe(0);
  });

  it('brings a simulator that went down back up', () => {
    const { evaluate, booted, calls } = stubbedRunner();
    fs.writeFileSync(booted, '');
    evaluate('MAESTRO_RESTART_CMD');
    expect(evaluate('MAESTRO_HEALTH_CMD')).toBe(0);
    expect(fs.readFileSync(calls, 'utf8')).toContain(`simctl bootstatus ${UDID}`);
  });
});

/**
 * Scenario: a shard's run step uses the whole job cap, so the runner kills the
 * job while the post steps are still going. On the iOS shards the slowest of
 * them, the simulator log capture and the screenshot upload, ran first, and the
 * test report upload behind them never started, so the shard left no result.
 *
 * Expected behaviour: the run step stops early enough to leave the post steps
 * room inside the job's own timeout, and the report is uploaded and published
 * before any diagnostics or screenshot step.
 */
describe.each(SWEEPS.map((sweep) => [sweep.job, sweep] as const))(
  'the %s job at its cap',
  (_job, sweep) => {
    const job = workflow.jobs[sweep.job];
    const steps = job.steps ?? [];
    const run = runStepOf(sweep);

    it('stops the run with the rest of the job still inside the cap', () => {
      expect(run).toBeDefined();
      const runTimeout = run?.['timeout-minutes'] ?? Infinity;
      const jobTimeout = job['timeout-minutes'] ?? Infinity;
      expect(jobTimeout).toBeLessThan(Infinity);
      expect(runTimeout + sweep.outsideRunMinutes).toBeLessThanOrEqual(jobTimeout);
    });

    it('uploads and publishes the report before any slower post step', () => {
      const after = steps.slice(steps.indexOf(run as Step) + 1);
      const reportSteps = ['Upload test report', 'Publish test results'];
      const index = (name: string) => after.findIndex((step) => step.name === name);
      for (const name of reportSteps) expect(index(name)).toBeGreaterThanOrEqual(0);
      const firstOther = after.findIndex(
        (step) => !reportSteps.includes(step.name ?? '') && /always\(\)/.test(step.if ?? '')
      );
      expect(firstOther).toBeGreaterThanOrEqual(0);
      for (const name of reportSteps) expect(index(name)).toBeLessThan(firstOther);
    });
  }
);
