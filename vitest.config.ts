// CommonJS on purpose: package.json has no "type": "module" and tsconfig.json
// sets "module": "commonjs", so this file is loaded as CommonJS. Writing it as
// `import ... export default defineConfig(...)` makes every `npm test` print a
// Vite warning about ESM syntax in a file loaded as CommonJS. Do not "fix" that
// by adding "type": "module" — the server ships as CommonJS in dist/.
const config: import('vitest/config').ViteUserConfig = {
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**', 'client/**'],
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
