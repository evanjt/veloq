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
          packageImportPath: 'import com.veloq.VeloqrsPackage;',
          packageInstance: 'new VeloqrsPackage()',
          libraryName: 'Veloqrs',
        },
      },
    },
  },
};
