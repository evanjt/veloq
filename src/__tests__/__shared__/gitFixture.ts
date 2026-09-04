/**
 * Shell out to git without inheriting the hook's git environment.
 *
 * `.husky/pre-commit` runs the gates from git, and git exports `GIT_DIR`,
 * `GIT_INDEX_FILE` and `GIT_WORK_TREE` to whatever it runs. Those beat `cwd`,
 * so a `git add -A` meant for a temporary fixture stages the fixture into the
 * repository's own index and marks every real file deleted. That is how a
 * commit of two files came out as 2,023 files changed.
 */

import { execFileSync } from 'node:child_process';

/** The variables git hands a hook, all of which override `cwd`. */
const INHERITED = [
  'GIT_DIR',
  'GIT_INDEX_FILE',
  'GIT_WORK_TREE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_COMMON_DIR',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_PREFIX',
  'GIT_CEILING_DIRECTORIES',
];

/** `process.env` with every inherited git pointer removed. */
export function gitFreeEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  for (const key of INHERITED) delete env[key];
  return env;
}

/** Run git against `cwd` and nothing else. */
export function runGit(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, env: gitFreeEnv(), encoding: 'utf8' });
}

/** A temporary repository holding whatever is already in `root`. */
export function initFixtureRepo(root: string): void {
  runGit(['init', '-q'], root);
  runGit(['add', '-A'], root);
}
