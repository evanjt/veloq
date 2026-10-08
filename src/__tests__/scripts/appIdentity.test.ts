import fs from 'fs';
import os from 'os';
import path from 'path';

const {
  IDENTITIES,
  IdentityError,
  androidAppId,
  iosBundleId,
  pbxAppBundleId,
  selected,
} = require('../../../scripts/lib/app-identity.js');

interface Target {
  id: string;
  name: string;
  productType: string;
  bundleIds: string[];
}

let next = 0;
const objectId = () => (next++).toString(16).toUpperCase().padStart(24, '0');

/** A project file in the layout Xcode and the generator write, one object per target part. */
function pbxproj(targets: Target[]): string {
  const native: string[] = [];
  const lists: string[] = [];
  const configurations: string[] = [];
  for (const target of targets) {
    const list = objectId();
    const configs = target.bundleIds.map((bundleId, i) => {
      const id = objectId();
      const name = i === 0 ? 'Debug' : 'Release';
      // The generator writes an added target's objects with their name before `isa`.
      const [head, tail] =
        target.productType === APP
          ? ['\t\t\tisa = XCBuildConfiguration;\n', `\t\t\tname = ${name};\n`]
          : [`\t\t\tname = ${name};\n\t\t\tisa = XCBuildConfiguration;\n`, ''];
      configurations.push(
        `\t\t${id} /* ${name} */ = {\n${head}\t\t\tbuildSettings = {\n\t\t\t\tINFOPLIST_FILE = ${target.name}/Info.plist;\n\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = ${bundleId};\n\t\t\t\tPRODUCT_NAME = "$(TARGET_NAME)";\n\t\t\t};\n${tail}\t\t};`
      );
      return `\t\t\t\t${id} /* ${name} */,`;
    });
    lists.push(
      `\t\t${list} /* Build configuration list for PBXNativeTarget "${target.name}" */ = {\n\t\t\tisa = XCConfigurationList;\n\t\t\tbuildConfigurations = (\n${configs.join('\n')}\n\t\t\t);\n\t\t\tdefaultConfigurationName = Release;\n\t\t};`
    );
    native.push(
      `\t\t${target.id} /* ${target.name} */ = {\n\t\t\tisa = PBXNativeTarget;\n\t\t\tbuildConfigurationList = ${list} /* Build configuration list for PBXNativeTarget "${target.name}" */;\n\t\t\tbuildPhases = (\n\t\t\t);\n\t\t\tname = ${target.name};\n\t\t\tproductType = "${target.productType}";\n\t\t};`
    );
  }
  // Build files sit one to a line, each with a comment and no `isa` on a line of its own.
  const buildFiles = targets.map(
    (target) =>
      `\t\t${objectId()} /* ${target.name}.swift in Sources */ = {isa = PBXBuildFile; fileRef = ${objectId()} /* ${target.name}.swift */; };`
  );
  return [
    '// !$*UTF8*$!\n{\n\tobjects = {\n',
    '/* Begin PBXBuildFile section */',
    ...buildFiles,
    '/* End PBXBuildFile section */\n',
    '/* Begin PBXNativeTarget section */',
    ...native,
    '/* End PBXNativeTarget section */\n',
    '/* Begin XCBuildConfiguration section */',
    ...configurations,
    '/* End XCBuildConfiguration section */\n',
    '/* Begin XCConfigurationList section */',
    ...lists,
    '/* End XCConfigurationList section */',
    '\t};\n}\n',
  ].join('\n');
}

const APP = 'com.apple.product-type.application';
const EXTENSION = 'com.apple.product-type.app-extension';

function project(appId: string, appBundleIds = [appId, appId], appFirst = true): string {
  const app = { id: objectId(), name: 'Orchard', productType: APP, bundleIds: appBundleIds };
  const extensions = [
    {
      id: objectId(),
      name: 'OrchardWidget',
      productType: EXTENSION,
      bundleIds: [`"${appId}.OrchardWidget"`, `"${appId}.OrchardWidget"`],
    },
    {
      id: objectId(),
      name: 'OrchardPush',
      productType: EXTENSION,
      bundleIds: [`${appId}.OrchardPush`, `${appId}.OrchardPush`],
    },
  ];
  return pbxproj(appFirst ? [app, ...extensions] : [...extensions, app]);
}

let tree: string;

beforeEach(() => {
  tree = fs.mkdtempSync(path.join(os.tmpdir(), 'app-identity-'));
});

afterEach(() => {
  fs.rmSync(tree, { recursive: true, force: true });
});

function write(file: string, contents: string) {
  fs.mkdirSync(path.dirname(path.join(tree, file)), { recursive: true });
  fs.writeFileSync(path.join(tree, file), contents);
}

