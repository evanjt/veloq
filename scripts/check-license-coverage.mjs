#!/usr/bin/env node
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';

import { trackedText } from './lib/indexedSources.mjs';

const root = resolve(process.argv.slice(2).find((arg) => !arg.startsWith('--')) ?? '.');
const require = createRequire(join(root, 'package.json'));
const ts = require('typescript');
const read = (file) => {
  const text = trackedText(root, file);
  if (text === undefined) throw new Error(`check-license-coverage: ${file} is not in the tree`);
  return text;
};

const aliases = {
  react: 'React',
  'react-native': 'React Native',
  expo: 'Expo',
  '@shopify/react-native-skia': 'React Native Skia',
  'react-native-svg': 'React Native SVG',
  '@tanstack/react-query': 'TanStack Query',
  '@react-native-async-storage/async-storage': 'AsyncStorage',
  zustand: 'Zustand',
  zod: 'Zod',
  'react-native-paper': 'React Native Paper',
  'react-native-gesture-handler': 'React Native Gesture Handler',
  'react-native-reanimated': 'React Native Reanimated',
  'react-native-screens': 'React Native Screens',
  'react-native-webview': 'React Native WebView',
  'react-native-safe-area-context': 'React Native Safe Area Context',
  'react-native-body-highlighter': 'React Native Body Highlighter',
  'react-native-worklets': 'React Native Worklets',
  uniffi: 'UniFFI',
};
const firstParty = new Set(['veloqrs', 'tracematch']);

function licenceEntries() {
  const file = read('src/app/licenses.tsx');
  const ast = ts.createSourceFile('licenses.tsx', file, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const entries = new Map();
  function visit(node) {
    if (ts.isObjectLiteralExpression(node)) {
      const fields = Object.fromEntries(
        node.properties
          .filter(ts.isPropertyAssignment)
          .filter((property) => ts.isIdentifier(property.name) && ts.isStringLiteral(property.initializer))
          .map((property) => [property.name.text, property.initializer.text])
      );
      if (fields.name) entries.set(fields.name, fields);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return entries;
}

function rustDependencies() {
  const lines = read('modules/veloqrs/rust/veloqrs/Cargo.toml').split('\n');
  const names = [];
  let inDependencies = false;
  for (const line of lines) {
    const table = line.match(/^\[([^\]]+)\]/);
    if (table) {
      inDependencies = table[1] === 'dependencies' || /^target\..*\.dependencies$/.test(table[1]);
      continue;
    }
    if (!inDependencies) continue;
    const dependency = line.match(/^([\w-]+)\s*=/);
    if (dependency) names.push(dependency[1]);
  }
  return names;
}

const packages = Object.keys(JSON.parse(read('package.json')).dependencies);
const rust = rustDependencies();
const entries = licenceEntries();
const notice = read('THIRD_PARTY_LICENSES.md');
if (process.argv.includes('--print-register')) {
  for (const [title, names] of [
    ['JavaScript', packages],
    ['Rust', rust],
  ]) {
    console.log(`### ${title} direct dependencies\n`);
    console.log('| Package | Licence | Repository |');
    console.log('|---------|---------|------------|');
    for (const name of names) {
      if (firstParty.has(name)) continue;
      const entry = entries.get(aliases[name] ?? name);
      if (!entry?.license || !entry?.repository) throw new Error(`Missing licence entry for ${name}`);
      console.log(`| ${name} | ${entry.license} | ${entry.repository} |`);
    }
    console.log();
  }
  process.exit(0);
}
const missing = [];
for (const name of [...packages, ...rust]) {
  if (firstParty.has(name)) continue;
  const entry = entries.get(aliases[name] ?? name);
  if (!entry?.license || !entry?.repository) missing.push(`${name}: screen licence or repository`);
  if (!notice.includes(`| ${name} |`)) missing.push(`${name}: notice`);
}
if (missing.length) {
  console.error(`check-license-coverage: ${missing.join(', ')}`);
  process.exit(1);
}
console.log('check-license-coverage: complete');
