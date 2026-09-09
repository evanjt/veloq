const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
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

function computeSourceHash(cwd = process.cwd(), profile = 'android') {
  if (!['android', 'ios'].includes(profile)) throw new Error(`Unknown source profile: ${profile}`);
  const entries = execFileSync('git', ['ls-files', '--stage', '-z'], { cwd, encoding: 'utf8' });
  const hash = createHash('sha256').update(`build-inputs-v2:${profile}\0`);
  for (const entry of entries.split('\0').filter(Boolean).sort()) {
    const [metadata, ...parts] = entry.split('\t');
    const file = parts.join('\t');
    // Include root configuration files as well as all supported source trees.
    if (file.includes('/') && !buildDirectories.has(file.split('/')[0])) continue;
    if (/\.md$/i.test(file) || file.startsWith('src/__tests__/')) continue;
    if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(file)) continue;
    if (file.startsWith(`widget/${profile === 'ios' ? 'android' : 'ios'}/`)) continue;
    const [mode, object, stage] = metadata.split(' ');
    if (stage !== '0') throw new Error(`Unmerged build input: ${file}`);
    hash.update(`${mode}\0${file}\0`);
    // A submodule's recorded commit identifies its complete source tree.
    const content = mode === '160000' ? object : readFileSync(path.join(cwd, file));
    hash.update(createHash('sha256').update(content).digest());
  }
  return hash.digest('hex').slice(0, 12);
}

module.exports = { computeSourceHash };
if (require.main === module) console.log(computeSourceHash(process.cwd(), process.argv[2]));