describe('the selected identity', () => {
  it.each([
    [undefined, IDENTITIES.dev],
    ['', IDENTITIES.dev],
    ['dev', IDENTITIES.dev],
    ['production', IDENTITIES.production],
  ])('APP_VARIANT=%s selects %o', (variant, identity) => {
    expect(selected(variant === undefined ? {} : { APP_VARIANT: variant })).toBe(identity);
  });

  it.each(['prod', 'Production', 'development', 'release'])(
    'refuses APP_VARIANT=%s rather than building Dev under it',
    (variant) => {
      expect(() => selected({ APP_VARIANT: variant })).toThrow(IdentityError);
      expect(() => selected({ APP_VARIANT: variant })).toThrow(variant);
    }
  );

  it('keeps the two identities apart', () => {
    expect(IDENTITIES.dev.appId).not.toBe(IDENTITIES.production.appId);
    expect(IDENTITIES.dev.name).not.toBe(IDENTITIES.production.name);
  });
});

describe('the app configuration', () => {
  function resolved(variant: string | undefined) {
    const before = process.env.APP_VARIANT;
    if (variant === undefined) delete process.env.APP_VARIANT;
    else process.env.APP_VARIANT = variant;
    try {
      let config: {
        name?: string;
        android?: { package?: string };
        ios?: { bundleIdentifier?: string };
      } = {};
      jest.isolateModules(() => {
        config = require('../../../app.config.js')({
          config: { name: 'Orchard', android: {}, ios: {}, plugins: [] },
        });
      });
      return config;
    } finally {
      if (before === undefined) delete process.env.APP_VARIANT;
      else process.env.APP_VARIANT = before;
    }
  }

  it.each([
    [undefined, IDENTITIES.dev],
    ['production', IDENTITIES.production],
  ])('names the app and both packages from the identity APP_VARIANT=%s selects', (variant, id) => {
    const config = resolved(variant);
    expect(config.name).toBe(id.name);
    expect(config.android?.package).toBe(id.appId);
    expect(config.ios?.bundleIdentifier).toBe(id.appId);
  });

  it('refuses an APP_VARIANT that names no identity', () => {
    // A fresh module registry gives the configuration its own copy of the error class.
    expect(() => resolved('prod')).toThrow(/APP_VARIANT=prod names no identity/);
  });
});

describe('the identity a generated Android project builds', () => {
  it('reads the applicationId, not the namespace', () => {
    write(
      'android/app/build.gradle',
      "android {\n    namespace 'com.orchard.kotlin'\n    defaultConfig {\n        applicationId 'com.orchard.app'\n        versionCode 3\n    }\n}\n"
    );
    expect(androidAppId(tree)).toBe('com.orchard.app');
  });

  it('reads a double-quoted applicationId', () => {
    write('android/app/build.gradle', 'defaultConfig {\n  applicationId "com.orchard.app"\n}\n');
    expect(androidAppId(tree)).toBe('com.orchard.app');
  });

  it('is null with no project or no applicationId', () => {
    expect(androidAppId(tree)).toBeNull();
    write('android/app/build.gradle', 'android {\n}\n');
    expect(androidAppId(tree)).toBeNull();
  });
});

describe('the identity a generated iOS project builds', () => {
  it.each([
    ['first', true],
    ['last', false],
  ])('reads the application target, listed %s, not the widget or push extension', (_, first) => {
    expect(pbxAppBundleId(project('com.orchard.app.dev', undefined, first))).toBe(
      'com.orchard.app.dev'
    );
  });

  it('reads a quoted identifier on the app target', () => {
    expect(
      pbxAppBundleId(project('com.orchard.app', ['"com.orchard.app"', '"com.orchard.app"']))
    ).toBe('com.orchard.app');
  });

  it('is null when the app target configurations disagree', () => {
    expect(
      pbxAppBundleId(project('com.orchard.app', ['com.orchard.app.dev', 'com.orchard.app']))
    ).toBeNull();
  });

  it('is null with no application target', () => {
    expect(
      pbxAppBundleId(
        pbxproj([
          { id: objectId(), name: 'W', productType: EXTENSION, bundleIds: ['com.orchard.w'] },
        ])
      )
    ).toBeNull();
  });

  it('finds the one project under ios/ beside the Pods project', () => {
    write('ios/OrchardDev.xcodeproj/project.pbxproj', project('com.orchard.app.dev'));
    write('ios/Pods/Pods.xcodeproj/project.pbxproj', project('org.cocoapods.pods'));
    write('ios/Pods.xcodeproj/project.pbxproj', project('org.cocoapods.pods'));
    expect(iosBundleId(tree)).toBe('com.orchard.app.dev');
  });

  it('is null when a generation left two app projects side by side', () => {
    write('ios/OrchardDev.xcodeproj/project.pbxproj', project('com.orchard.app.dev'));
    write('ios/Orchard.xcodeproj/project.pbxproj', project('com.orchard.app'));
    expect(iosBundleId(tree)).toBeNull();
  });

  it('is null with no project', () => {
    expect(iosBundleId(tree)).toBeNull();
    fs.mkdirSync(path.join(tree, 'ios'));
    expect(iosBundleId(tree)).toBeNull();
  });
});
