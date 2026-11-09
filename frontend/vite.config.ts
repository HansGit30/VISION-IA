
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],

  // Desarrollo local
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },

  preview: {
    port: 4173,
  },

  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          three: [
            'three',
            '@react-three/fiber',
            '@react-three/drei',
          ],
        },
      },
    },
  },
});
