/**
 * Scenario: the maps run in WebKit helper processes the simulator starts for the
 * app, parented by the simulator's launchd rather than by the app. A reading of
 * the app pid alone, 413 MB in the capture below, misses the 390 MB they hold.
 * The host runs its own WebKit helpers too, and a simulator helper can outlive
 * an earlier launch of the app.
 *
 * Expected behaviour: a reading takes the app and every simulator WebKit helper
 * started since the app was, leaves the host's and the older ones out, and the
 * gate fails a total that grew past the allowed regression over the baseline.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const projectRoot = path.join(__dirname, '../../..');
const memory = require('../../../scripts/lib/ios-memory.js');

const SIM =
  '/Library/Developer/CoreSimulator/Volumes/iOS_23C54/Library/Developer/CoreSimulator/Profiles/Runtimes/iOS 26.2.simruntime/Contents/Resources/RuntimeRoot/System/Library/ExtensionKit/Extensions';
const APP =
  '/Users/tester/Library/Developer/CoreSimulator/Devices/00000000-0000-4000-8000-000000000001/data/Containers/Bundle/Application/00000000-0000-4000-8000-000000000002/VeloqDev.app';

/** `ps -axo pid=,ppid=,etime=,comm=` on a Mac running the simulator, trimmed. */
const PS = `    1     0 02-19:06:30 /sbin/launchd
  645     1 02-19:06:08 /System/Volumes/Preboot/Cryptexes/App/System/Applications/Safari.app/Contents/MacOS/Safari
  655     1 02-19:06:08 /System/Library/Frameworks/WebKit.framework/Versions/A/XPCServices/com.apple.WebKit.Networking.xpc/Contents/MacOS/com.apple.WebKit.Networking
  658     1 02-19:06:08 /System/Library/Frameworks/WebKit.framework/Versions/A/XPCServices/com.apple.WebKit.GPU.xpc/Contents/MacOS/com.apple.WebKit.GPU
  671     1 02-19:06:07 /System/Library/Frameworks/WebKit.framework/Versions/A/XPCServices/com.apple.WebKit.WebContent.xpc/Contents/MacOS/com.apple.WebKit.WebContent
11062 23004    15:59:55 ${APP}/PlugIns/VeloqWidget.appex/VeloqWidget
23004     1 01-07:17:50 launchd_sim
44275 23004    05:56:55 /Library/Developer/CoreSimulator/Volumes/iOS_23C54/Library/Developer/CoreSimulator/Profiles/Runtimes/iOS 26.2.simruntime/Contents/Resources/RuntimeRoot/System/Cryptexes/OS/System/Library/Frameworks/WebKit.framework/Daemons/adattributiond
82657 23004    20:43:17 ${APP}/VeloqDev
82669 23004    20:43:07 ${SIM}/GPUExtension.appex/com.apple.WebKit.GPU
82670 23004    20:43:07 ${SIM}/WebContentExtension.appex/com.apple.WebKit.WebContent
82671 23004    20:43:07 ${SIM}/WebContentExtension.appex/com.apple.WebKit.WebContent
82672 23004    20:43:07 ${SIM}/NetworkingExtension.appex/com.apple.WebKit.Networking
82687 23004    20:42:53 ${SIM}/WebContentExtension.appex/com.apple.WebKit.WebContent
`;

function header(name: string, pid: number, bytes: number) {
  const rule = '='.repeat(70);
  return `${rule}
${name} [${pid}]: 64-bit    Footprint: ${bytes} B (16384 bytes per page)
${rule}

Auxiliary data:
    phys_footprint: ${bytes + 49152} B
    phys_footprint_peak: ${bytes * 2} B
`;
}

/** `footprint --noCategories -f bytes` over the six selected pids, as captured. */
const FOOTPRINT = [
  header('VeloqDev', 82657, 433267712),
  header('com.apple.WebKit.WebContent', 82687, 164241920),
  header('com.apple.WebKit.WebContent', 82671, 94036480),
  header('com.apple.WebKit.WebContent', 82670, 92266880),
  header('com.apple.WebKit.GPU', 82669, 37887232),
  header('com.apple.WebKit.Networking', 82672, 20274112),
  `${'='.repeat(70)}\nSummary Footprint: 841892416 B\n${'='.repeat(70)}\n`,
].join('\n');

const MIB = 1024 * 1024;

