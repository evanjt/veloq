#!/usr/bin/env node
// Expo asks for a development certificate when simulator entitlements need a
// signature. Use ad hoc signing there; physical devices keep Expo's identity
// and provisioning checks.

const fs = require('fs');
const path = require('path');

const CLI_PATHS = [
  'node_modules/expo/node_modules/@expo/cli/build/src/run/ios',
  'node_modules/@expo/cli/build/src/run/ios',
];
const MARKER = '// PATCHED: Ad hoc simulator signing';
const OLD_MARKER = '// PATCHED: Allow simulator builds without code signing';

const oldBuild = `if (props.device && (!props.isSimulator || (0, _simulatorCodeSigning.simulatorBuildRequiresCodeSigning)(props.projectRoot))) {
        const developmentTeamId = await (0, _configureCodeSigning.ensureDeviceIsCodeSignedForDeploymentAsync)(props.projectRoot);
        if (developmentTeamId) {
            args.push(\`DEVELOPMENT_TEAM=\${developmentTeamId}\`, '-allowProvisioningUpdates', '-allowProvisioningDeviceRegistration');
        }
    }`;
const newBuild = `if (props.device && props.isSimulator && (0, _simulatorCodeSigning.simulatorBuildRequiresCodeSigning)(props.projectRoot)) {
        ${MARKER}
        args.push('CODE_SIGN_IDENTITY=-', 'CODE_SIGNING_REQUIRED=NO', 'CODE_SIGNING_ALLOWED=YES', 'DEVELOPMENT_TEAM=');
    } else if (props.device && !props.isSimulator) {
        const developmentTeamId = await (0, _configureCodeSigning.ensureDeviceIsCodeSignedForDeploymentAsync)(props.projectRoot);
        if (developmentTeamId) {
            args.push(\`DEVELOPMENT_TEAM=\${developmentTeamId}\`, '-allowProvisioningUpdates', '-allowProvisioningDeviceRegistration');
        }
    }`;
const oldResolverPatch = `if (!ids.length) {
        ${OLD_MARKER}
        console.log("› [Patched] Skipping code signing for simulator build");
        return {
            signingCertificateId: "-",
            codeSigningInfo: "Ad-hoc signing (simulator only)",
            appleTeamId: "",
            appleTeamName: "Simulator"
        };
    }`;
const stockResolver = `if (!ids.length) {
        assertCodeSigningSetup();
    }`;

function findCli() {
  for (const relative of CLI_PATHS) {
    const dir = path.join(process.cwd(), relative);
    if (fs.existsSync(path.join(dir, 'XcodeBuild.js'))) return dir;
  }
  return null;
}

function patch() {
  const dir = findCli();
  if (!dir) {
    console.log('[patch-expo-signing] Expo CLI file not found, skipping patch');
    return;
  }

  const buildPath = path.join(dir, 'XcodeBuild.js');
  const resolverPath = path.join(dir, 'codeSigning/resolveCertificateSigningIdentity.js');
  const build = fs.readFileSync(buildPath, 'utf8');
  const resolver = fs.readFileSync(resolverPath, 'utf8');
  if (!build.includes(oldBuild) && !build.includes(newBuild)) {
    throw new Error('[patch-expo-signing] Expo XcodeBuild.js changed; review signing patch');
  }
  if (resolver.includes(OLD_MARKER) && !resolver.includes(oldResolverPatch)) {
    throw new Error('[patch-expo-signing] Old identity patch changed; review before restoring');
  }

  const nextBuild = build.includes(newBuild) ? build : build.replace(oldBuild, newBuild);
  const nextResolver = resolver.replace(oldResolverPatch, stockResolver);
  if (nextBuild !== build) fs.writeFileSync(buildPath, nextBuild);
  if (nextResolver !== resolver) fs.writeFileSync(resolverPath, nextResolver);
  console.log('[patch-expo-signing] Simulator signing guarded; device identity checks intact');
}

patch();
