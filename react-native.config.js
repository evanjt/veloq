const path = require('path');

module.exports = {
  dependencies: {
    'route-matcher-native': {
      root: path.resolve(__dirname, 'modules/route-matcher-native'),
      platforms: {
        ios: {
          podspecPath: path.resolve(__dirname, 'modules/route-matcher-native/ios/RouteMatcherNative.podspec'),
        },
        android: {
          sourceDir: path.resolve(__dirname, 'modules/route-matcher-native/android'),
          packageImportPath: 'import com.veloq.VeloqPackage;',
          packageInstance: 'new VeloqPackage()',
        },
      },
    },
  },
};
