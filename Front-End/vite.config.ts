import { execSync } from 'node:child_process'
import { createRequire } from 'node:module'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const require = createRequire(import.meta.url)
const pdfjsLegacy = require.resolve('pdfjs-dist/legacy/build/pdf.mjs')

function apiProxyTarget() {
  if (process.env.API_PROXY) return process.env.API_PROXY
  if (process.platform === 'win32') {
    try {
      const ip = execSync('wsl -e hostname -I', { encoding: 'utf8' }).trim().split(/\s+/)[0]
      if (ip) return `http://${ip}:8080`
    } catch {
      // Backend may be running on Windows instead of WSL.
    }
  }
  return 'http://127.0.0.1:8080'
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  optimizeDeps: {
    include: ['pdfjs-dist'],
  },
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./vitest.setup.ts'],
    alias: [{ find: /^pdfjs-dist$/, replacement: pdfjsLegacy }],
  },
  server: {
    port: 5173,
    // Forward API calls to the C++ back-end during development, so the
    // front-end can just fetch('/api/...') with no CORS setup.
    proxy: {
      '/api': {
        target: apiProxyTarget(),
        changeOrigin: true,
        timeout: 4000,
        proxyTimeout: 4000,
      },
    },
  },
})