describe('one iOS memory reading', () => {
  it('takes the app and the WebKit helpers the simulator started for it', () => {
    const pids = memory.selectProcesses(PS, 82657).map((p: { pid: number }) => p.pid);
    expect(pids).toEqual([82657, 82669, 82670, 82671, 82672, 82687]);
  });

  it('sums the helpers into the total, which the app pid alone understates by half', () => {
    const point = memory.readPoint('map', PS, FOOTPRINT, 82657);

    expect(Math.round(point.appBytes / MIB)).toBe(413);
    expect(Math.round(point.totalBytes / MIB)).toBe(803);
    expect(Math.round(point.helperBytes / MIB)).toBe(390);
    expect(point.processes).toHaveLength(6);
    expect(point.missing).toEqual([]);
  });

  it('leaves out the host WebKit helpers and the other simulator processes', () => {
    const point = memory.readPoint('map', PS, FOOTPRINT, 82657);
    const pids = point.processes.map((p: { pid: number }) => p.pid);
    for (const excluded of [655, 658, 671, 645, 11062, 44275, 23004]) {
      expect(pids).not.toContain(excluded);
    }
  });

  it('leaves out a simulator helper older than the running app', () => {
    const relaunched = PS.replace('82657 23004    20:43:17', '82657 23004       05:00');
    const pids = memory.selectProcesses(relaunched, 82657).map((p: { pid: number }) => p.pid);
    expect(pids).toEqual([82657]);
  });

  it('counts a helper started in the same second as the app', () => {
    const same = PS.replace('82669 23004    20:43:07', '82669 23004    20:43:17');
    const pids = memory.selectProcesses(same, 82657).map((p: { pid: number }) => p.pid);
    expect(pids).toContain(82669);
  });

  it('names a helper that exited before footprint read it rather than counting it as zero', () => {
    const gone = FOOTPRINT.replace(header('com.apple.WebKit.GPU', 82669, 37887232), '');
    const point = memory.readPoint('map', PS, gone, 82657);
    expect(point.missing).toEqual([82669]);
    expect(Math.round(point.totalBytes / MIB)).toBe(803 - 36);
  });

  it('refuses a reading with no app pid in the process list', () => {
    expect(() => memory.selectProcesses(PS, 99999)).toThrow(/99999/);
  });

  it('refuses a reading whose footprint has no line for the app', () => {
    const noApp = FOOTPRINT.replace('VeloqDev [82657]', 'Other [1]');
    expect(() => memory.readPoint('map', PS, noApp, 82657)).toThrow(/82657/);
  });

  it('reads every elapsed-time form ps prints', () => {
    expect(memory.elapsedSeconds('00:07')).toBe(7);
    expect(memory.elapsedSeconds('20:43:17')).toBe(20 * 3600 + 43 * 60 + 17);
    expect(memory.elapsedSeconds('02-19:06:30')).toBe(2 * 86400 + 19 * 3600 + 6 * 60 + 30);
    expect(() => memory.elapsedSeconds('soon')).toThrow();
  });

  it('reads a formatted footprint as well as bytes', () => {
    const formatted = FOOTPRINT.replace('Footprint: 433267712 B', 'Footprint: 413 MB');
    const app = memory.parseFootprint(formatted).get(82657);
    expect(app.bytes).toBe(413 * MIB);
  });
});

describe('the regression gate', () => {
  const record = (totals: Record<string, number>) => ({
    points: Object.entries(totals).map(([label, totalBytes]) => ({ label, totalBytes })),
  });
  const baseline = record({ launch: 400 * MIB, map: 800 * MIB });

  it('passes a run inside the allowed regression, the boundary included', () => {
    const run = record({ launch: 440 * MIB, map: 920 * MIB });
    expect(memory.compareRecords(run, baseline, 0.15).ok).toBe(true);
  });

  it('fails a point that grew past it', () => {
    const run = record({ launch: 400 * MIB, map: 930 * MIB });
    const verdict = memory.compareRecords(run, baseline, 0.15);
    expect(verdict.ok).toBe(false);
    expect(verdict.rows.find((r: { label: string }) => r.label === 'map').over).toBe(true);
  });

  it('fails when the runs share no point to compare', () => {
    const run = record({ elsewhere: 100 * MIB });
    expect(memory.compareRecords(run, baseline, 0.15).ok).toBe(false);
  });
});

