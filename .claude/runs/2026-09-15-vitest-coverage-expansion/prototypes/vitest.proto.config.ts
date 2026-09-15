const config: import('vitest/config').ViteUserConfig = {
  test: {
    environment: 'node',
    include: ['.claude/runs/2026-09-15-vitest-coverage-expansion/prototypes/**/*.test.ts'],
    globals: false,
    isolate: true,
    testTimeout: 5000,
  },
};
module.exports = config;
