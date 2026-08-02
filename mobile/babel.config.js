module.exports = function (api) {
  api.cache(true);

  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // WatermelonDB models use legacy decorators (@field, @date, @relation).
      // The modern proposal is not compatible with them, so this must stay
      // `legacy: true`.
      ['@babel/plugin-proposal-decorators', { legacy: true }],

      // Order and looseness both matter here, and getting either wrong fails at
      // runtime with "Decorating class property failed" rather than at build
      // time. The decorators transform installs a getter on the prototype; in
      // spec mode a class field is then defined with Object.defineProperty,
      // which overwrites that getter with undefined. Loose mode compiles the
      // field to a plain assignment instead, leaving the decorator intact.
      //
      // The private-* plugins are here only because Babel requires the loose
      // setting to be consistent across all three, not because this code uses
      // private fields.
      ['@babel/plugin-transform-class-properties', { loose: true }],
      ['@babel/plugin-transform-private-methods', { loose: true }],
      ['@babel/plugin-transform-private-property-in-object', { loose: true }],
    ],
  };
};
