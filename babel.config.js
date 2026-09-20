// FIX: This file MUST be named babel.config.js (not babel_config.js)
// The wrong filename was the single biggest build-breaking bug in this project.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // FIX: react-native-reanimated/plugin MUST be last among plugins
      // (keeping it first here causes subtle animation bugs on some RN versions)
      [
        'module-resolver',
        {
          root: ['./src'],
          alias: {
            '@screens': './src/screens',
            '@services': './src/services',
            '@components': './src/components',
            '@navigation': './src/navigation',
            '@store': './src/store',
            '@utils': './src/utils',
          },
        },
      ],
      // FIX: reanimated plugin moved to last position as required by docs
      'react-native-reanimated/plugin',
    ],
  };
};
