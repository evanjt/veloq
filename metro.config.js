// Metro configuration: Expo's defaults, with a transform cache keyed per checkout.
//
// Metro keys a cached transform on the file's path relative to the project
// root, and every checkout on the machine shares the one cache directory.
// Babel inlines the router app root relative to the file being transformed, so
// two checkouts that reach `expo-router/_ctx` through links into the same
// installation compute the same key and different results. Whichever built
// first is served to the other: its bundle carried the first checkout's engine
// module, or no screen at all. Folding the checkout's real path into the cache
// version keeps the entries apart without clearing anything, so a rebuild of
// one checkout still reuses its own work.

const { realpathSync } = require('node:fs');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// A module is evaluated when first used rather than all at once at launch, so
// the first frame does not wait on screens and libraries the launch screen
// never reads.
const expoTransformOptions = config.transformer.getTransformOptions;
config.transformer.getTransformOptions = async (...args) => {
  const options = await expoTransformOptions(...args);
  return { ...options, transform: { ...options.transform, inlineRequires: true } };
};

config.cacheVersion = `${config.cacheVersion ?? ''}:${realpathSync(__dirname)}`;

module.exports = config;
