const config: import('vitest/config').ViteUserConfig = {
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**', 'client/**', 'agent/**'],
    setupFiles: ['./tests/setup.ts'],
    globals: false,
    restoreMocks: true,
    testTimeout: 5000,
    hookTimeout: 5000,
    reporters: ['default'],
    isolate: true,
  },
};
module.exports = config;
