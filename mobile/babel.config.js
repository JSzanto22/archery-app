module.exports = function (api) {
  api.cache(true);

  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // WatermelonDB models are written with legacy decorators (@field, @date,
      // @relation). The modern proposal is not compatible with them, so this
      // must stay `legacy: true` and must come before class-properties.
      ['@babel/plugin-proposal-decorators', { legacy: true }],
    ],
  };
};
