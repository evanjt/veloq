const { withGradleProperties } = require('@expo/config-plugins');

/**
 * Expo config plugin to customize Android gradle.properties
 */
function withGradleOptimizations(config) {
  return withGradleProperties(config, (modConfig) => {
    const modProps = modConfig.modResults;

    const gradleProps = [
      { key: 'org.gradle.caching', value: 'true', type: 'string' },
      { key: 'org.gradle.configuration-cache', value: 'true', type: 'string' },
      { key: 'org.gradle.configureondemand', value: 'true', type: 'string' },
      { key: 'org.gradle.daemon', value: 'true', type: 'string' },
      {
        key: 'org.gradle.jvmargs',
        value: '-Xmx4096m -XX:MaxMetaspaceSize=512m -XX:+HeapDumpOnOutOfMemoryError -Dfile.encoding=UTF-8',
        type: 'string'
      },
    ];

    const androidProps = [
      { key: 'android.enableR8.fullMode', value: 'true', type: 'string' },
      { key: 'android.nonTransitiveRClass', value: 'true', type: 'string' },
      { key: 'android.enableJetifier', value: 'true', type: 'string' },
    ];

    [...gradleProps, ...androidProps].forEach((newProp) => {
      const existingIndex = modProps.findIndex(
        (prop) => prop.key === newProp.key
      );

      if (existingIndex >= 0) {
        modProps[existingIndex] = newProp;
      } else {
        modProps.push(newProp);
      }
    });

    return modConfig;
  });
}

module.exports = withGradleOptimizations;
