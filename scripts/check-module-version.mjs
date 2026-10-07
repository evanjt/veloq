#!/usr/bin/env node
import { resolve } from 'node:path';

import { trackedText } from './lib/indexedSources.mjs';

const root = resolve(process.argv[2] ?? '.');
const version = (file) => JSON.parse(trackedText(root, file)).version;
const app = version('package.json');
const module = version('modules/veloqrs/package.json');
const lock = JSON.parse(trackedText(root, 'package-lock.json'));
const lockedModule = lock.packages?.['modules/veloqrs']?.version;
if (module !== app || lockedModule !== app) {
  console.error(`check-module-version: veloqrs version ${module}, lock version ${lockedModule}, app version ${app} differ`);
  process.exit(1);
}
console.log(`check-module-version: ${app}`);
