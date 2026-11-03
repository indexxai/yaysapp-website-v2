module.exports = {
  root: true,
  extends: '@react-native',
  overrides: [
    // Test setup runs under Jest and Node, not React Native.
    { files: ['jest.setup.js', 'e2e/**/*.js', '**/*.test.ts', '**/*.test.tsx'], env: { jest: true, node: true, es2020: true } },
  ],
};
