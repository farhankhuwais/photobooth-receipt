import { defineConfig } from 'vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Tanpa @vitejs/plugin-react-swc dan vite-tsconfig-paths (npm di mesin ini skip native deps
// seperti @swc/core dan globrex). Path alias @/* didefinisikan manual.
export default defineConfig({
  base: '/admin/',
  server: {
    host: true,
    port: 5174,
    allowedHosts: ['admin.achipix.web.id', '.trycloudflare.com', 'localhost', '127.0.0.1'],
    // Dev: proxy ke backend di container (host port 8099) supaya `npm run dev`
    // tidak perlu rebuild image. Tidak dipakai saat production build.
    proxy: {
      '/api': { target: 'http://localhost:8099', changeOrigin: true },
      '/portal': { target: 'http://localhost:8099', changeOrigin: true },
      '/u': { target: 'http://localhost:8099', changeOrigin: true },
    },
  },
  build: {
    outDir: path.resolve(__dirname, '../dist/admin'),
    emptyOutDir: true,
    sourcemap: true,
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-mui': ['@mui/material', '@mui/icons-material', '@emotion/react', '@emotion/styled'],
          'vendor-charts': ['recharts'],
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  esbuild: {
    jsx: 'automatic',
  },
})
