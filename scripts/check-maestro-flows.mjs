// Fails when a Maestro flow is not valid YAML.
//
// Maestro reads every file under .maestro before it runs the first flow, so one
// that does not parse stops the whole suite on both platforms with no flow named.
// The E2E gate only runs after a push to main, which is a week away from the
// commit that broke it when pushes are that far apart.

import { join, relative, resolve } from 'node:path';

import { loadAll } from 'js-yaml';

import { treeView } from './lib/indexedSources.mjs';

const rootArg = process.argv.indexOf('--root');
const root = resolve(rootArg < 0 ? '.' : process.argv[rootArg + 1]);
const tree = treeView(root, ['.maestro']);

const flows = tree.files(join(root, '.maestro'), (rel) => /\.ya?ml$/.test(rel));
if (flows.length === 0) {
  console.error('check-maestro-flows: no YAML files under .maestro, so nothing was checked');
  process.exit(1);
}

const failures = [];
for (const file of flows) {
  try {
    loadAll(tree.text(file));
  } catch (error) {
    failures.push(`${relative(root, file)}: ${error.message.split('\n')[0]}`);
  }
}

if (failures.length > 0) {
  console.error(`check-maestro-flows: ${failures.length} flow file(s) do not parse:`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log(`check-maestro-flows: ${flows.length} flow files parse`);
