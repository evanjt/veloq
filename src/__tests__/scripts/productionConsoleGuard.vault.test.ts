import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve(__dirname, '../../../scripts/check-production-console.mjs');

function check(source: string): { status: number | null; output: string } {
  const root = mkdtempSync(join(tmpdir(), 'console-config-'));
  try {
    writeFileSync(join(root, 'babel.config.js'), source);
    const run = spawnSync('node', [SCRIPT, root], { encoding: 'utf8' });
    return { status: run.status, output: `${run.stdout}${run.stderr}` };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

it('accepts the production console strip with errors retained', () => {
  expect(
    check(
      "module.exports = () => ({plugins: [['transform-remove-console', {exclude: ['error']}]]})"
    ).status
  ).toBe(0);
});

it.each([
  'module.exports = () => ({plugins: []})',
  "module.exports = () => ({plugins: [['transform-remove-console', {exclude: []}]]})",
  "module.exports = () => ({plugins: [['transform-remove-console', {exclude: ['warn']}]]})",
])('rejects a production config that ships logs or strips errors', (source) => {
  const run = check(source);
  expect(run.status).toBe(1);
  expect(run.output).toContain('transform-remove-console');
});
