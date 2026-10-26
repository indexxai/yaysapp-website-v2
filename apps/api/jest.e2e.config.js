module.exports = {
  preset: 'ts-jest', testEnvironment: 'node', roots: ['<rootDir>/test'], testMatch: ['**/*.e2e.ts'],
  globalSetup: '<rootDir>/test/global-setup.ts', globalTeardown: '<rootDir>/test/global-teardown.ts',
  testTimeout: 30000,
};
