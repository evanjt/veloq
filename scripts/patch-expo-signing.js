#!/usr/bin/env node
/**
 * Patches Expo CLI to allow simulator builds without code signing certificates.
 *
 * This is needed for headless Mac Mini builds where no Apple ID is signed in.
 * The patch returns a dummy ad-hoc signing identity when no certificates are found,
 * which works fine for simulator builds.
 *
 * Run automatically via postinstall, or manually: node scripts/patch-expo-signing.js
 */

const fs = require("fs");
const path = require("path");

const PATCH_MARKER = "// PATCHED: Allow simulator builds without code signing";

// Find the file to patch - it may be in different locations depending on npm/yarn hoisting
const possiblePaths = [
  "node_modules/expo/node_modules/@expo/cli/build/src/run/ios/codeSigning/resolveCertificateSigningIdentity.js",
  "node_modules/@expo/cli/build/src/run/ios/codeSigning/resolveCertificateSigningIdentity.js",
];

function findFile() {
  for (const p of possiblePaths) {
    const fullPath = path.join(process.cwd(), p);
    if (fs.existsSync(fullPath)) {
      return fullPath;
    }
  }
  return null;
}

function applyPatch() {
  const filePath = findFile();

  if (!filePath) {
    console.log("[patch-expo-signing] Expo CLI file not found, skipping patch");
    return;
  }

  let content = fs.readFileSync(filePath, "utf8");

  // Check if already patched
  if (content.includes(PATCH_MARKER)) {
    console.log("[patch-expo-signing] Already patched");
    return;
  }

  // The code we're looking for
  const oldCode = `if (!ids.length) {
        assertCodeSigningSetup();
    }`;

  const newCode = `if (!ids.length) {
        ${PATCH_MARKER}
        console.log("› [Patched] Skipping code signing for simulator build");
        return {
            signingCertificateId: "-",
            codeSigningInfo: "Ad-hoc signing (simulator only)",
            appleTeamId: "",
            appleTeamName: "Simulator"
        };
    }`;

  if (content.includes(oldCode)) {
    content = content.replace(oldCode, newCode);
    fs.writeFileSync(filePath, content);
    console.log("[patch-expo-signing] Patch applied successfully");
  } else {
    console.log("[patch-expo-signing] Could not find code to patch - Expo CLI may have changed");
  }
}

applyPatch();
