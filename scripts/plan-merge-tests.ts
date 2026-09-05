#!/usr/bin/env npx tsx
/**
 * The commands a merge's changed files call for, one per line, on stdin/stdout.
 *
 * Kept apart from the shell so the mapping is testable: which suites a merge
 * runs is the part that decides whether the gate catches anything.
 */

import { mergeTestCommands, mergeTestTargets } from './lib/mergeTestTargets';

const changed = require('node:fs')
  .readFileSync(0, 'utf8')
  .split('\n')
  .map((line: string) => line.trim())
  .filter(Boolean);

console.log(mergeTestCommands(mergeTestTargets(changed)).join('\n'));
