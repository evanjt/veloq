// Which cargo target caches the remote build host drops before a run.
//
// The host keeps one target cache per tree so a second run is incremental, and
// each is 8 to 20 GB. Nothing else removes them, so without this the root disk
// fills and runs fail partway through a toolchain install or a package
// extract, saying nothing about space.

const GB = 1024 ** 3;

/** How many of the largest idle caches a refusal names. */
const NAMED_IN_REFUSAL = 5;

const gb = (bytes) => `${(bytes / GB).toFixed(1)} GB`;
const hours = (seconds) => `${Math.floor(seconds / 3600)} h`;

/**
 * The caches to remove before a run, and the refusal when the run should not
 * start.
 *
 * At or above `floor` free bytes nothing is removed. Below it, caches that no
 * running container holds, that are not `self` and that were last written
 * `maxIdle` seconds or more before `now` are taken least recently written
 * first until free space reaches `mark`. When that leaves free space under
 * `floor` the run is refused, and the message names the largest caches no
 * container holds, so whoever reads it knows what to remove by hand.
 *
 * `slots` is each cache's name, size in bytes, last write in epoch seconds
 * and whether a running container holds it.
 */
function planPreflight({ free, floor, mark, maxIdle, now, self, slots }) {
  if (free >= floor) return { prune: [], refuse: null };

  const candidates = slots
    .filter((s) => !s.busy && s.name !== self && now - s.lastWrite >= maxIdle)
    .sort((a, b) => a.lastWrite - b.lastWrite || b.size - a.size);
  const prune = [];
  let after = free;
  for (const s of candidates) {
    if (after >= mark) break;
    prune.push(s.name);
    after += s.size;
  }
  if (after >= floor) return { prune, refuse: null };

  const named = slots
    .filter((s) => !s.busy && s.name !== self && !prune.includes(s.name))
    .sort((a, b) => b.size - a.size)
    .slice(0, NAMED_IN_REFUSAL)
    .map((s) => `  ${s.name} ${gb(s.size)} idle ${hours(now - s.lastWrite)}`);
  const refuse = [
    `${gb(after)} free on the build host after removing every cache idle ${hours(maxIdle)} ` +
      `or more, under the ${gb(floor)} floor.`,
    named.length > 0 ? 'Largest caches no running container holds:' : 'No cache is free to remove.',
    ...named,
  ].join('\n');
  return { prune, refuse };
}

/**
 * The host's listing, one cache per line: name, size in kilobytes, last write
 * in epoch seconds and 1 when a running container holds it, tab separated.
 */
function parseListing(text) {
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const [name, kb, lastWrite, busy] = line.split('\t');
      const fields = [kb, lastWrite, busy];
      if (!name || fields.some((f) => f === undefined || !/^\d+$/.test(f))) {
        throw new Error(`unreadable cache listing line: ${line}`);
      }
      return { name, size: Number(kb) * 1024, lastWrite: Number(lastWrite), busy: busy === '1' };
    });
}

module.exports = { planPreflight, parseListing };

// Run as `node remote-build-prune.js <free kB> <self> <floor GB> <mark GB> <idle hours>`
// with the listing on stdin: prints one cache to remove per line, and on a
// refusal prints the message to stderr and exits 3.
if (require.main === module) {
  const [freeKb, self, floorGb, markGb, idleHours] = process.argv.slice(2);
  const plan = planPreflight({
    free: Number(freeKb) * 1024,
    floor: Number(floorGb) * GB,
    mark: Number(markGb) * GB,
    maxIdle: Number(idleHours) * 3600,
    now: Math.floor(Date.now() / 1000),
    self,
    slots: parseListing(require('fs').readFileSync(0, 'utf8')),
  });
  for (const name of plan.prune) process.stdout.write(`${name}\n`);
  if (plan.refuse) {
    process.stderr.write(`${plan.refuse}\n`);
    process.exit(3);
  }
}
