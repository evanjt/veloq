/**
 * Scenario: an unquoted flow value holding `'5' : '4'` is not valid YAML, because
 * a colon followed by a space opens a mapping. Maestro parses every file under
 * `.maestro` before it runs the first flow, so the whole suite stops on both
 * platforms with no flow named.
 *
 * Expected behaviour: the guard names each flow file that does not parse and
 * passes when every one does.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const script = resolve(__dirname, '../../../scripts/check-maestro-flows.mjs');

const GOOD = ['appId: com.example.app', '---', '- launchApp', ''].join('\n');
const BAD = [
  'appId: com.example.app',
  '---',
  "- evalScript: ${output.target = a.trim() == '4' ? '5' : '4'}",
  '',
].join('\n');

function runOver(flows: Record<string, string>) {
  const fixture = mkdtempSync(join(tmpdir(), 'maestro-flows-'));
  try {
    mkdirSync(join(fixture, '.maestro/helpers'), { recursive: true });
    for (const [name, text] of Object.entries(flows)) {
      writeFileSync(join(fixture, '.maestro', name), text);
    }
    const result = spawnSync('node', [script, '--root', fixture], { encoding: 'utf8' });
    return { status: result.status, output: `${result.stdout}${result.stderr}` };
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

describe('the Maestro flow guard', () => {
  it('passes when every flow parses, including one in a subdirectory', () => {
    const result = runOver({ 'a.yaml': GOOD, 'helpers/b.yaml': GOOD });
    expect(result.status).toBe(0);
    expect(result.output).toContain('2 flow files parse');
  });

  it('names a flow whose value holds a colon and a space', () => {
    const result = runOver({ 'a.yaml': GOOD, 'broken.yaml': BAD });
    expect(result.status).toBe(1);
    expect(result.output).toContain('.maestro/broken.yaml');
    expect(result.output).not.toContain('.maestro/a.yaml');
  });

  it('names every broken flow, not only the first', () => {
    const result = runOver({ 'one.yaml': BAD, 'helpers/two.yaml': BAD, 'ok.yaml': GOOD });
    expect(result.status).toBe(1);
    expect(result.output).toContain('2 flow file(s) do not parse');
  });

  it('fails when there is nothing to check', () => {
    const result = runOver({});
    expect(result.status).toBe(1);
    expect(result.output).toContain('nothing was checked');
  });
});
