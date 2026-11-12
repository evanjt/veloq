// Decides which guards a landing needs. A guard that names `paths` judges only
// the files under those prefixes, so a landing whose range touches none of them
// cannot move its verdict. A guard without `paths` is whole-tree and always runs.
// `changed` is the landed range's file list, or null when it is unknown (no base,
// a base the repository lacks, not a repository): then every guard runs.
export function planGuards(guards, changed) {
  if (!Array.isArray(changed)) return { run: guards, skipped: [] };
  const run = [];
  const skipped = [];
  for (const guard of guards) {
    const paths = guard.paths;
    if (!Array.isArray(paths) || paths.length === 0) {
      run.push(guard);
    } else if (changed.some((file) => paths.some((prefix) => file.startsWith(prefix)))) {
      run.push(guard);
    } else {
      skipped.push(guard);
    }
  }
  return { run, skipped };
}
