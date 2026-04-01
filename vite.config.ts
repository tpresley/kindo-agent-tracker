import { defineConfig } from 'vite'
import sygnal from 'sygnal/vite'

export default defineConfig({
  plugins: [sygnal()],
  server: {
    proxy: {
      '/api/kindo': {
        target: 'https://api.kindo.ai',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/kindo/, '/v1'),
        secure: true,
      },
    },
  },
})
