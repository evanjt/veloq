/**
 * Scenario: the connect page is TypeScript under web/connect/, built into
 * content-hashed files that the deploy uploads. A browser that holds a cached
 * module from one deploy must never be handed a module from another.
 *
 * Expected behaviour: every script and style in the output carries a hash of
 * its content in its name, the page names exactly those files, a rebuild of
 * the same source gives the same names, an edit moves the script's name and
 * leaves the stylesheet's, nothing from an earlier build survives, and the
 * content security policy reaches the output byte for byte.
 */

import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { gitFreeEnv } from '../__shared__/gitFixture';

const ROOT = resolve(__dirname, '../../..');
const BUILD = join(ROOT, 'scripts/build-connect-page.mjs');
const GUARD = join(ROOT, 'scripts/check-connect-page-local.mjs');

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** A scratch repository root holding a copy of the page's source. */
function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), 'connect-build-'));
  roots.push(root);
  mkdirSync(join(root, 'web'), { recursive: true });
  cpSync(join(ROOT, 'web/connect'), join(root, 'web/connect'), { recursive: true });
  // The page imports React, which the bundler resolves from the root it builds.
  symlinkSync(join(ROOT, 'node_modules'), join(root, 'node_modules'));
  return root;
}

function run(script: string, args: string[]): { status: number; output: string } {
  const result = spawnSync('node', [script, ...args], { env: gitFreeEnv(), encoding: 'utf8' });
  return { status: result.status ?? -1, output: `${result.stdout}${result.stderr}` };
}

const build = (root: string) => run(BUILD, ['--root', root]);
const outputOf = (root: string) => join(root, 'docs/connect');
const files = (root: string) => readdirSync(outputOf(root)).sort();
const page = (root: string) => readFileSync(join(outputOf(root), 'index.html'), 'utf8');

/** The script and style names the page refers to. */
function references(html: string): { script: string; style: string } {
  const script = html.match(/<script type="module" src="([^"]+)"/)?.[1];
  const style = html.match(/<link rel="stylesheet" href="([^"]+)"/)?.[1];
  if (!script || !style) throw new Error('the built page names no script or no style');
  return { script, style };
}

describe('connect page build', () => {
  it('names every script and style by a hash of its content, and the page names those files', () => {
    const root = scratch();
    expect(build(root)).toMatchObject({ status: 0 });

    const built = files(root);
    const hashed = built.filter((name) => /\.(js|css)$/.test(name));
    expect(hashed.length).toBeGreaterThanOrEqual(2);
    for (const name of hashed) expect(name).toMatch(/^[a-z]+-[A-Z0-9]{8}\.(js|css)$/);

    const { script, style } = references(page(root));
    expect(built).toContain(script);
    expect(built).toContain(style);
    expect(script).toMatch(/^boot-[A-Z0-9]{8}\.js$/);
    expect(existsSync(join(outputOf(root), 'qr.LICENSE.txt'))).toBe(true);
  });

  it('gives the same names when the same source is built twice', () => {
    const root = scratch();
    build(root);
    const first = files(root);
    build(root);
    expect(files(root)).toEqual(first);
  });

  it('moves the script name on a one-byte edit and leaves the style name alone', () => {
    const root = scratch();
    build(root);
    const before = references(page(root));

    const link = join(root, 'web/connect/link.ts');
    writeFileSync(link, readFileSync(link, 'utf8').replace('= 110;', '= 111;'));
    expect(build(root)).toMatchObject({ status: 0 });
    const after = references(page(root));

    expect(after.script).not.toBe(before.script);
    expect(after.style).toBe(before.style);
  });

  it('removes what an earlier build left, so a stale file cannot ride along', () => {
    const root = scratch();
    mkdirSync(outputOf(root), { recursive: true });
    writeFileSync(join(outputOf(root), 'app-STALE123.js'), 'export {}');
    writeFileSync(join(outputOf(root), 'link.js'), 'export {}');
    expect(build(root)).toMatchObject({ status: 0 });
    expect(files(root)).not.toContain('app-STALE123.js');
    expect(files(root)).not.toContain('link.js');
  });

  it('carries the content security policy over byte for byte', () => {
    const root = scratch();
    build(root);
    const policy = (html: string) => html.match(/<meta[^>]*Content-Security-Policy[^>]*>/s)?.[0];
    const template = readFileSync(join(root, 'web/connect/index.html'), 'utf8');
    expect(policy(template)).toBeDefined();
    expect(policy(page(root))).toBe(policy(template));
  });

  it('refuses a template that does not load the entry script', () => {
    const root = scratch();
    const template = join(root, 'web/connect/index.html');
    writeFileSync(template, readFileSync(template, 'utf8').replace('boot.ts', 'missing.ts'));
    const result = build(root);
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('index.html does not load boot.ts');
  });
});

describe('connect page local guard on the build', () => {
  it('passes the built output, and the template it was built from', () => {
    const root = scratch();
    build(root);
    expect(run(GUARD, ['--root', root])).toMatchObject({ status: 0 });
  });

  it('fails when the template gains a script from another origin', () => {
    const root = scratch();
    build(root);
    const template = join(root, 'web/connect/index.html');
    writeFileSync(
      template,
      readFileSync(template, 'utf8').replace(
        '</head>',
        '<script src="https://cdn.example.com/x.js"></script></head>'
      )
    );
    const result = run(GUARD, ['--root', root]);
    expect(result.status).toBe(1);
    expect(result.output).toContain('cdn.example.com');
  });

  it('fails a built script that imports from another origin', () => {
    const root = scratch();
    build(root);
    const { script } = references(page(root));
    writeFileSync(
      join(outputOf(root), script),
      `import 'https://cdn.example.com/x.js';\n${readFileSync(join(outputOf(root), script), 'utf8')}`
    );
    expect(run(GUARD, ['--root', root])).toMatchObject({ status: 1 });
  });

  it('fails when there is no page to judge', () => {
    const root = mkdtempSync(join(tmpdir(), 'connect-empty-'));
    roots.push(root);
    expect(run(GUARD, ['--root', root])).toMatchObject({ status: 1 });
  });
});
