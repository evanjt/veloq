/**
 * Scenario: a screen is migrated to its one screen read, its old engine calls
 * fall to nothing, and nobody deletes the exports behind them. The next
 * feature under that screen reaches for one, because it is still there and
 * still works, and the surface the migration just shrank grows back.
 *
 * Expected behaviour: a ratchet. Each area's reach is committed, an export it
 * did not reach before is refused by name, and so is a ceiling entry it no
 * longer reaches, or the ground a migration took is given back the next time
 * someone calls it.
 */

import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { areaOf, surfaceOverCeiling, surfaceUnderCeiling } from '../../../scripts/lib/ffiUsage';
import { gitFreeEnv, initFixtureRepo } from '../__shared__/gitFixture';

const CEILINGS = path.join(__dirname, '../../../scripts/ffi-area-ceilings.json');
const REPORT = path.join(__dirname, '../../../scripts/ffi-usage-report.ts');

describe('which area a caller belongs to', () => {
  it('is the feature, the router or the shared layer', () => {
    expect(areaOf('src/features/routes/hooks/useRouteMatch.ts')).toBe('features/routes');
    expect(areaOf('src/app/activity/[id].tsx')).toBe('app');
    expect(areaOf('src/shared/native/engineClears.ts')).toBe('shared');
    expect(areaOf('src/theme/colors.ts')).toBe('src');
  });

  it('is nothing outside src, where the engine layer does its job', () => {
    expect(areaOf('modules/veloqrs/src/delegates/preview.ts')).toBeNull();
    expect(areaOf('scripts/ffi-usage-report.ts')).toBeNull();
  });

  it('reads a Windows path the same as a POSIX one', () => {
    expect(areaOf('src\\features\\maps\\components\\ActivityMapView.tsx')).toBe('features/maps');
  });
});

describe('the area ratchet', () => {
  const ceilings = { 'features/maps': ['VeloqEngine.launchData', 'setNetworkOnline'] };

  it('passes an area that reaches what it is allowed to', () => {
    expect(surfaceOverCeiling({ 'features/maps': ['setNetworkOnline'] }, ceilings)).toEqual([]);
  });

  it('names the area and the export when one is added', () => {
    const over = surfaceOverCeiling(
      { 'features/maps': ['VeloqEngine.getBackupMetadata', 'setNetworkOnline'] },
      ceilings
    );

    expect(over).toEqual([{ area: 'features/maps', added: ['VeloqEngine.getBackupMetadata'] }]);
  });

  it('refuses an area that reaches the engine with no entry at all', () => {
    const over = surfaceOverCeiling({ 'features/strength': ['getMuscleDetail'] }, ceilings);

    expect(over).toEqual([{ area: 'features/strength', added: ['getMuscleDetail'] }]);
  });
});

describe('a ceiling the tree has beaten', () => {
  const ceilings = {
    '//': 'a note, not an area',
    'features/maps': ['VeloqEngine.launchData', 'setNetworkOnline'],
    'features/routes': ['VeloqEngine.getStats'],
  };

  it('passes when every area reaches exactly what its entry lists', () => {
    expect(
      surfaceUnderCeiling(
        {
          'features/maps': ['VeloqEngine.launchData', 'setNetworkOnline'],
          'features/routes': ['VeloqEngine.getStats'],
        },
        ceilings
      )
    ).toEqual([]);
  });

  it('names the area and the key an area no longer reaches', () => {
    const under = surfaceUnderCeiling(
      { 'features/maps': ['setNetworkOnline'], 'features/routes': ['VeloqEngine.getStats'] },
      ceilings
    );

    expect(under).toEqual([
      { area: 'features/maps', stale: ['VeloqEngine.launchData'], reachesNothing: false },
    ]);
  });

  it('names an area listed in the ceiling that reaches nothing at all', () => {
    const under = surfaceUnderCeiling(
      { 'features/maps': ['VeloqEngine.launchData', 'setNetworkOnline'] },
      ceilings
    );

    expect(under).toEqual([
      { area: 'features/routes', stale: ['VeloqEngine.getStats'], reachesNothing: true },
    ]);
  });

  it('names an empty entry for an area that reaches nothing', () => {
    const under = surfaceUnderCeiling({}, { 'features/strength': [] });

    expect(under).toEqual([{ area: 'features/strength', stale: [], reachesNothing: true }]);
  });

  it('never reads the note beside the numbers as an area', () => {
    const under = surfaceUnderCeiling(
      {
        'features/maps': ['VeloqEngine.launchData', 'setNetworkOnline'],
        'features/routes': ['VeloqEngine.getStats'],
      },
      ceilings
    );

    expect(under.map(({ area }) => area)).not.toContain('//');
  });
});

