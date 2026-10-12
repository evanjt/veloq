const path = require('path');

module.exports = {
  dependencies: {
    // The iCloud backup carrier is iOS only, so Android links none of its native code.
    'react-native-cloud-storage': {
      platforms: {
        android: null,
      },
    },
    'veloqrs': {
      root: path.resolve(__dirname, 'modules/veloqrs'),
      platforms: {
        ios: {
          podspecPath: 'ios/Veloqrs.podspec',
        },
        android: {
          sourceDir: 'android',
          packageImportPath: 'import com.veloq.VeloqrsPackage;',
          packageInstance: 'new VeloqrsPackage()',
          libraryName: 'Veloqrs',
        },
      },
    },
  },
};
