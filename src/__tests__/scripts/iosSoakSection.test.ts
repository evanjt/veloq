/**
 * Scenario: the section soak flow opens a section by id, and a default id from
 * some other library is absent from the demo library, so every cycle fails.
 * Expected behaviour: the script refuses the section surface when no section
 * is named, before it touches a simulator.
 */
import { spawnSync } from 'child_process';
import * as path from 'path';

const SCRIPT = path.resolve(__dirname, '../../../scripts/ios-soak.sh');

function run(env: Record<string, string>, surfaces: string[]) {
  const clean = { ...process.env, ...env };
  if (!('SECTION_ALT' in env)) delete clean.SECTION_ALT;
  if (!('SECTION' in env)) delete clean.SECTION;
  return spawnSync('bash', [SCRIPT, 'SIM-UDID', '/nonexistent-out', '1', ...surfaces], {
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
    const result = run({}, ['feed']);
    expect(result.stderr).not.toContain('SECTION');
  });
});
