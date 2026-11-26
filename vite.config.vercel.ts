import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Vercel build: only the React client. The API runs as a Node function (api/index.ts).
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/vercel',
    emptyOutDir: true,
  },
})
