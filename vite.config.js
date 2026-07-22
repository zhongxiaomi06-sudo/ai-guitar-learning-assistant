import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: '.',
  base: './',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsDir: 'assets',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        mobilePrototype: resolve(__dirname, 'mobile-prototype.html')
      }
    }
  },
  server: {
    port: 3000,
    open: true,
    host: true
  }
});
