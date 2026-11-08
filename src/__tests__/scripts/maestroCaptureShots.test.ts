/**
 * Scenario: three store shots carry a headline the capture must prove. The
 * section shot shows the page of the section the notification names, the
 * insights shot shows one insight opened to its method, and the recording shot
 * is taken once the ride has covered distance.
 *
 * Expected behaviour: the guard passes a flow that does each and fails, naming
 * the shot, when the section is opened from the library-wide list, when the
 * insight is never opened or its method never expanded, and when the recording
 * shot does not wait for a distance above zero.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(__dirname, '../../../scripts/lint-maestro-store-shots.mjs');
const roots: string[] = [];

const SECTION = `- tapOn:
    id: "activity-regenerate-notification-delayed"
- runFlow:
    file: helpers/open-link.yaml
    env:
      LINK: "veloq://activity/demo-test-3?tab=sections"
- tapOn:
    id: "section-inline-plot-0"
- takeScreenshot: "screenshots/store-capture/02-section"
`;
const INSIGHTS = `- tapOn:
    id: "insight-line"
    index: 0
- extendedWaitUntil:
    visible:
      id: "insight-detail-sheet"
- tapOn:
    id: "methodology-toggle"
- assertVisible:
    id: "methodology-toggle"
    checked: true
- takeScreenshot: "screenshots/store-capture/06-insights"
`;
const RECORDING = `- extendedWaitUntil:
    notVisible: "0 (m|ft)"
    timeout: 60000
- takeScreenshot: "screenshots/store-capture/08-recording"
`;

function runGuard(flow: string): { status: number; output: string } {
  const root = mkdtempSync(join(tmpdir(), 'maestro-capture-shots-'));
  roots.push(root);
  mkdirSync(join(root, '.maestro'), { recursive: true });
  writeFileSync(join(root, '.maestro/store-capture.yaml'), flow);
  try {
    const output = execFileSync('node', [SCRIPT, '--root', root], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (error) {
    const e = error as { status: number; stdout?: string; stderr?: string };
    return { status: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

const HEADER = 'appId: com.veloq.app.dev\n---\n';
const flowOf = (...parts: string[]) => HEADER + parts.join('');

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

it('passes a flow that proves each headline', () => {
  expect(runGuard(flowOf(SECTION, INSIGHTS, RECORDING)).status).toBe(0);
});

it('fails a section shot opened from the library-wide list', () => {
  const listed = SECTION.replace('section-inline-plot-0', 'section-row-0');
  const run = runGuard(flowOf(listed, INSIGHTS, RECORDING));
  expect(run.status).toBe(1);
  expect(run.output).toContain('02-section');
});

it('fails an insights shot that never opens an insight', () => {
  const run = runGuard(
    flowOf(SECTION, '- takeScreenshot: "screenshots/store-capture/06-insights"\n', RECORDING)
  );
  expect(run.status).toBe(1);
  expect(run.output).toContain('06-insights');
});

it('fails an insights shot whose method is not expanded', () => {
  const folded = INSIGHTS.replace(/- tapOn:\n {4}id: "methodology-toggle"\n/, '');
  const run = runGuard(flowOf(SECTION, folded, RECORDING));
  expect(run.status).toBe(1);
  expect(run.output).toContain('06-insights');
});

it('fails a recording shot that does not wait for distance', () => {
  const run = runGuard(
    flowOf(SECTION, INSIGHTS, '- takeScreenshot: "screenshots/store-capture/08-recording"\n')
  );
  expect(run.status).toBe(1);
  expect(run.output).toContain('08-recording');
});
