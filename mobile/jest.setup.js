/**
 * Jest setup.
 *
 * AsyncStorage is a native module with no JS implementation under Node, so it
 * throws on import in tests. The package ships an in-memory mock for exactly
 * this; registering it here keeps every test file free of the boilerplate.
 */

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
