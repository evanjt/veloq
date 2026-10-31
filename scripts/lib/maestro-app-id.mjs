// The application id a Maestro flow drives.
//
// A flow names its app as `appId: ${APP_ID}` and Maestro substitutes the value
// of the `-e APP_ID=...` it was started with. The E2E gate drives the build
// that ships (`com.veloq.app`), and a run on a workstation drives the
// development build (`com.veloq.app.dev`) unless it says otherwise, so no flow
// may spell either id itself.
//
//   node scripts/lib/maestro-app-id.mjs resolve <flow.yaml>
//       prints the id the flow drives under the environment's APP_ID, and
//       exits 2 when the flow names a variable the environment does not set

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { loadAll } from 'js-yaml';

/** The id a flow's header names after substituting `${NAME}` from env, or null when it has none. */
export function resolveAppId(flowText, env = process.env) {
  const header = loadAll(flowText)[0];
  const appId = header && !Array.isArray(header) ? header.appId : undefined;
  if (typeof appId !== 'string') return null;
  return appId.replace(/\$\{\s*([A-Za-z_]\w*)\s*\}/g, (_match, name) => {
    if (env[name] === undefined || env[name] === '') {
      throw new Error(`the flow's appId names ${name}, which is not set`);
    }
    return env[name];
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [command, file] = process.argv.slice(2);
  if (command !== 'resolve' || !file) {
    console.error('usage: maestro-app-id.mjs resolve <flow.yaml>');
    process.exit(2);
  }
  try {
    const id = resolveAppId(readFileSync(file, 'utf8'));
    if (id === null) {
      console.error(`maestro-app-id: ${file} has no appId header`);
      process.exit(2);
    }
    console.log(id);
  } catch (error) {
    console.error(`maestro-app-id: ${error.message}`);
    process.exit(2);
  }
}
