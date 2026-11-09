import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// En desarrollo, /api se redirige al backend local (puerto 4000).
export default defineConfig({
  plugins: [react()],
  server: { host: '0.0.0.0', port: 5173, proxy: { '/api': 'http://localhost:4000' } },
  preview: { port: 4173 },
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: { output: { manualChunks: { three: ['three', '@react-three/fiber', '@react-three/drei'], tensorflow: ['@tensorflow/tfjs-core', '@tensorflow/tfjs-converter', '@tensorflow/tfjs-backend-webgl', '@tensorflow-models/coco-ssd'] } } },
  },
});
