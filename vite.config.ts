import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Electron carga el renderer vía file:// en producción, por eso base relativa.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // Sin esto, Vite vigila todo el proyecto incluida `release/` — cuando
    // electron-builder empaqueta mientras el dev server sigue abierto, se
    // pisan y Vite se cae con EBUSY sobre archivos temporales del build.
    watch: {
      ignored: ['**/release/**', '**/dist/**', '**/dist-electron/**'],
    },
  },
  resolve: {
    alias: {
      '@': '/src',
      '@shared': '/shared',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
