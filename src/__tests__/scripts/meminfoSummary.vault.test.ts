/**
 * Scenario: the graphics a hidden map tab leaves resident are held under a
 * ceiling, checked on the handset from `dumpsys meminfo` captures. One reading
 * is noise, so the check is the median of several cold runs.
 *
 * Expected behaviour: a capture parses to its Graphics, EGL mtrack, GL mtrack
 * and TOTAL PSS in KB; a median over the bound is refused, one at or under it
 * passes, and fewer than three readings give no verdict at all. Cold baseline
 * captures of the hiding screen give the map's own share, the hidden median less
 * the baseline median, which never moves the verdict.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MODULE = path.resolve(__dirname, '../../../scripts/lib/meminfo-summary.mjs');

/** The module is ESM and Jest is not, so it is evaluated by node and read back as JSON. */
const evaluate = <T>(expression: string): T =>
  JSON.parse(
    execFileSync(
      'node',
      [
        '--input-type=module',
        '-e',
        `import * as m from ${JSON.stringify(MODULE)}; console.log(JSON.stringify(${expression}))`,
      ],
      { encoding: 'utf8' }
    )
  );

/** `dumpsys meminfo` on an Android 14 handset, the category table and the summary. */
function capture(graphicsKb: number): string {
  return `Applications Memory Usage (in Kilobytes):
Uptime: 1846991324 Realtime: 1946112790

** MEMINFO in pid 4242 [com.example.dev] **
                   Pss  Private  Private  SwapPss      Rss     Heap     Heap     Heap
                 Total    Dirty    Clean    Dirty    Total     Size    Alloc     Free
                ------   ------   ------   ------   ------   ------   ------   ------
  Native Heap    96819    96740       52       27    98020   119160    88302    26164
  Dalvik Heap    19340    14804     4292       17    21044    45060    15020    30040
   EGL mtrack    41448    41448        0        0    41448
    GL mtrack    59372    59372        0        0    59372
      Unknown    53635    53244      360        1    54296
        TOTAL   410679   282552   106248      110   545236   164220   103322    56204

 App Summary
                       Pss(KB)                        Rss(KB)
                        ------                         ------
           Java Heap:    17892                          40316
         Native Heap:    96740                          98020
                Code:   100144                         230956
               Stack:     2372                           2380
            Graphics:   ${graphicsKb}                         ${graphicsKb}
       Private Other:    70832
              System:    21879
             Unknown:                                   72744

           TOTAL PSS:   410679            TOTAL RSS:   545236       TOTAL SWAP PSS:      110

 Objects
               Views:      912         ViewRootImpl:        1
    Death Recipients:        4             WebViews:        4
`;
}

const summary = (text: string) =>
  evaluate<Record<string, number>>(`m.meminfoSummary(${JSON.stringify(text)})`);
const verdict = (readings: number[], bound: number) =>
  evaluate<{ median: number; over: boolean }>(
    `m.medianVerdict(${JSON.stringify(readings)}, ${bound})`
  );
const throws = (expression: string) =>
  evaluate<string>(
    `(() => { try { ${expression}; return 'returned'; } catch (e) { return e.message; } })()`
  );

describe('meminfoSummary', () => {
  it('reads Graphics and TOTAL PSS from the summary and the mtrack rows from the table', () => {
    expect(summary(capture(100820))).toEqual({
      graphicsKb: 100820,
      eglMtrackKb: 41448,
      glMtrackKb: 59372,
      totalPssKb: 410679,
    });
  });

  it('refuses a capture with no App Summary, as for a process that is not running', () => {
    expect(throws('m.meminfoSummary("No process found for: com.example.dev")')).toMatch(
      /no App Summary/
    );
  });
});

describe('medianVerdict', () => {
  it('reports a median over the bound as over', () => {
    expect(verdict([131, 130, 118], 120)).toEqual({ median: 130, bound: 120, over: true });
  });

  it('reports a median under the bound as within, whatever one reading did', () => {
    expect(verdict([115, 140, 110], 120)).toMatchObject({ median: 115, over: false });
  });

  it('passes a median exactly on the bound', () => {
    expect(verdict([120, 120, 125, 100], 120)).toMatchObject({ median: 120, over: false });
  });

  it('refuses fewer than three readings, including none', () => {
    expect(throws('m.medianVerdict([130, 131], 120)')).toMatch(/at least 3/);
    expect(throws('m.medianVerdict([], 120)')).toMatch(/at least 3/);
  });
});

describe('mapShare', () => {
  const share = (hidden: number[], baseline: number[]) =>
    evaluate<{ hidden: number; baseline: number; share: number }>(
      `m.mapShare(${JSON.stringify(hidden)}, ${JSON.stringify(baseline)})`
    );

  it('is the hidden median less the baseline median', () => {
    expect(share([97, 96, 99], [55, 56, 54])).toEqual({ hidden: 97, baseline: 55, share: 42 });
  });

  it('refuses fewer than three baseline readings', () => {
    expect(throws('m.mapShare([97, 96, 99], [55, 56])')).toMatch(/at least 3/);
  });
});

describe('meminfo-summary.mjs on the command line', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meminfo-summary-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  function runs(hiddenKb: number[]): string[] {
    return hiddenKb.flatMap((kb, i) => {
      const shown = path.join(dir, `run${i + 1}-shown.txt`);
      const hidden = path.join(dir, `run${i + 1}-hidden.txt`);
      fs.writeFileSync(shown, capture(200000));
      fs.writeFileSync(hidden, capture(kb));
      return [shown, hidden];
    });
  }

  const run = (bound: string, files: string[]) =>
    spawnSync('node', [MODULE, bound, ...files], { encoding: 'utf8' });

  it('exits 1 when the median of the hidden readings is over the bound, not the shown ones', () => {
    const result = run('120', runs([130 * 1024, 133 * 1024, 110 * 1024]));
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/run2-hidden\t133\.0\t40\.5\t58\.0\t401\.1/);
    expect(result.stdout).toMatch(/median 130\.0 MB against 120 MB: over/);
  });

  it('exits 0 when the hidden median is within the bound', () => {
    const result = run('120', runs([115 * 1024, 140 * 1024, 100 * 1024]));
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/median 115\.0 MB against 120 MB: within/);
  });

  it('exits 2 with fewer than three hidden readings, never a verdict', () => {
    const result = run('120', runs([130 * 1024, 131 * 1024]));
    expect(result.status).toBe(2);
    expect(result.stdout).not.toMatch(/median/);
  });

  it('prints the map share from the baselines and keeps the verdict on the hidden median', () => {
    const files = runs([97 * 1024, 96 * 1024, 125 * 1024]);
    [55, 54, 90].forEach((mbBaseline, i) => {
      const baseline = path.join(dir, `run${i + 1}-baseline.txt`);
      fs.writeFileSync(baseline, capture(mbBaseline * 1024));
      files.push(baseline);
    });
    const result = run('120', files);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/median 97\.0 MB against 120 MB: within/);
    expect(result.stdout).toMatch(/map share 42\.0 MB, hidden 97\.0 MB less baseline 55\.0 MB/);
  });

  it('prints no share without three baselines', () => {
    const result = run('120', runs([97 * 1024, 96 * 1024, 99 * 1024]));
    expect(result.status).toBe(0);
    expect(result.stdout).not.toMatch(/map share/);
  });

  it('exits 2 on a capture that is not meminfo', () => {
    const files = runs([130 * 1024, 131 * 1024, 132 * 1024]);
    fs.writeFileSync(files[1], 'No process found for: com.example.dev\n');
    expect(run('120', files).status).toBe(2);
  });
});
