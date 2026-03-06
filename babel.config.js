module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    plugins: [
      [
        "module-resolver",
        {
          root: ["./"],
          alias: {
            "@": "./src",
          },
        },
      ],
      ...(process.env.NODE_ENV === 'production'
        ? [['transform-remove-console', { exclude: ['error'] }]]
        : []),
      "react-native-reanimated/plugin",
    ],
  };
};
