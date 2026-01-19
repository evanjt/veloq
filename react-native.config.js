const path = require('path');

module.exports = {
  dependencies: {
    'route-matcher-native': {
      root: path.resolve(__dirname, 'src/modules/route-matcher-native'),
      platforms: {
        ios: {
          podspecPath: 'ios/RouteMatcherNative.podspec',
        },
        android: {
          sourceDir: 'android',
          packageImportPath: 'import com.veloq.VeloqPackage;',
          packageInstance: 'new VeloqPackage()',
          libraryName: 'Veloq',
          cmakeListsPath: 'build/generated/source/codegen/jni/CMakeLists.txt',
        },
      },
    },
  },
};
