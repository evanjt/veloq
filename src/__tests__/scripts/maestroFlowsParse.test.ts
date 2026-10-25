/**
 * Scenario: an unquoted flow value holding `'5' : '4'` is not valid YAML, because
 * a colon followed by a space opens a mapping. Maestro parses every file under
 * `.maestro` before it runs the first flow, so the whole suite stops on both
 * platforms with no flow named.
 *
 * A command Maestro does not have stops the suite the same way.
 *
 * Expected behaviour: the guard names each flow file that does not parse or
 * names an unknown command, and passes when every one is valid.
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

  it('names a flow that uses a command Maestro does not have, nested or not', () => {
    const top = ['appId: com.example.app', '---', '- launchApp', '- openNotifications', ''].join(
      '\n'
    );
    const nested = [
      'appId: com.example.app',
      '---',
      '- repeat:',
      '    times: 2',
      '    commands:',
      '      - flingEverything',
      '',
    ].join('\n');
    const result = runOver({ 'a.yaml': GOOD, 'top.yaml': top, 'nested.yaml': nested });
    expect(result.status).toBe(1);
    expect(result.output).toContain('.maestro/top.yaml: Maestro has no command openNotifications');
    expect(result.output).toContain('.maestro/nested.yaml: Maestro has no command flingEverything');
    expect(result.output).not.toContain('.maestro/a.yaml');
  });

  it('names an Android-only command in a flow the iOS gate selects, unless an Android condition wraps it', () => {
    const flow = (tag: string, body: string[]) =>
      ['appId: com.example.app', 'tags:', `  - ${tag}`, '---', ...body, ''].join('\n');
    const bare = flow('tier0', ['- toggleAirplaneMode']);
    const guarded = flow('pack-nav', [
      '- runFlow:',
      '    when:',
      '      platform: Android',
      '    commands:',
      '      - setAirplaneMode:',
      '          enabled: true',
    ]);
    const androidRun = flow('tier2', ['- toggleAirplaneMode']);
    const result = runOver({
      'bare.yaml': bare,
      'guarded.yaml': guarded,
      'android.yaml': androidRun,
    });
    expect(result.status).toBe(1);
    expect(result.output).toContain('.maestro/bare.yaml: toggleAirplaneMode is Android-only');
    expect(result.output).not.toContain('.maestro/guarded.yaml');
    expect(result.output).not.toContain('.maestro/android.yaml');
  });

  it('fails when there is nothing to check', () => {
    const result = runOver({});
    expect(result.status).toBe(1);
    expect(result.output).toContain('nothing was checked');
  });
});
