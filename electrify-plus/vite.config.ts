import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // 'as any' bypasses the plugin version mismatch between root Vite and Vitest
  plugins: [react() as any],

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