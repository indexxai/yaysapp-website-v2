module.exports = { preset: 'ts-jest', testEnvironment: 'node', roots: ['<rootDir>/src'], testMatch: ['**/*.spec.ts'], passWithNoTests: true }; // the API is tested end to end (test/*.e2e.ts)
