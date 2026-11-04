import { defineConfig } from 'vite';

export default defineConfig({
  root: 'client',
  envDir: '..',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
  },
  server: {
    port: 5173,
    // Allow tunnel hostnames (cloudflared, ngrok…) when testing inside Discord.
    allowedHosts: true,
    proxy: {
      '/api': 'http://localhost:3000',
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
});
