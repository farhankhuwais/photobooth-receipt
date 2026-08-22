import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Photobooth Receipt',
        short_name: 'PhotoBooth',
        description: 'Photobooth strip + thermal receipt printer',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }
        ]
      },
      workbox: {
        // Jangan pakai index.html sebagai fallback untuk /portal — biar server
        // yang mengirim admin.html (dashboard). Tanpa ini, refresh di /portal
        // malah menampilkan index.html (app booth) => tampilan blank.
        // Juga denylist /guides agar board panduan + README.html ke-serve mentah
        // (bukan di-intercept SW jadi app).
        // Dan /u/ (link download hasil foto dari QR) — jangan di-intercept SW
        // supaya langsung serve gambar asli, bukan app.
        navigateFallbackDenylist: [/^\/portal/, /^\/guides/, /^\/u\//],
        cleanupOutdatedCaches: true
      }
    })
  ],
  server: { host: true, port: 5173 },
  preview: {
    host: true,
    port: 5173,
    // Izinkan akses lewat Cloudflare Tunnel / domain publik.
    // Ganti dengan domain kamu, atau true untuk allow semua host.
    allowedHosts: ['achipix.achidev.my.id', 'localhost', '127.0.0.1']
  }
})
