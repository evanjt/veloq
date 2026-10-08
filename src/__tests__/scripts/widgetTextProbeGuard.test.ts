/**
 * Scenario: an iOS widget view gains a line of text without the probe the widget capture judges
 * it by, or with the probe chained after the line limit it has to read. The capture then passes
 * over a cut it cannot see, or judges the line by the wrong rule.
 *
 * Expected behaviour: the guard fails on a `Text` with no `.measuredText(name)` and on one whose
 * probe follows `.lineLimit` or `.minimumScaleFactor`, naming the file and line, and passes when
 * every text carries the probe inside its limits. The Live Activity, which the capture does not
 * draw, and text inside comments and strings are left alone.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { gitFreeEnv } from '../__shared__/gitFixture';

const SCRIPT = join(__dirname, '../../../scripts/lint-widget-text-probes.mjs');

function runGuard(root: string): { status: number; output: string } {
  try {
    const output = execFileSync('node', [SCRIPT, '--root', root], {
      env: gitFreeEnv(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (error) {
    const e = error as { status: number; stdout?: string; stderr?: string };
    return { status: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

const roots: string[] = [];

function tree(name: string, swift: string): string {
  const root = mkdtempSync(join(tmpdir(), 'widget-text-probes-'));
  roots.push(root);
  const dir = join(root, 'widget/ios/VeloqWidget');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), swift);
  return root;
}

const view = (body: string) =>
  `struct TrailView: View {\n  var body: some View {\n${body}\n  }\n}\n`;

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

it('fails on a text with no probe, naming the file and line', () => {
  const root = tree(
    'TrailWidget.swift',
    view(
      '    VStack {\n      Text(trail.name)\n        .measuredText("name")\n      Text(trail.climb)\n        .lineLimit(1)\n    }'
    )
  );
  const { status, output } = runGuard(root);
  expect(status).not.toBe(0);
  expect(output).toContain('TrailWidget.swift:6');
});

it('fails on a probe chained after the line limit it has to read', () => {
  const root = tree(
    'TrailWidget.swift',
    view('    Text(trail.name)\n      .lineLimit(2)\n      .measuredText("name")')
  );
  const { status, output } = runGuard(root);
  expect(status).not.toBe(0);
  expect(output).toContain('after the line limit');
});

it('fails on a probe chained after the scale factor', () => {
  const root = tree(
    'TrailWidget.swift',
    view('    Text(trail.time).minimumScaleFactor(0.7).measuredText("time").lineLimit(1)')
  );
  expect(runGuard(root).status).not.toBe(0);
});

it('passes a probe on the text itself or after a modifier that keeps it a Text', () => {
  const root = tree(
    'TrailWidget.swift',
    view(
      [
        '    HStack {',
        '      Text(verbatim: "(\\(trail.rank))").measuredText("rank").foregroundColor(.gray)',
        '      Text(trail.time).fontWeight(.semibold).measuredText("time")',
        '        .lineLimit(1)',
        '        .minimumScaleFactor(0.7)',
        '      Text(date, format: .dateTime.day().month(.abbreviated))',
        '        .measuredText("date")',
        '    }',
      ].join('\n')
    )
  );
  expect(runGuard(root).status).toBe(0);
});

it('leaves the Live Activity, comments and strings alone', () => {
  const root = tree(
    'TrailWidget.swift',
    view(
      '    // Text(trail.name) once drew the name here.\n    Image(systemName: "Text(")\n      .accessibilityLabel(String(trail.name))'
    )
  );
  writeFileSync(
    join(root, 'widget/ios/VeloqWidget/RecordingLiveActivity.swift'),
    view('    Text(timerInterval: start...end)')
  );
  expect(runGuard(root).status).toBe(0);
});
