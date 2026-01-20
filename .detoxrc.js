/** @type {import('detox').DetoxConfig} */
module.exports = {
  testRunner: {
    args: {
      $0: 'jest',
      config: 'src/__tests__/e2e/jest.config.js',
    },
    jest: {
      setupTimeout: 180000, // 3 minutes for setup
    },
  },
  apps: {
    'ios.debug': {
      type: 'ios.app',
      binaryPath:
        'ios/build/Build/Products/Debug-iphonesimulator/Veloq.app',
      build:
        'xcodebuild -workspace ios/Veloq.xcworkspace -scheme Veloq -configuration Debug -sdk iphonesimulator -derivedDataPath ios/build',
      launchArgs: {
        detoxPrintBusyIdleResources: 'YES',
      },
    },
    'ios.release': {
      type: 'ios.app',
      binaryPath:
        'ios/build/Build/Products/Release-iphonesimulator/Veloq.app',
      build:
        'xcodebuild -workspace ios/Veloq.xcworkspace -scheme Veloq -configuration Release -sdk iphonesimulator -derivedDataPath ios/build',
    },
    'android.debug': {
      type: 'android.apk',
      binaryPath: 'android/app/build/outputs/apk/debug/app-debug.apk',
      testBinaryPath:
        'android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk',
      build:
        'cd android && ./gradlew :app:assembleDebug :app:assembleAndroidTest -DtestBuildType=debug',
    },
    'android.release': {
      type: 'android.apk',
      binaryPath: 'android/app/build/outputs/apk/release/app-release.apk',
      build:
        'cd android && ./gradlew :app:assembleRelease :app:assembleAndroidTest -DtestBuildType=release',
    },
  },
  devices: {
    simulator: {
      type: 'ios.simulator',
      // Local: iPhone 17 Pro Max, CI: iPhone 16 (override via DETOX_DEVICE_TYPE env var)
      device: { type: process.env.DETOX_DEVICE_TYPE || 'iPhone 17 Pro Max' },
    },
    'simulator.fallback': {
      type: 'ios.simulator',
      device: { type: 'iPhone 16' },
    },
    emulator: {
      type: 'android.emulator',
      // Local: Pixel_5_API_35, CI: Pixel_5_API_30 (override via DETOX_DEVICE_AVD_NAME env var)
      device: { avdName: process.env.DETOX_DEVICE_AVD_NAME || 'Pixel_5_API_35' },
    },
  },
  configurations: {
    'ios.sim.debug': {
      device: 'simulator',
      app: 'ios.debug',
    },
    'ios.sim.release': {
      device: 'simulator',
      app: 'ios.release',
    },
    'android.emu.debug': {
      device: 'emulator',
      app: 'android.debug',
    },
    'android.emu.release': {
      device: 'emulator',
      app: 'android.release',
    },
  },
  behavior: {
    init: {
      exposeGlobals: true,
    },
    launchApp: 'auto',
    cleanup: {
      shutdownDevice: false,
    },
  },
  artifacts: {
    rootDir: 'artifacts',
    plugins: {
      log: { enabled: true },
      screenshot: {
        shouldTakeAutomaticSnapshots: true,
        keepOnlyFailedTestsArtifacts: false,
        takeWhen: {
          testStart: false,
          testDone: true,
        },
      },
    },
  },
};
