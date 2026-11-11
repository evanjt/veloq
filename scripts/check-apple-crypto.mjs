#!/usr/bin/env node
// Fail when the Apple dependency tree of veloqrs carries cipher code of its own.
//
// The remote link takes its DTLS ciphers from CryptoKit and the Security framework
// on Apple targets, and the pairing takes its SHA-256 and HMAC from CommonCrypto,
// so the tree for an iOS target must not name the pure Rust providers or the
// crates behind them. `--tree <file>` reads the tree from a file instead of
// running cargo, for the test beside this file.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { gitFreeEnv } from './lib/indexedSources.mjs';

const TARGET = 'aarch64-apple-ios';
const FORBIDDEN = ['aws-lc-sys', 'str0m-rust-crypto', 'aes-gcm', 'p256', 'rcgen', 'hmac', 'sha2'];

function crateNames(tree) {
  return tree
    .split('\n')
    .map((line) => line.trim().split(/\s+/)[0])
    .filter(Boolean);
}

try {
  const flag = (name) => {
    const at = process.argv.indexOf(name);
    return at === -1 ? undefined : process.argv[at + 1];
  };
  let tree;
  const file = flag('--tree');
  if (file) {
    tree = readFileSync(file, 'utf8');
  } else {
    const root = flag('--root') ? resolve(flag('--root')) : process.cwd();
    const run = spawnSync(
      'cargo',
      ['tree', '-p', 'veloqrs', '-e', 'normal', '--target', TARGET, '--prefix', 'none'],
      { cwd: resolve(root, 'modules/veloqrs/rust'), env: gitFreeEnv(), encoding: 'utf8' }
    );
    if (run.error) throw new Error(`could not start cargo tree: ${run.error.message}`);
    if (run.status !== 0) throw new Error(`cargo tree failed (exit ${run.status}): ${run.stderr}`);
    tree = run.stdout;
  }
  const names = new Set(crateNames(tree));
  if (!names.has('veloqrs'))
    throw new Error('the tree does not name veloqrs, so it proves nothing');
  const found = FORBIDDEN.filter((name) => names.has(name));
  if (found.length > 0) {
    throw new Error(
      `the ${TARGET} tree carries its own cipher code (${found.join(', ')}); Apple targets take DTLS and the pairing hash and MAC from the operating system`
    );
  }
  console.log(`check-apple-crypto: the ${TARGET} tree carries no cipher crate of its own`);
} catch (error) {
  console.error(`check-apple-crypto: ${error.message}`);
  process.exitCode = 1;
}