describe('measure-ios-memory.sh', () => {
  const script = path.join(projectRoot, 'scripts/measure-ios-memory.sh');
  const UDID = '00000000-0000-4000-8000-0000000000aa';

  /**
   * A Mac on a stub: `xcrun` answers launch and launchctl, `ps` and `footprint`
   * print the captures above, `maestro` logs its flow, and `adb` lists nothing.
   */
  function fakeMac() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-ios-memory-'));
    const bin = path.join(root, 'bin');
    fs.mkdirSync(bin);
    const write = (name: string, body: string) =>
      fs.writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    fs.writeFileSync(path.join(root, 'ps.txt'), PS);
    fs.writeFileSync(path.join(root, 'footprint.txt'), FOOTPRINT);
    write(
      'xcrun',
      `echo "$*" >> ${root}/xcrun.log
case "$*" in
  *"launchctl list"*) printf 'PID\\tStatus\\tLabel\\n82657\\t0\\tUIKitApplication:com.veloq.app.dev[4ad2][rb-legacy]\\n' ;;
  *" launch "*) echo "com.veloq.app.dev: 82657" ;;
esac`
    );
    write('ps', `cat ${root}/ps.txt`);
    write('footprint', `echo "$*" >> ${root}/footprint.log; cat ${root}/footprint.txt`);
    write('maestro', `echo "$*" >> ${root}/maestro.log`);
    write('adb', 'echo "List of devices attached"');
    write('sleep', 'true');
    return { root, bin };
  }

  function run(args: string[], root: string, bin: string) {
    return spawnSync(script, args, {
      encoding: 'utf8',
      env: {
        NODE_ENV: 'test',
        PATH: `${bin}:${path.dirname(process.execPath)}:/usr/bin:/bin`,
        HOME: root,
        // The host's Maestro lock sits beside the device lock, so this keeps the
        // run off the machine's lock and out of the queue behind a real run.
        VELOQ_DEVICE_LOCK_DIR: root,
      },
    });
  }

  const hasFlock = spawnSync('sh', ['-c', 'command -v flock']).status === 0;

  it('writes a record with the summed total at every point', () => {
    const { root, bin } = fakeMac();
    const out = path.join(root, 'out');
    const result = run([UDID, 'com.veloq.app.dev', out], root, bin);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);

    const record = JSON.parse(fs.readFileSync(path.join(out, 'record.json'), 'utf8'));
    expect(record.udid).toBe(UDID);
    expect(record.points.map((p: { label: string }) => p.label)).toEqual([
      'launch',
      'map-comprehensive',
      'stress-map-toggles',
    ]);
    for (const point of record.points) expect(Math.round(point.totalBytes / MIB)).toBe(803);

    const flows = fs.readFileSync(path.join(root, 'maestro.log'), 'utf8').trim().split('\n');
    expect(flows).toHaveLength(2);
    for (const flow of flows) expect(flow).toContain(`--device ${UDID} test`);
    expect(fs.readFileSync(path.join(root, 'footprint.log'), 'utf8')).toContain(
      '82657 82669 82670 82671 82672 82687'
    );
    fs.rmSync(root, { recursive: true, force: true });
  });

  (hasFlock ? it : it.skip)(
    'takes the host Maestro lock under its own root, never the machine one',
    () => {
      const { root, bin } = fakeMac();
      const result = run([UDID, 'com.veloq.app.dev', path.join(root, 'out')], root, bin);
      expect(result.status).toBe(0);
      expect(fs.readFileSync(path.join(root, 'veloq-maestro.lock'), 'utf8')).toContain(
        `serial=${UDID}`
      );
      fs.rmSync(root, { recursive: true, force: true });
    }
  );

  it('fails on a flow that fails, naming it and keeping what Maestro said', () => {
    const { root, bin } = fakeMac();
    fs.writeFileSync(
      path.join(bin, 'maestro'),
      '#!/bin/sh\necho "Element not found: map-view"\nexit 1\n',
      { mode: 0o755 }
    );
    const out = path.join(root, 'out');
    const result = run([UDID, 'com.veloq.app.dev', out], root, bin);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/map-comprehensive/);
    expect(result.stderr).toContain('Element not found: map-view');
    expect(fs.readFileSync(path.join(out, 'map-comprehensive.maestro.log'), 'utf8')).toContain(
      'Element not found: map-view'
    );
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('fails the run when the total grew past the baseline', () => {
    const { root, bin } = fakeMac();
    const baseline = path.join(root, 'baseline.json');
    fs.writeFileSync(
      baseline,
      JSON.stringify({ points: [{ label: 'launch', totalBytes: 600 * MIB }] })
    );
    const result = run(
      [UDID, 'com.veloq.app.dev', path.join(root, 'out'), '--baseline', baseline],
      root,
      bin
    );
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toMatch(/launch/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('refuses while another session holds the simulator, and runs no flow', () => {
    const { root, bin } = fakeMac();
    const held = path.join(root, '.veloq-locks', `sim-${UDID}`);
    fs.mkdirSync(held, { recursive: true });
    const since = spawnSync('date', ['+%s'], { encoding: 'utf8' }).stdout.trim();
    fs.writeFileSync(
      path.join(held, 'holder'),
      `host=${os.hostname()} pid=${process.pid} item=elsewhere since=${since}\n`
    );
    const result = run([UDID, 'com.veloq.app.dev', path.join(root, 'out')], root, bin);
    expect(result.status).toBe(75);
    expect(result.stderr).toMatch(/is held/);
    expect(fs.existsSync(path.join(root, 'maestro.log'))).toBe(false);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('releases the simulator when the run ends', () => {
    const { root, bin } = fakeMac();
    const result = run([UDID, 'com.veloq.app.dev', path.join(root, 'out')], root, bin);
    expect(result.status).toBe(0);
    expect(fs.existsSync(path.join(root, '.veloq-locks', `sim-${UDID}`))).toBe(false);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
