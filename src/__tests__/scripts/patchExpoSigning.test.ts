import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const root = path.join(__dirname, '../../..');
const cli = 'node_modules/expo/node_modules/@expo/cli/build/src/run/ios';

it('uses ad hoc signing for a simulator while a physical device still requires an identity', async () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'signing-patch-'));
  try {
    const xcode = path.join(fixture, cli, 'XcodeBuild.js');
    const resolver = path.join(fixture, cli, 'codeSigning/resolveCertificateSigningIdentity.js');
    fs.mkdirSync(path.dirname(resolver), { recursive: true });
    fs.writeFileSync(
      xcode,
      `let calls = 0;
const _simulatorCodeSigning = { simulatorBuildRequiresCodeSigning: () => true };
const _configureCodeSigning = { ensureDeviceIsCodeSignedForDeploymentAsync: async () => { calls++; return 'TEAM'; } };
async function build(props) {
    const args = [];
    if (props.device && (!props.isSimulator || (0, _simulatorCodeSigning.simulatorBuildRequiresCodeSigning)(props.projectRoot))) {
        const developmentTeamId = await (0, _configureCodeSigning.ensureDeviceIsCodeSignedForDeploymentAsync)(props.projectRoot);
        if (developmentTeamId) {
            args.push(\`DEVELOPMENT_TEAM=\${developmentTeamId}\`, '-allowProvisioningUpdates', '-allowProvisioningDeviceRegistration');
        }
    }
    return args;
}
module.exports = { build, calls: () => calls };
`
    );
    fs.writeFileSync(
      resolver,
      `function assertCodeSigningSetup() { throw new Error('No signing identity'); }
function resolve(ids) {
    if (!ids.length) {
        // PATCHED: Allow simulator builds without code signing
        console.log("› [Patched] Skipping code signing for simulator build");
        return {
            signingCertificateId: "-",
            codeSigningInfo: "Ad-hoc signing (simulator only)",
            appleTeamId: "",
            appleTeamName: "Simulator"
        };
    }
}
module.exports = { resolve };
`
    );
    const patch = path.join(root, 'scripts/patch-expo-signing.js');
    const result = spawnSync('node', [patch], { cwd: fixture, encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(spawnSync('node', [patch], { cwd: fixture }).status).toBe(0);
    const exercise = spawnSync(
      'node',
      [
        '-e',
        `const x = require(process.argv[1]); const r = require(process.argv[2]);
         (async () => {
           const simulator = await x.build({ device: {}, isSimulator: true, projectRoot: '.' });
           const callsAfterSimulator = x.calls();
           const physical = await x.build({ device: {}, isSimulator: false, projectRoot: '.' });
           let missingIdentityThrows = false;
           try { r.resolve([]); } catch { missingIdentityThrows = true; }
           console.log(JSON.stringify({ simulator, callsAfterSimulator, physical, callsAfterPhysical: x.calls(), missingIdentityThrows }));
         })();`,
        xcode,
        resolver,
      ],
      { cwd: fixture, encoding: 'utf8' }
    );
    expect(exercise.status).toBe(0);
    const behavior = JSON.parse(exercise.stdout.trim().split('\n').at(-1)!);
    expect(behavior.simulator).toEqual(
      expect.arrayContaining(['CODE_SIGN_IDENTITY=-', 'CODE_SIGNING_ALLOWED=YES'])
    );
    expect(behavior.callsAfterSimulator).toBe(0);
    expect(behavior.physical).toEqual(
      expect.arrayContaining(['DEVELOPMENT_TEAM=TEAM', '-allowProvisioningUpdates'])
    );
    expect(behavior.callsAfterPhysical).toBe(1);
    expect(behavior.missingIdentityThrows).toBe(true);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
