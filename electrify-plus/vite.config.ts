/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
  },
  server: {
    proxy: {
      '/api-proxy': {
        target: 'https://fb9hy2xuei.execute-api.us-east-1.amazonaws.com/dev',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api-proxy/, ''),
      },
    },
  },
})