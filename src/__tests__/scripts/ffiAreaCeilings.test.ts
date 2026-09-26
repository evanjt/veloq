/**
 * Scenario: a screen is migrated to its one screen read, its old engine calls
 * fall to nothing, and nobody deletes the exports behind them. The next
 * feature under that screen reaches for one, because it is still there and
 * still works, and the surface the migration just shrank grows back.
 *
 * Expected behaviour: a ratchet. Each area's reach is committed, an area may
 * reach less than it is allowed to, and an export it did not reach before is
 * refused by name.
 */

import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { areaOf, surfaceOverCeiling } from '../../../scripts/lib/ffiUsage';

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
describe('the guard under a hook\u2019s environment', () => {
  const source = fs.readFileSync(REPORT, 'utf-8');

  it('drops the variables git exports to a hook before running git', () => {
    // The listing and the batch read both live in the shared reader, so the
    // scrubbing is asserted where it happens. The run below is the proof; this
    // says which code is responsible for it.
    expect(source).toMatch(/from '\.\/lib\/indexedSources\.mjs'/);

    const reader = fs.readFileSync(
      path.join(__dirname, '../../../scripts/lib/indexedSources.mjs'),
      'utf-8'
    );
    for (const variable of ['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE']) {
      expect(reader).toContain(variable);
    }
    // Every git call it makes takes the scrubbed environment.
    expect(reader.match(/env: gitFreeEnv\(\)/g)).toHaveLength(1);
    expect(reader.match(/execFileSync\(/g)).toHaveLength(1);
  });

  it('reads its own checkout even when the environment names another tree', () => {
    const run = execFileSync('npx', ['tsx', REPORT, '--check-areas'], {
      cwd: path.join(__dirname, '../../..'),
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_INDEX_FILE: path.join(os.tmpdir(), 'veloq-guard-absent-index'),
        GIT_WORK_TREE: os.tmpdir(),
      },
    });

    expect(run).toContain('areas reach');
    expect(run).not.toContain('0 areas reach 0 exports');
  });

  it('refuses rather than passes when it reads no area at all', () => {
    // `surfaceOverCeiling` cannot answer this on its own: an empty surface is
    // over no ceiling, which is why the refusal is a separate check.
    expect(surfaceOverCeiling({}, { 'features/maps': ['setNetworkOnline'] })).toEqual([]);
    expect(source).toContain('no area reaches the engine at all');
    expect(source).toMatch(/Object\.keys\(surface\)\.length === 0/);
  });
});
