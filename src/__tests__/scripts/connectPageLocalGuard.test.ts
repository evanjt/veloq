/**
 * Expected behaviour: the connect page loads only its own files. The guard
 * passes a page whose scripts, styles and imports are all relative and whose
 * policy allows only them, and fails one that pulls in anything from another
 * origin or drops the policy. It reads the index, not the disk.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { gitFreeEnv, runGit } from '../__shared__/gitFixture';

const GUARD = join(resolve(__dirname, '../../..'), 'scripts/check-connect-page-local.mjs');

const POLICY =
  "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'self'; style-src 'self'; connect-src wss://auth.veloq.fit\" />";

const page = (head: string) => `<!doctype html>
<html><head>${POLICY}
<link rel="icon" href="../icon.png" />
<link rel="stylesheet" href="connect.css" />
<script type="module" src="app.js"></script>
${head}</head><body></body></html>
`;

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function put(root: string, file: string, contents: string): void {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), contents);
}

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'connect-local-'));
  roots.push(root);
  runGit(['init', '-q'], root);
  const all: Record<string, string> = {
    'docs/connect/index.html': page(''),
    'docs/connect/app.js':
      "import { step } from './link.js';\nconst RELAY = 'wss://auth.veloq.fit/link/';\n",
    'docs/connect/connect.css': 'body { margin: 0; }\n',
    ...files,
  };
  for (const [file, contents] of Object.entries(all)) put(root, file, contents);
  runGit(['add', '-A'], root);
  return root;
}

function guard(root: string): { status: number; output: string } {
  const run = spawnSync('node', [GUARD, '--root', root], {
    cwd: root,
    env: gitFreeEnv(),
    encoding: 'utf8',
  });
  return { status: run.status ?? -1, output: `${run.stdout}${run.stderr}` };
}

describe('connect page local guard', () => {
  it('passes a page that loads only its own files', () => {
    expect(guard(fixture({}))).toMatchObject({ status: 0 });
  });

  it.each([
    [
      'a script from a CDN',
      { 'docs/connect/index.html': page('<script src="https://cdn.example.com/qr.js"></script>') },
    ],
    [
      'a protocol-relative stylesheet',
      {
        'docs/connect/index.html': page(
          '<link rel="stylesheet" href="//fonts.example.com/a.css" />'
        ),
      },
    ],
    [
      'a module imported from another origin',
      { 'docs/connect/app.js': "import qr from 'https://esm.example.com/qr';\n" },
    ],
    [
      'a dynamic import from another origin',
      { 'docs/connect/app.js': "await import('https://esm.example.com/qr');\n" },
    ],
    ['a bare package import', { 'docs/connect/app.js': "import qr from 'qrcode';\n" }],
    [
      'a stylesheet importing a web font',
      { 'docs/connect/connect.css': "@import url('https://fonts.example.com/a.css');\n" },
    ],
    [
      'a policy that lets in another script origin',
      {
        'docs/connect/index.html': page('').replace(
          "script-src 'self'",
          "script-src 'self' https://cdn.example.com"
        ),
      },
    ],
    ['no policy at all', { 'docs/connect/index.html': page('').replace(POLICY, '') }],
  ])('fails %s', (_case, files) => {
    const result = guard(fixture(files));
    expect(result.status).toBe(1);
    expect(result.output).toContain('check-connect-page-local: ');
  });

  it('reads the index, so an unstaged edit is not what it judges', () => {
    const root = fixture({});
    put(root, 'docs/connect/app.js', "import qr from 'https://esm.example.com/qr';\n");
    expect(guard(root)).toMatchObject({ status: 0 });
  });
});
