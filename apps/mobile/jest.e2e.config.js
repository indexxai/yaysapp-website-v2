const base = require('./jest.base');
module.exports = { ...base, setupFiles: [...base.setupFiles, '<rootDir>/e2e/env.js'], testMatch: ['<rootDir>/e2e/**/*.e2e.tsx'], globalSetup: '<rootDir>/e2e/global-setup.js', globalTeardown: '<rootDir>/e2e/global-teardown.js', testTimeout: 60000 };
