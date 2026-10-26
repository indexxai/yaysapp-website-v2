module.exports = {
  preset: 'react-native',
  setupFiles: ['<rootDir>/jest.setup.js'],
  setupFilesAfterEnv: ['<rootDir>/jest.after-env.js'],
  transformIgnorePatterns: ['node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-navigation|react-native-.*|@yays)/)'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
};
