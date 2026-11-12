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
<script type="module" src="boot.ts"></script>
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
    'web/connect/index.html': page(''),
    'web/connect/app.ts':
      "import { step } from './link';\nconst RELAY = 'wss://auth.veloq.fit/link/';\n",
    'web/connect/connect.css': 'body { margin: 0; }\n',
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

  it('passes a component importing the packages the build bundles', () => {
    const root = fixture({
      'web/connect/App.tsx':
        "import { useState } from 'react';\nimport { createRoot } from 'react-dom/client';\nimport { step } from './link';\n",
    });
    expect(guard(root)).toMatchObject({ status: 0 });
  });

  it.each([
    [
      'a script from a CDN',
      { 'web/connect/index.html': page('<script src="https://cdn.example.com/qr.js"></script>') },
    ],
    [
      'a protocol-relative stylesheet',
      {
        'web/connect/index.html': page(
          '<link rel="stylesheet" href="//fonts.example.com/a.css" />'
        ),
      },
    ],
    [
      'a module imported from another origin',
      { 'web/connect/app.ts': "import qr from 'https://esm.example.com/qr';\n" },
    ],
    [
      'a dynamic import from another origin',
      { 'web/connect/app.ts': "await import('https://esm.example.com/qr');\n" },
    ],
    ['a bare package import', { 'web/connect/app.ts': "import qr from 'qrcode';\n" }],
    [
      'a bare package import in a component',
      { 'web/connect/App.tsx': "import qr from 'qrcode';\n" },
    ],
    [
      'an import of a bundled package by a path inside it',
      { 'web/connect/App.tsx': "import { flushSync } from 'react-dom';\n" },
    ],
    [
      'a stylesheet importing a web font',
      { 'web/connect/connect.css': "@import url('https://fonts.example.com/a.css');\n" },
    ],
    [
      'a policy that lets in another script origin',
      {
        'web/connect/index.html': page('').replace(
          "script-src 'self'",
          "script-src 'self' https://cdn.example.com"
        ),
      },
    ],
    ['no policy at all', { 'web/connect/index.html': page('').replace(POLICY, '') }],
  ])('fails %s', (_case, files) => {
    const result = guard(fixture(files));
    expect(result.status).toBe(1);
    expect(result.output).toContain('check-connect-page-local: ');
  });

  it('reads the index, so an unstaged edit is not what it judges', () => {
    const root = fixture({});
    put(root, 'web/connect/app.ts', "import qr from 'https://esm.example.com/qr';\n");
    expect(guard(root)).toMatchObject({ status: 0 });
  });
});
