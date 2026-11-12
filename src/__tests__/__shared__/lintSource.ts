import { join } from 'node:path';

import { ESLint } from 'eslint';

const ROOT = join(__dirname, '../../..');

let eslint: ESLint | undefined;

/**
 * The messages the repository's lint config reports for a source text, as one
 * JSON string. The text is linted in process under the given name, which the
 * config's globs match against, so no file is written into `src/` and one
 * ESLint instance serves every case in a suite.
 */
export async function lintSource(source: string, filename: string): Promise<string> {
  // The config is handed over as an object: ESLint loads a config file with a
  // dynamic import, which Jest's module runtime does not allow.
  eslint ??= new ESLint({
    cwd: ROOT,
    warnIgnored: false,
    overrideConfigFile: true,
    overrideConfig: require('../../../eslint.config.js'),
  });
  const results = await eslint.lintText(source, { filePath: join(ROOT, filename) });
  return JSON.stringify(results.flatMap((result) => result.messages));
}
