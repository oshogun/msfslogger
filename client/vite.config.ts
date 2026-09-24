import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      // Carbon's Sass and the hand-written @font-face block in
      // src/styles/index.scss address the Plex packages with the webpack-era
      // `~` prefix. Without this alias the url() is left untouched and the
      // build prints "didn't resolve at build time" for every font file.
      {
        find: /^~@ibm\//,
        replacement: path.resolve(import.meta.dirname, 'node_modules/@ibm') + '/',
      },
    ],
  },
  css: {
    preprocessorOptions: {
      scss: {
        api: 'modern-compiler',
        // Carbon 1.117 still emits legacy-Sass deprecation warnings from its
        // own files. quietDeps keeps the build output readable; it does not
        // silence warnings from our own .scss.
        quietDeps: true,
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
  preview: {
    port: 5174,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
  },
});
