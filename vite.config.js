import { defineConfig } from 'vite';

export default defineConfig({
  base: '/onlybinge/',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: './index.html'
      }
    }
  }
});