describe('the committed ceilings', () => {
  const raw = JSON.parse(fs.readFileSync(CEILINGS, 'utf-8')) as Record<string, unknown>;
  // JSON has no comments, so a key starting with `//` is the note beside the
  // numbers: which reads sit outside a screen read on purpose. The guard reads
  // areas out of the tree and looks each one up here, so a key that names no
  // area is never consulted.
  const committed = Object.fromEntries(
    Object.entries(raw).filter(([area]) => !area.startsWith('//'))
  ) as Record<string, string[]>;

  it('carries the note about the reads that stay outside a screen read', () => {
    const note = Object.entries(raw).find(([area]) => area.startsWith('//'))?.[1];

    expect(typeof note).toBe('string');
    expect(note).toContain('getGpsTrack');
  });

  it('lists every area sorted, so a diff reads as one line per change', () => {
    expect(Object.keys(committed)).toEqual([...Object.keys(committed)].sort());
    for (const keys of Object.values(committed)) {
      expect(keys).toEqual([...keys].sort());
    }
  });

  it('holds no duplicate, which would let one removal go unnoticed', () => {
    for (const keys of Object.values(committed)) {
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});

/** A tree whose one caller reaches `startFetchAndStore` from the insights area. */
function callerTree(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ffi-area-'));
  roots.push(root);
  const file = path.join(root, 'src/features/insights/fetch.ts');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    "import { startFetchAndStore } from 'veloqrs';\n\nexport function fetchAll() {\n  startFetchAndStore();\n}\n"
  );
  return root;
}

function withCeilings(root: string, ceilings: Record<string, string[]>): string {
  const file = path.join(root, 'ceilings.json');
  fs.writeFileSync(file, JSON.stringify(ceilings));
  return file;
}

function checkAreas(
  root: string,
  ceilings: string,
  hookEnv: Record<string, string> = {}
): { status: number; output: string } {
  const result = spawnSync(
    'npx',
    ['tsx', REPORT, '--check-areas', '--root', root, '--ceilings', ceilings],
    { encoding: 'utf8', env: { ...gitFreeEnv(), ...hookEnv } }
  );
  return { status: result.status ?? -1, output: `${result.stdout}${result.stderr}` };
}

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

/**
 * A tree whose screen calls a manager export only through the client:
 * `engine.getInsightsData()` forwards to `fitness().getInsightsData`, and
 * `engine.readStrength()` to `strength().getScreenData` under another name.
 */
function clientTree(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ffi-area-client-'));
  roots.push(root);
  const write = (rel: string, text: string): void => {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };
  write(
    'modules/veloqrs/src/delegates/host.ts',
    'type EngineHandle = VeloqEngineLike;\nexport interface DelegateHost {\n  readonly engine: EngineHandle;\n}\n'
  );
  write(
    'modules/veloqrs/src/delegates/fitness.ts',
    'export function getInsightsData(host: DelegateHost, params: unknown) {\n' +
      "  return host.timed('getInsightsData', () => host.engine.fitness().getInsightsData(params));\n}\n"
  );
  write(
    'modules/veloqrs/src/delegates/strength.ts',
    'export function readStrengthScreen(host: DelegateHost) {\n' +
      '  return host.engine.strength().getScreenData(0, 1, []);\n}\n'
  );
  write(
    'modules/veloqrs/src/EngineClient.ts',
    "import * as fitnessDelegates from './delegates/fitness';\n" +
      "import * as strengthDelegates from './delegates/strength';\n" +
      'class EngineClient {\n' +
      '  getInsightsData = (params: unknown) => fitnessDelegates.getInsightsData(this, params);\n\n' +
      '  readStrength = () => strengthDelegates.readStrengthScreen(this);\n' +
      '}\n'
  );
  write(
    'src/features/insights/read.ts',
    'export function read(params: unknown) {\n  return engine.getInsightsData(params);\n}\n'
  );
  write(
    'src/features/strength/read.ts',
    'export function read() {\n  return engine.readStrength();\n}\n'
  );
  return root;
}

describe('the area check through the client', () => {
  it('counts a manager export reached as a client call against the area that calls it', () => {
    const root = clientTree();

    const { status, output } = checkAreas(
      root,
      withCeilings(root, {
        'features/insights': ['FitnessManager.getInsightsData'],
        'features/strength': ['StrengthManager.getScreenData'],
      })
    );

    expect(output).toContain('2 areas reach 2 exports');
    expect(status).toBe(0);
  });

  it('refuses an area that calls a manager export through the client and has no entry', () => {
    const root = clientTree();

    const { status, output } = checkAreas(
      root,
      withCeilings(root, { 'features/strength': ['StrengthManager.getScreenData'] })
    );

    expect(output).toContain('features/insights reaches the engine and has no entry');
    expect(output).toContain('- FitnessManager.getInsightsData');
    expect(status).toBe(1);
  });

  it('refuses a client call that adds an export to an area with an entry', () => {
    const root = clientTree();

    const { status, output } = checkAreas(
      root,
      withCeilings(root, {
        'features/insights': ['startFetchAndStore'],
        'features/strength': ['StrengthManager.getScreenData'],
      })
    );

    expect(output).toContain('features/insights reaches 1 export(s) it did not reach before');
    expect(output).toContain('- FitnessManager.getInsightsData');
    expect(status).toBe(1);
  });
});

describe('the area check', () => {
  it('passes a tree whose areas reach exactly what their entries list', () => {
    const root = callerTree();

    const { status, output } = checkAreas(
      root,
      withCeilings(root, { 'features/insights': ['startFetchAndStore'] })
    );

    expect(output).toContain('1 areas reach 1 exports');
    expect(status).toBe(0);
  });

  it('refuses a ceiling entry the area no longer reaches, names it and says to remove it', () => {
    const root = callerTree();

    const { status, output } = checkAreas(
      root,
      withCeilings(root, { 'features/insights': ['getDownloadProgress', 'startFetchAndStore'] })
    );

    expect(output).toContain('features/insights no longer reaches 1 export(s)');
    expect(output).toContain('- getDownloadProgress');
    expect(output).toContain('Remove each from ceilings.json');
    expect(status).toBe(1);
  });

  it('refuses an area listed in the ceilings that reaches nothing at all', () => {
    const root = callerTree();

    const { status, output } = checkAreas(
      root,
      withCeilings(root, {
        'features/insights': ['startFetchAndStore'],
        'features/routes': ['VeloqEngine.getStats'],
      })
    );

    expect(output).toContain('features/routes no longer reaches the engine');
    expect(status).toBe(1);
  });

  it('refuses an area that reaches an export its ceiling does not list', () => {
    const root = callerTree();

    const { status, output } = checkAreas(root, withCeilings(root, {}));

    expect(output).toContain('features/insights reaches the engine and has no entry');
    expect(output).toContain('- startFetchAndStore');
    expect(status).toBe(1);
  });
});

/**
 * Scenario: git hands a hook GIT_DIR, GIT_INDEX_FILE and GIT_WORK_TREE, and
 * every one of them beats the directory a child was started in. The guard
 * reads the index, so under a hook it read whichever tree the hook was about.
 *
 * Expected behaviour: the run is about the checkout it was pointed at, and a
 * run that reads nothing refuses instead of reporting that nothing is over its
 * ceiling. A guard that checks nothing and passes is worse than one that
 * answers wrongly, because only the wrong answer gets looked at.
 */
describe('the guard under a hook’s environment', () => {
  it('reads the checkout it was pointed at even when the environment names another tree', () => {
    const root = callerTree();
    initFixtureRepo(root);
    const ceilings = withCeilings(root, { 'features/insights': ['startFetchAndStore'] });

    const { status, output } = checkAreas(root, ceilings, {
      GIT_INDEX_FILE: path.join(os.tmpdir(), 'veloq-guard-absent-index'),
      GIT_WORK_TREE: os.tmpdir(),
    });

    expect(output).toContain('1 areas reach 1 exports');
    expect(status).toBe(0);
  });

  it('refuses rather than passes when it reads no area at all', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ffi-area-empty-'));
    roots.push(root);
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src/README.ts'), 'export {};\n');
    initFixtureRepo(root);

    const { status, output } = checkAreas(
      root,
      withCeilings(root, { 'features/maps': ['setNetworkOnline'] })
    );

    expect(output).toContain('no area reaches the engine at all');
    expect(status).toBe(1);
  });
});
