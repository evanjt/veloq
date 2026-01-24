const path = require('path');

module.exports = {
  dependencies: {
    'veloqrs': {
      root: path.resolve(__dirname, 'modules/veloqrs'),
      platforms: {
        ios: {
          podspecPath: 'ios/Veloqrs.podspec',
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
