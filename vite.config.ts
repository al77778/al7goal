import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), cloudflare()],
  server: {
    // The Cloud preview host is supplied per VM through this env var.
    allowedHosts: process.env.__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS
      ? process.env.__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS.split(',')
      : [],
  },
})
