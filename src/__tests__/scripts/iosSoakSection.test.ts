/**
 * Scenario: the section soak flow opens a section by id, and a default id from
 * some other library is absent from the demo library, so every cycle fails.
 * Expected behaviour: the script refuses the section surface when no section
 * is named, before it touches a simulator.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const SCRIPT = path.resolve(__dirname, '../../../scripts/ios-soak.sh');

function run(env: Record<string, string>, surfaces: string[], outDir = '/nonexistent-out') {
  const clean = { ...process.env, ...env };
  if (!('SECTION_ALT' in env)) delete clean.SECTION_ALT;
  if (!('SECTION' in env)) delete clean.SECTION;
  return spawnSync('bash', [SCRIPT, 'SIM-UDID', outDir, '1', ...surfaces], {
    env: clean,
    encoding: 'utf8',
  });
}

describe('ios-soak section surface', () => {
  it('refuses the section surface when SECTION is unset', () => {
    const result = run({}, ['section']);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('SECTION');
  });

  it('refuses an empty SECTION', () => {
    const result = run({ SECTION: '' }, ['feed', 'section']);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('SECTION');
  });

  it('refuses the section surface when SECTION_ALT is unset', () => {
    const result = run({ SECTION: 'a' }, ['section']);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('SECTION_ALT');
  });

  it('does not ask for SECTION on other surfaces', () => {
    // A surface with no flow file ends the script at once, past the checks
    // under test. The simulator lock is marked held so the script takes none,
    // and a real surface would launch the app and sample it for minutes.
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ios-soak-'));
    try {
      const result = run({ VELOQ_SIM_LOCK_HELD: 'SIM-UDID' }, ['no-such-surface'], out);
      expect(result.stderr).toContain('no flow');
      expect(result.stderr).not.toContain('SECTION');
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  });
});
