/**
 * Scenario: the E2E gate drives the build that ships, whose application id
 * differs from the development build's, and the same flows also run locally
 * against the development build. A flow that spells its own application id
 * drives one of them only.
 *
 * Expected behaviour: a flow takes its id from APP_ID, the substitution
 * resolves it to the id the environment names, and the flow guard names any
 * flow that fixes an id of its own.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const LIB = resolve(__dirname, '../../../scripts/lib/maestro-app-id.mjs');
const GUARD = resolve(__dirname, '../../../scripts/check-maestro-flows.mjs');

const PARAMETERISED = ['appId: ${APP_ID}', 'tags:', '  - tier0', '---', '- launchApp', ''].join(
  '\n'
);
const FIXED = ['appId: com.veloq.app.dev', '---', '- launchApp', ''].join('\n');

function inFixture<T>(flows: Record<string, string>, run: (root: string) => T): T {
  const root = mkdtempSync(join(tmpdir(), 'maestro-app-id-'));
  try {
    mkdirSync(join(root, '.maestro/helpers'), { recursive: true });
    for (const [name, text] of Object.entries(flows)) {
      writeFileSync(join(root, '.maestro', name), text);
    }
    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function resolveWith(flow: string, env: Record<string, string>) {
  return inFixture({ 'flow.yaml': flow }, (root) => {
    const result = spawnSync('node', [LIB, 'resolve', join(root, '.maestro/flow.yaml')], {
      encoding: 'utf8',
      env: { ...process.env, APP_ID: undefined, ...env },
    });
    return { status: result.status, out: result.stdout.trim(), err: result.stderr };
  });
}

describe('the application id a flow drives', () => {
  it('resolves to the production id when APP_ID names it', () => {
    expect(resolveWith(PARAMETERISED, { APP_ID: 'com.veloq.app' })).toMatchObject({
      status: 0,
      out: 'com.veloq.app',
    });
  });

  it('resolves to the development id when APP_ID names that one', () => {
    expect(resolveWith(PARAMETERISED, { APP_ID: 'com.veloq.app.dev' }).out).toBe(
      'com.veloq.app.dev'
    );
  });

  it('refuses to resolve when APP_ID is unset, rather than driving a package of the wrong name', () => {
    const result = resolveWith(PARAMETERISED, {});
    expect(result.status).toBe(2);
    expect(result.err).toContain('APP_ID');
  });

  it('keeps an id the flow fixes, so the guard has something to refuse', () => {
    expect(resolveWith(FIXED, { APP_ID: 'com.veloq.app' }).out).toBe('com.veloq.app.dev');
  });
});

describe('the flow guard on application ids', () => {
  const guard = (flows: Record<string, string>) =>
    inFixture(flows, (root) => {
      const result = spawnSync('node', [GUARD, '--root', root], { encoding: 'utf8' });
      return { status: result.status, output: `${result.stdout}${result.stderr}` };
    });

  it('passes flows and helpers that take the id from APP_ID', () => {
    expect(guard({ 'a.yaml': PARAMETERISED, 'helpers/b.yaml': PARAMETERISED }).status).toBe(0);
  });

  it('names a flow that fixes the development id, and a helper that fixes the production one', () => {
    const result = guard({
      'a.yaml': PARAMETERISED,
      'fixed.yaml': FIXED,
      'helpers/prod.yaml': FIXED.replace('.dev', ''),
    });
    expect(result.status).toBe(1);
    expect(result.output).toContain('.maestro/fixed.yaml: appId is com.veloq.app.dev');
    expect(result.output).toContain('.maestro/helpers/prod.yaml: appId is com.veloq.app');
    expect(result.output).not.toContain('.maestro/a.yaml');
  });

  it('leaves a file with no appId header alone', () => {
    expect(guard({ 'a.yaml': PARAMETERISED, 'bare.yaml': '- launchApp\n' }).status).toBe(0);
  });
});
