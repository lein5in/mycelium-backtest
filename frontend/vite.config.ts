import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const FRONTEND_DEV_PORT = 5417
const BACKEND_DEV_PORT = 8417

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: FRONTEND_DEV_PORT,
    strictPort: true,
    proxy: {
      '/api': `http://127.0.0.1:${BACKEND_DEV_PORT}`,
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
