const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { existsSync, lstatSync, readFileSync, readlinkSync } = require('node:fs');
const path = require('node:path');

// Hash tracked build inputs, including resources and lockfiles regardless of
// extension. Generated native/build directories must never enter the cache key.
const buildDirectories = new Set([
  'src',
  'app',
  'modules',
  'plugins',
  'widget',
  'assets',
  'patches',
  'expo-modules',
  'ios',
  'android',
  'config',
  'scripts',
  '.github',
]);

/**
 * `process.env` without the pointers git exports to everything a hook runs.
 * They beat `cwd`, so without this the hash would be of whatever tree the hook
 * belongs to rather than of `cwd`.
 */
function gitFreeEnv() {
  const env = { ...process.env };
  for (const key of [
    'GIT_DIR',
    'GIT_INDEX_FILE',
    'GIT_WORK_TREE',
    'GIT_OBJECT_DIRECTORY',
    'GIT_COMMON_DIR',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES',
    'GIT_PREFIX',
    'GIT_CEILING_DIRECTORIES',
  ]) {
    delete env[key];
  }
  return env;
}

/** Whether `file`, a repository path, is an input of a `profile` build. */
function isBuildInput(file, profile) {
  // Include root configuration files as well as all supported source trees.
  if (file.includes('/') && !buildDirectories.has(file.split('/')[0])) return false;
  if (/\.md$/i.test(file) || file.startsWith('src/__tests__/')) return false;
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(file)) return false;
  if (profile !== 'all' && file.startsWith(`widget/${profile === 'ios' ? 'android' : 'ios'}/`)) {
    return false;
  }
  return true;
}

function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: gitFreeEnv(),
    maxBuffer: 1 << 28,
  });
}

function nulList(text) {
  return text.split('\0').filter(Boolean);
}

/** What a working-tree file holds: a link's target, a file's bytes, or nothing. */
function workingContent(full) {
  let stat;
  try {
    stat = lstatSync(full);
  } catch {
    return Buffer.from('\0deleted');
  }
  // A link is its target, as git records it, and may name a directory.
  if (stat.isSymbolicLink()) return Buffer.from(`\0link\0${readlinkSync(full)}`);
  return readFileSync(full);
}

/**
 * A submodule at its recorded commit with nothing edited is that commit, so a
 * clean checkout hashes as CI's does. Otherwise it is the commit it is on and
 * every file its working tree holds, tracked or not, ignored ones aside.
 */
function submoduleContent(dir, recorded) {
  if (!existsSync(path.join(dir, '.git'))) return recorded;
  const head = git(['rev-parse', 'HEAD'], dir).trim();
  const status = git(['status', '--porcelain', '--untracked-files=all'], dir);
  if (head === recorded && status === '') return recorded;
  const hash = createHash('sha256').update(`submodule\0${head}\0`);
  const files = nulList(git(['ls-files', '-z', '--cached', '--others', '--exclude-standard'], dir));
  for (const file of [...new Set(files)].sort()) {
    hash.update(`${file}\0`);
    hash.update(
      createHash('sha256')
        .update(workingContent(path.join(dir, file)))
        .digest()
    );
  }
  return hash.digest('hex');
}

/**
 * The hash of a tree's build inputs. By default it is what CI keys caches on:
 * the files git tracks, at their working-tree content, and each submodule at
 * its recorded commit. `local` makes it the identity of what a build in this
 * tree compiles: untracked source under a build directory counts, ignored
 * build products and scratch files at the root do not, and a submodule with
 * edits is read from its working tree.
 */
function computeSourceHash(cwd = process.cwd(), profile = 'android', { local = false } = {}) {
  if (!['android', 'ios', 'all'].includes(profile)) {
    throw new Error(`Unknown source profile: ${profile}`);
  }
  const entries = nulList(git(['ls-files', '--stage', '-z'], cwd)).map((entry) => {
    const [metadata, ...parts] = entry.split('\t');
    const [mode, object, stage] = metadata.split(' ');
    return { file: parts.join('\t'), mode, object, stage };
  });
  if (local) {
    const tracked = new Set(entries.map((e) => e.file));
    for (const file of nulList(git(['ls-files', '-z', '--others', '--exclude-standard'], cwd))) {
      if (file.includes('/') && !tracked.has(file))
        entries.push({ file, mode: 'untracked', stage: '0' });
    }
  }
  entries.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  const hash = createHash('sha256').update(`build-inputs-v2:${profile}\0`);
  for (const { file, mode, object, stage } of entries) {
    if (!isBuildInput(file, profile)) continue;
    if (stage !== '0') throw new Error(`Unmerged build input: ${file}`);
    hash.update(`${mode}\0${file}\0`);
    const full = path.join(cwd, file);
    let content;
    if (mode === '160000') content = local ? submoduleContent(full, object) : object;
    else if (local || mode === '120000') content = workingContent(full);
    else content = readFileSync(full);
    hash.update(createHash('sha256').update(content).digest());
  }
  return hash.digest('hex').slice(0, 12);
}

module.exports = { computeSourceHash, isBuildInput };
if (require.main === module) console.log(computeSourceHash(process.cwd(), process.argv[2]));
