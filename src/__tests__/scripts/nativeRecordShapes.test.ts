/**
 * Scenario: an APK carries a native library built before a record gained a
 * field and a JavaScript bundle built after it. uniffi checks one checksum per
 * function signature, and a record's fields are in no signature, so the pair
 * boots and lifts every field of that record off the wrong offset. On the S22
 * that read as `4.243991582e-314 Fitness` on the feed header and, where the
 * dev overlay is not stripped, "Reading the requested value would read past
 * the end of the buffer".
 *
 * Expected behaviour: the guard names the record and both field counts, and
 * stays quiet when the two were built from the same tree.
 */

import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';

const REPO = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(REPO, 'scripts/lint-native-record-shapes.mjs');

/** One record as uniffi writes it into the library: the tag, the module, the
 * name, the field count, then the fields. */
function record(name: string, fields: string[]): Buffer {
  const text = (s: string) => Buffer.concat([Buffer.from([s.length]), Buffer.from(s, 'latin1')]);
  return Buffer.concat([
    Buffer.from([0x02]),
    text('veloqrs::ffi_types'),
    text(name),
    Buffer.from([fields.length]),
    ...fields.map((f) => Buffer.concat([text(f), Buffer.from([0x0d, 0x00, 0x00, 0x00])])),
  ]);
}

function library(records: Buffer[]): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'record-shapes-'));
  const at = path.join(dir, 'libveloqrs.so');
  // Padding either side, because the metadata sits inside a much larger file.
  writeFileSync(at, Buffer.concat([Buffer.alloc(64), ...records, Buffer.alloc(64)]));
  return at;
}

function bindings(source: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'record-bindings-'));
  const at = path.join(dir, 'veloqrs.ts');
  writeFileSync(at, source);
  return at;
}

function run(libraryPath: string, bindingsPath: string): { code: number; output: string } {
  try {
    const stdout = execFileSync(
      'node',
      [SCRIPT, '--library', libraryPath, '--bindings', bindingsPath],
      { cwd: REPO, encoding: 'utf8' }
    );
    return { code: 0, output: stdout };
  } catch (e) {
    const error = e as { status: number; stdout: string; stderr: string };
    return { code: error.status, output: `${error.stdout}${error.stderr}` };
  }
}

const SUMMARY_CARD = `export type FfiSummaryCardData = {
  wellness: FfiWellnessSummary;
  currentWeek: FfiPeriodStats;
  prevWeek: FfiPeriodStats;
  ftpTrend: FfiFtpTrend;
  runPaceTrend: FfiPaceTrend;
  swimPaceTrend: FfiPaceTrend;
};
`;

const FIVE = ['current_week', 'prev_week', 'ftp_trend', 'run_pace_trend', 'swim_pace_trend'];

describe('the native record shape guard', () => {
  it('names the record a library built before the field was added', () => {
    const { code, output } = run(
      library([record('FfiSummaryCardData', FIVE)]),
      bindings(SUMMARY_CARD)
    );

    expect(code).toBe(1);
    expect(output).toContain('FfiSummaryCardData');
    expect(output).toContain('the library holds 5 fields, the bindings lift 6');
  });

  it('passes when the library was built from the same tree', () => {
    const { code, output } = run(
      library([record('FfiSummaryCardData', ['wellness', ...FIVE])]),
      bindings(SUMMARY_CARD)
    );

    expect(code).toBe(0);
    expect(output).toContain('no disagreement');
  });

  it('says nothing about a record the library does not carry, which is a type the bindings define alone', () => {
    const { code } = run(library([record('FfiPeriodStats', ['distance'])]), bindings(SUMMARY_CARD));

    expect(code).toBe(0);
  });

  it('is quiet when there is no library to read, which is every fresh clone', () => {
    const { code } = run(path.join(tmpdir(), 'no-such-library.so'), bindings(SUMMARY_CARD));

    expect(code).toBe(0);
  });
});
